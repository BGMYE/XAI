package backend

import (
	"context"
	"encoding/base64"
	"errors"
	"github.com/yuanhua/image-gptcodex/pkg/client"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/wailsapp/wails/v2/pkg/runtime"
	"image-studio/backend/studio"
)

// StudioV2 is a thin Wails host. The core contains no Wails/runtime dependency.
// Its upstream registry is shared with the classic editor.
type StudioV2 struct {
	classic *Service
	mu      sync.Mutex
	ctx     context.Context
	engine  *studio.Engine
	initErr error
	keys    apiKeyStore
}
type studioSecrets struct{ keys apiKeyStore }

func (s studioSecrets) Get(id string) (string, error) { return s.keys.Get("api-key:studio-v2:" + id) }
func (s studioSecrets) Set(id, key string) error      { return s.keys.Set("api-key:studio-v2:"+id, key) }
func (s studioSecrets) Delete(id string) error        { return s.keys.Delete("api-key:studio-v2:" + id) }
func NewStudioV2(s *Service) *StudioV2 {
	host := &StudioV2{keys: s.apiKeys, classic: s}
	s.studio = host
	return host
}
func (s *StudioV2) Startup(ctx context.Context) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.ctx = ctx
	dir, err := os.UserConfigDir()
	if err != nil {
		s.initErr = err
		return
	}
	s.engine, s.initErr = studio.Open(filepath.Join(dir, "ImageStudio", "studio-v2"), studioSecrets{s.keys}, studio.Options{
		Workers: 2,
		OnDiagnostic: func(id, text string) {
			if s.classic != nil {
				s.classic.saveSharedDiagnostic(id, text)
			}
		},
		// Events only announce that something changed; the window then asks for
		// the delta with GetChanges, so a missed event costs nothing but latency.
		OnChange: func(revision uint64) { runtime.EventsEmit(ctx, "studio:changed", revision) },
		OnProgress: func(jobID string, percent int) {
			runtime.EventsEmit(ctx, "studio:progress", map[string]any{"jobId": jobID, "percent": percent})
			runtime.EventsEmit(ctx, "progress:"+jobID, ProgressPayload{Stage: "上游处理中"})
		},
		OnPreview: func(jobID string, preview client.PartialImage) {
			if s.classic != nil {
				s.classic.emitSharedPreview(jobID, preview)
			}
		},
	})
}
func (s *StudioV2) Shutdown(_ context.Context) {
	s.mu.Lock()
	e := s.engine
	s.mu.Unlock()
	if e != nil {
		e.Close()
	}
}
func (s *StudioV2) core() (*studio.Engine, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.initErr != nil {
		return nil, s.initErr
	}
	if s.engine == nil {
		return nil, errors.New("工作室服务尚未启动")
	}
	return s.engine, nil
}
func (s *StudioV2) GetSnapshot() (studio.Snapshot, error) {
	e, err := s.core()
	if err != nil {
		return studio.Snapshot{}, err
	}
	return e.Snapshot()
}

// GetChanges returns what changed after the given revision. A client on
// another epoch (after a restart) or too far behind receives a full snapshot.
func (s *StudioV2) GetChanges(epoch string, since uint64) (studio.ChangeSet, error) {
	e, err := s.core()
	if err != nil {
		return studio.ChangeSet{}, err
	}
	return e.Changes(epoch, since)
}
func (s *StudioV2) SaveProfile(p studio.Profile, key string) (studio.Profile, error) {
	e, err := s.core()
	if err != nil {
		return studio.Profile{}, err
	}
	saved, err := e.SaveProfile(p, key)
	if err != nil {
		return studio.Profile{}, err
	}
	if key = strings.TrimSpace(key); key != "" && classicKeyID(saved.ID) {
		if old, err := s.keys.Get(classicKeyEntry(saved.ID)); err == nil && old != "" && old != key {
			s.forgetClassicKey(saved.ID)
		}
	}
	return saved, nil
}
func (s *StudioV2) DeleteProfile(id string) error {
	e, err := s.core()
	if err != nil {
		return err
	}
	if err = e.DeleteProfile(id); err != nil {
		return err
	}
	s.forgetClassicKey(id)
	return nil
}

// forgetClassicKey deletes the keychain entry an imported profile had in the
// classic editor. The import leaves it in place, and the classic editor falls
// back to it when the registry cannot be opened, so it is removed once it no
// longer holds the profile's key: a replaced or cleared key must not be sent.
func (s *StudioV2) forgetClassicKey(id string) {
	if classicKeyID(id) {
		_ = s.keys.Delete(classicKeyEntry(id))
	}
}

func classicKeyEntry(id string) string { return "api-key:profile:" + id }

// ListProfiles returns the shared upstreams in creation order. The classic
// editor reads its upstream list from here on the desktop.
func (s *StudioV2) ListProfiles() ([]studio.Profile, error) {
	e, err := s.core()
	if err != nil {
		return nil, err
	}
	return e.Profiles()
}

// DuplicateProfile copies an upstream together with its key.
func (s *StudioV2) DuplicateProfile(id string) (studio.Profile, error) {
	e, err := s.core()
	if err != nil {
		return studio.Profile{}, err
	}
	return e.DuplicateProfile(id)
}

// GetProfileKey reveals an OpenAI-compatible key for an explicit settings
// action. Normal generation and initialization never send keys to the window.
func (s *StudioV2) GetProfileKey(id string) (string, error) {
	e, err := s.core()
	if err != nil {
		return "", err
	}
	return e.ProfileKey(id)
}

