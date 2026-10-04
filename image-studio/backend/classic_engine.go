package backend

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"github.com/yuanhua/image-gptcodex/pkg/client"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
	"image-studio/backend/studio"
)

func (s *Service) sharedEngine() (*studio.Engine, error) {
	if s.studio == nil {
		return nil, errors.New("共享任务服务不可用")
	}
	return s.studio.core()
}

func (s *Service) SetClassicAssetReferences(ids []string) error {
	e, err := s.sharedEngine()
	if err != nil {
		return err
	}
	return e.SetClassicAssetReferences(ids)
}

func (s *Service) classicRequest(e *studio.Engine, opts GenerateOptions, id string) (studio.Request, error) {
	r := studio.Request{ID: id, ProfileID: opts.ProfileID, ProjectID: "classic", Source: "classic", Kind: "image", Prompt: opts.Prompt,
		Parameters: studio.Parameters{Size: opts.Size}, Image: studio.ImageParameters{
			Quality: opts.Quality, OutputFormat: opts.OutputFormat, Seed: opts.Seed, NegativePrompt: opts.NegativePrompt,
			Background: opts.Background, OutputCompression: opts.OutputCompression, InputFidelity: opts.InputFidelity,
			ImageStyle: opts.ImageStyle, Moderation: opts.Moderation, UserIdentifier: opts.UserIdentifier,
			DisablePreview: opts.DisablePreview, PartialImages: opts.PartialImages,
		}}
	if opts.AutoRetryEnabled {
		r.UnsentRetries = opts.AutoRetryCount
		if r.UnsentRetries <= 0 {
			r.UnsentRetries = client.DefaultAutoRetryCount
		}
		r.AutoFallback = true
	}
	paths, cleanup, err := prepareUploadSourcePaths(opts.collectPaths())
	if err != nil {
		return r, err
	}
	defer cleanup()
	for _, path := range paths {
		info, err := os.Stat(path)
		if err != nil {
			return r, err
		}
		if info.Size() > 20<<20 {
			return r, errors.New("参考图片最大 20 MB")
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return r, err
		}
		a, err := e.Import(data, filepath.Base(path))
		if err != nil {
			return r, err
		}
		r.ReferenceAssetIDs = append(r.ReferenceAssetIDs, a.ID)
	}
	if opts.MaskB64 != "" {
		if len(opts.MaskB64) > 28<<20 {
			return r, errors.New("蒙版过大")
		}
		encoded := opts.MaskB64
		if strings.HasPrefix(encoded, "data:") {
			_, encoded, _ = strings.Cut(encoded, ",")
		}
		data, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil {
			return r, errors.New("蒙版编码无效")
		}
		a, err := e.Import(data, "编辑蒙版.png")
		if err != nil {
			return r, err
		}
		r.MaskAssetID = a.ID
	}
	return r, nil
}

func (s *Service) runJob(ctx context.Context, jobID string, _ GenerateOptions, done chan struct{}) {
	defer close(done)
	defer func() {
		s.mu.Lock()
		if j, ok := s.jobs[jobID]; ok {
			s.runningByAPIMode[j.apiMode]--
			delete(s.jobs, jobID)
		}
		s.mu.Unlock()
	}()
	e, err := s.sharedEngine()
	if err != nil {
		s.emitError(jobID, err)
		return
	}
	j, err := e.Wait(ctx, jobID)
	if err != nil {
		s.emitError(jobID, err)
		return
	}
	if j.State != "succeeded" {
		s.emitErrorWithRaw(jobID, errors.New(j.Error), s.sharedDiagnosticPath(jobID))
		return
	}
	payload, err := s.classicResult(e, j)
	if err != nil {
		s.emitError(jobID, err)
		return
	}
	runtime.EventsEmit(s.ctx, "result:"+jobID, payload)
}