// ClearProfileKey removes an upstream's saved key, including the copy an
// imported profile may still have in the classic editor's keychain entry.
func (s *StudioV2) ClearProfileKey(id string) (studio.Profile, error) {
	e, err := s.core()
	if err != nil {
		return studio.Profile{}, err
	}
	p, err := e.ClearProfileKey(id)
	if err != nil {
		return studio.Profile{}, err
	}
	s.forgetClassicKey(id)
	return p, nil
}

// ImportClassicProfiles copies upstreams the classic editor kept in browser
// storage into the shared registry, with their keys. It is idempotent.
func (s *StudioV2) ImportClassicProfiles(profiles []studio.Profile) (int, error) {
	e, err := s.core()
	if err != nil {
		return 0, err
	}
	return e.ImportProfiles(profiles, func(id string) (string, error) {
		if !classicKeyID(id) {
			return "", nil
		}
		return s.keys.Get(classicKeyEntry(id))
	})
}

// SetNetworkProxy applies the classic editor's proxy setting to Studio jobs.
func (s *StudioV2) SetNetworkProxy(mode, proxyURL string) (studio.NetworkSettings, error) {
	e, err := s.core()
	if err != nil {
		return studio.NetworkSettings{}, err
	}
	return e.SetNetwork(studio.NetworkSettings{ProxyMode: mode, ProxyURL: proxyURL})
}

// classicKeyID accepts the IDs the classic editor used in keychain entries.
func classicKeyID(id string) bool {
	_, err := normalizeKeyringUser("profile:" + id)
	return err == nil
}
func (s *StudioV2) TestProfile(id string) ([]string, error) {
	e, err := s.core()
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	ctx := s.ctx
	s.mu.Unlock()
	return e.TestProfile(ctx, id)
}
func (s *StudioV2) SaveProject(p studio.Project) (studio.Project, error) {
	e, err := s.core()
	if err != nil {
		return studio.Project{}, err
	}
	return e.SaveProject(p)
}
func (s *StudioV2) SubmitGeneration(r studio.Request) (studio.Job, error) {
	e, err := s.core()
	if err != nil {
		return studio.Job{}, err
	}
	return e.Submit(r)
}
func (s *StudioV2) RunWorkflow(projectID, profileID, runID string) ([]studio.Job, error) {
	e, err := s.core()
	if err != nil {
		return nil, err
	}
	return e.RunWorkflow(projectID, profileID, runID)
}
func (s *StudioV2) CancelJob(id string) error {
	e, err := s.core()
	if err != nil {
		return err
	}
	return e.Cancel(id)
}
func (s *StudioV2) ResumeJob(id string) error {
	e, err := s.core()
	if err != nil {
		return err
	}
	return e.Resume(id)
}
func (s *StudioV2) ImportImage(dataURL, name string) (studio.Asset, error) {
	e, err := s.core()
	if err != nil {
		return studio.Asset{}, err
	}
	if len(dataURL) > 28*1024*1024 {
		return studio.Asset{}, errors.New("导入图片最大 20 MB")
	}
	head, data, ok := strings.Cut(dataURL, ",")
	if !ok {
		return studio.Asset{}, errors.New("图片数据无效")
	}
	switch head {
	case "data:image/png;base64", "data:image/jpeg;base64", "data:image/webp;base64", "data:image/gif;base64":
	default:
		return studio.Asset{}, errors.New("仅接受 PNG、JPEG、WebP、GIF 图片")
	}
	b, err := base64.StdEncoding.DecodeString(data)
	if err != nil {
		return studio.Asset{}, errors.New("图片编码无效")
	}
	return e.Import(b, name)
}
func (s *StudioV2) MediaHandler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/studio-media/") && !strings.HasPrefix(r.URL.Path, "/studio-dlss5-preview/") {
			next.ServeHTTP(w, r)
			return
		}
		e, err := s.core()
		if err != nil {
			http.Error(w, "Studio unavailable", http.StatusServiceUnavailable)
			return
		}
		e.DLSS5PreviewHandler(e.MediaHandler(next)).ServeHTTP(w, r)
	})
}
func (s *StudioV2) SaveAsset(id string) (bool, error) {
	e, err := s.core()
	if err != nil {
		return false, err
	}
	asset, ok := e.Asset(id)
	if !ok {
		return false, errors.New("素材不存在")
	}
	s.mu.Lock()
	ctx := s.ctx
	s.mu.Unlock()
	ext := filepath.Ext(asset.FileName)
	path, err := runtime.SaveFileDialog(ctx, runtime.SaveDialogOptions{Title: "保存作品", DefaultFilename: "xai-" + asset.ID[:8] + ext, Filters: []runtime.FileFilter{{DisplayName: asset.Kind, Pattern: "*" + ext}}})
	if err != nil || path == "" {
		return false, err
	}
	// Stage output next to the destination; do not truncate an existing file until
	// the full copy is successful. The save dialog owns overwrite confirmation.
	f, err := os.CreateTemp(filepath.Dir(path), ".xai-save-*")
	if err != nil {
		return false, err
	}
	tmp := f.Name()
	defer os.Remove(tmp)
	if err = f.Chmod(0600); err == nil {
		err = e.CopyAssetTo(id, f)
	}
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		return false, err
	}
	if err = os.Rename(tmp, path); err != nil {
		return false, err
	}
	return true, nil
}

// Compile-time check: copied assets stream into a writer, not a browser path.
var _ io.Writer = (*os.File)(nil)