func (s *Service) classicResult(e *studio.Engine, j studio.Job) (ResultPayload, error) {
	s.thumbMu.Lock()
	defer s.thumbMu.Unlock()
	path, err := e.AssetPath(j.ResultAssetID)
	if err != nil {
		return ResultPayload{}, err
	}
	s.addTrustedOutputRoot(filepath.Dir(path))
	thumbDir := thumbsSubdir(filepath.Dir(path))
	if err = os.MkdirAll(thumbDir, secureDirMode); err != nil {
		return ResultPayload{}, err
	}
	thumb := filepath.Join(thumbDir, j.ResultAssetID+".avif")
	w, h := 0, 0
	if _, err = os.Stat(thumb); os.IsNotExist(err) {
		w, h, err = createAVIFThumbnail(path, thumb, mediaThumbMaxEdge)
	}
	if err != nil {
		thumb = ""
	} // The original stays usable if preview encoding fails.
	asset, err := s.registerGeneratedMedia(path, thumb, w, h)
	if err != nil {
		return ResultPayload{}, err
	}
	mode := "generate"
	if j.HistoryMode == "edit" || j.Request.ReferenceAssetID != "" || len(j.Request.ReferenceAssetIDs) > 0 {
		mode = "edit"
	}
	return ResultPayload{RawPath: s.sharedDiagnosticPath(j.ID), CreatedAt: j.CreatedAt, Size: j.Request.Parameters.Size, Quality: j.Request.Image.Quality, OutputFormat: j.Request.Image.OutputFormat, RevisedPrompt: j.RevisedPrompt, JobID: j.ID, AssetID: j.ResultAssetID, ImageID: asset.ID, SavedPath: path, ThumbPath: asset.ThumbPath,
		PreviewURL: asset.PreviewURL, FullURL: asset.FullURL, PreviewWidth: asset.PreviewWidth, PreviewHeight: asset.PreviewHeight,
		Mode: mode, Prompt: j.Request.Prompt, SourceEvent: "final"}, nil
}

func (s *Service) emitSharedPreview(id string, partial client.PartialImage) {
	s.mu.Lock()
	_, active := s.jobs[id]
	s.mu.Unlock()
	if !active || partial.ImageB64 == "" {
		return
	}
	root, err := s.resolvedOutputDir()
	if err != nil {
		return
	}
	dir := previewsSubdir(root)
	if err = os.MkdirAll(dir, secureDirMode); err != nil {
		return
	}
	path := filepath.Join(dir, fmt.Sprintf("preview-%s-%d.avif", id, time.Now().UnixNano()))
	w, h, err := createAVIFThumbnailFromBase64(partial.ImageB64, path, mediaPreviewMaxEdge)
	if err != nil {
		return
	}
	a, err := s.registerPreviewMedia(path, w, h)
	if err != nil {
		return
	}
	runtime.EventsEmit(s.ctx, "preview:"+id, PreviewPayload{ImageID: a.ID, PreviewURL: a.PreviewURL, PreviewWidth: w, PreviewHeight: h, RevisedPrompt: partial.RevisedPrompt, PartialImageIndex: partial.PartialImageIndex})
}

// GetGenerationHistory lets the classic UI recover shared results after a
// restart. Existing output folders remain valid import/export locations.
func (s *Service) GetGenerationHistory() ([]ResultPayload, error) {
	e, err := s.sharedEngine()
	if err != nil {
		return nil, err
	}
	snapshot, err := e.Snapshot()
	if err != nil {
		return nil, err
	}
	results := []ResultPayload{}
	for _, j := range snapshot.Jobs {
		if j.State != "succeeded" || j.Request.Kind != "image" {
			continue
		}
		p, err := s.classicResult(e, j)
		if err != nil {
			return nil, err
		}
		results = append(results, p)
	}
	return results, nil
}

func (s *Service) saveSharedDiagnostic(id, text string) {
	if text == "" {
		return
	}
	root, err := s.resolvedOutputDir()
	if err != nil {
		return
	}
	dir := logSubdir(root)
	if os.MkdirAll(dir, secureDirMode) != nil {
		return
	}
	sum := sha256.Sum256([]byte(id))
	_ = os.WriteFile(filepath.Join(dir, fmt.Sprintf("shared-response-%x.txt", sum[:])), []byte(text), secureFileMode)
}
func (s *Service) sharedDiagnosticPath(id string) string {
	root, err := s.resolvedOutputDir()
	if err != nil {
		return ""
	}
	sum := sha256.Sum256([]byte(id))
	path := filepath.Join(logSubdir(root), fmt.Sprintf("shared-response-%x.txt", sum[:]))
	if _, err = os.Stat(path); err != nil {
		return ""
	}
	return path
}
