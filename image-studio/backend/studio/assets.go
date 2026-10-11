package studio

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strings"

	_ "golang.org/x/image/webp"
)

const (
	maxMediaBytes     = 160 * 1024 * 1024
	maxVideoBytes     = int64(16 * 1024 * 1024 * 1024)
	maxReferenceBytes = 20 * 1024 * 1024
)

var mediaExtensions = map[string]string{
	"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif",
	"video/mp4": ".mp4", "video/webm": ".webm",
}

// storeAsset moves a result into the media directory and returns its metadata.
// It performs all file I/O itself, so callers must not hold the write lock.
func (e *Engine) storeAsset(output Output, name, kind string) (Asset, error) {
	// A managed media directory must never redirect imports through a symlink.
	mediaInfo, err := os.Lstat(e.repo.mediaDir())
	if err != nil {
		return Asset{}, err
	}
	if !mediaInfo.IsDir() || mediaInfo.Mode()&os.ModeSymlink != 0 {
		return Asset{}, errors.New("素材目录不是安全的本地目录，未写入文件")
	}
	var head []byte
	var size int64
	if output.Path != "" {
		f, err := openRegularAssetFile(output.Path)
		if err != nil {
			return Asset{}, errors.New("素材文件不可读")
		}
		info, err := f.Stat()
		if err == nil {
			head = make([]byte, 512)
			var n int
			n, err = io.ReadFull(f, head)
			if errors.Is(err, io.ErrUnexpectedEOF) || errors.Is(err, io.EOF) {
				err = nil
			}
			head, size = head[:n], info.Size()
		}
		f.Close()
		if err != nil {
			return Asset{}, errors.New("素材文件不可读")
		}
	} else {
		head, size = output.Data, int64(len(output.Data))
	}
	limit := int64(maxMediaBytes)
	if kind == "video" && output.Path != "" {
		limit = maxVideoBytes
	}
	if size == 0 || size > limit {
		return Asset{}, fmt.Errorf("素材为空或超过 %d MB", limit/(1024*1024))
	}
	mime := http.DetectContentType(head)
	ext, ok := mediaExtensions[mime]
	if !ok || !strings.HasPrefix(mime, kind+"/") {
		return Asset{}, errors.New("上游素材不是支持的图片或视频文件")
	}
	a := Asset{Kind: kind, Name: name, MIME: mime, Bytes: size, CreatedAt: now()}
	if kind == "image" {
		var config image.Config
		var configErr error
		if output.Path != "" {
			f, err := openRegularAssetFile(output.Path)
			if err == nil {
				config, _, configErr = image.DecodeConfig(f)
				f.Close()
			} else {
				configErr = err
			}
		} else {
			config, _, configErr = image.DecodeConfig(bytes.NewReader(output.Data))
		}
		if configErr != nil || config.Width < 1 || config.Height < 1 {
			return Asset{}, errors.New("图片损坏或无法读取原始尺寸")
		}
		a.Width, a.Height = config.Width, config.Height
		a.OriginalWidth, a.OriginalHeight = config.Width, config.Height
	}
	hash := sha256.New()
	if output.Path != "" {
		f, err := openRegularAssetFile(output.Path)
		if err != nil {
			return Asset{}, err
		}
		n, err := io.Copy(hash, io.LimitReader(f, size+1))
		f.Close()
		if err != nil {
			return Asset{}, err
		}
		if n != size {
			return Asset{}, errors.New("导入期间素材文件发生变化，未写入文件")
		}
	} else {
		_, _ = hash.Write(output.Data)
	}
	id := hex.EncodeToString(hash.Sum(nil))
	if existing, ok := e.Asset(id); ok {
		target := filepath.Join(e.repo.mediaDir(), existing.FileName)
		healthy, err := assetFileMatches(target, id, size)
		if err != nil {
			return Asset{}, err
		}
		if !healthy {
			// Index entries outlive a lost or damaged file. Publish the current
			// validated input atomically under the same name, repairing every
			// project/history reference without replacing its asset identity.
			if err := publishAssetFile(output, target); err != nil {
				return Asset{}, err
			}
		}
		existing.DeletedAt = ""
		// Content-derived metadata comes from this validated input; labels,
		// creation time, pinning and the stable file name retain their identity.
		existing.Bytes, existing.MIME = a.Bytes, a.MIME
		if kind == "image" {
			existing.Width, existing.Height = a.Width, a.Height
			existing.OriginalWidth, existing.OriginalHeight = a.OriginalWidth, a.OriginalHeight
		}
		return existing, nil
	}
	a.ID = id

	a.FileName = a.ID + ext
	target := filepath.Join(e.repo.mediaDir(), a.FileName)
	if err := publishAssetFile(output, target); err != nil {
		return Asset{}, err
	}
	return a, nil
}

// Only regular files may be read or replaced. Lstat rejects symlinks (including
// dangling ones); comparing the opened file also catches a replacement during
// the open. I/O errors are surfaced instead of treating an unreadable file as
// corrupt and destructively replacing it.
func openRegularAssetFile(path string) (*os.File, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, errors.New("素材路径不是普通文件，未读取或覆盖")
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	opened, err := f.Stat()
	if err != nil || !opened.Mode().IsRegular() || !os.SameFile(info, opened) {
		f.Close()
		return nil, errors.New("素材路径在读取期间发生变化，未覆盖文件")
	}
	return f, nil
}

func assetFileMatches(path, id string, size int64) (bool, error) {
	f, err := openRegularAssetFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return false, err
	}
	if info.Size() != size {
		return false, nil
	}
	hash := sha256.New()
	n, err := io.Copy(hash, io.LimitReader(f, size+1))
	if err != nil {
		return false, err
	}
	return n == size && hex.EncodeToString(hash.Sum(nil)) == id, nil
}

func publishAssetFile(output Output, target string) error {
	info, err := os.Lstat(target)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err == nil && !info.Mode().IsRegular() {
		return errors.New("素材目标路径不是普通文件，未覆盖")
	}
	if output.Path != "" {
		// The runner already synced the file in the media directory; the rename
		// is atomic on the same filesystem.
		info, err := os.Lstat(output.Path)
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return errors.New("临时素材不是普通文件，未覆盖")
		}
		return os.Rename(output.Path, target)
	}
	return atomicWrite(target, output.Data)
}

func (e *Engine) removeAssetFile(a Asset) {
	if a.ID == "" || !safeAsset(a, a.ID) {
		return
	}
	for _, current := range e.cur.Load().doc.Assets {
		if current.FileName == a.FileName {
			return
		}
	}
	_ = os.Remove(filepath.Join(e.repo.mediaDir(), a.FileName))
}

// discardOutput removes a temporary result file that was not moved into place.
func discardOutput(o Output) {
	for _, image := range o.Images {
		discardOutput(image)
	}
	if o.Path != "" {
		_ = os.Remove(o.Path)
	}
}

// attachResult records a finished job and appends its result to the canvas
// the job was submitted from, next to the node that produced it.
func attachResult(t *tx, j Job, a Asset) {
	j.State, j.Error, j.Progress, j.UpdatedAt = "succeeded", "", 100, now()
	attachResults(t, j, []Asset{a}, []ResultImage{{AssetID: a.ID, Source: "final", Width: a.Width, Height: a.Height}})
}

func attachResults(t *tx, j Job, assets []Asset, results []ResultImage) {
	j.ResultAssetIDs = slices.Clone(j.ResultAssetIDs)
	j.ResultImages = slices.Clone(j.ResultImages)
	if len(j.ResultAssetIDs) == 0 && j.ResultAssetID != "" {
		j.ResultAssetIDs = append(j.ResultAssetIDs, j.ResultAssetID)
	}
	for i, a := range assets {
		if slices.Contains(j.ResultAssetIDs, a.ID) {
			continue
		}
		j.ResultAssetIDs = append(j.ResultAssetIDs, a.ID)
		if i < len(results) {
			j.ResultImages = append(j.ResultImages, results[i])
		}
		attachResultAsset(t, j, a)
	}
	if len(j.ResultImages) == len(j.ResultAssetIDs) {
		sort.SliceStable(j.ResultImages, func(a, b int) bool {
			x, y := j.ResultImages[a].OutputIndex, j.ResultImages[b].OutputIndex
			return x != nil && y != nil && *x < *y
		})
		for i, result := range j.ResultImages {
			j.ResultAssetIDs[i] = result.AssetID
		}
	}
	if len(j.ResultAssetIDs) > 0 {
		j.ResultAssetID = j.ResultAssetIDs[0]
	}
	t.putJob(j)
}

func attachResultAsset(t *tx, j Job, a Asset) {
	if current, exists := t.doc.Assets[a.ID]; exists {
		a.ClassicPinned = current.ClassicPinned
	}
	if j.Request.Source == "classic" {
		a.ClassicPinned = true
	}
	t.putAsset(a)
	if j.Request.Source == "classic" {
		return
	}
	p, ok := t.doc.Projects[j.Request.ProjectID]
	if !ok || len(p.Nodes) >= 2000 || len(p.Edges) >= 4000 {
		return
	}
	x, y := 80.0+float64(len(p.Nodes)%4)*320, 80.0+float64(len(p.Nodes)/4)*280
	sourceExists := false
	for _, n := range p.Nodes {
		if n.ID == j.Request.NodeID {
			x, y = n.X+340, n.Y
			sourceExists = true
		}
	}
	// Keep successive generated outputs visible rather than stacking them.
	for {
		overlap := false
		for _, n := range p.Nodes {
			if x-n.X < 260 && n.X-x < 260 && y-n.Y < 240 && n.Y-y < 240 {
				overlap = true
				break
			}
		}
		if !overlap {
			break
		}
		y += 270
	}
	node := Node{ID: NewID(), Kind: "asset", X: x, Y: y, Title: a.Name, AssetID: a.ID}
	// Clip forces a fresh backing array: the published project must not change.
	p.Nodes = append(slices.Clip(p.Nodes), node)
	if sourceExists {
		p.Edges = append(slices.Clip(p.Edges), Edge{NewID(), j.Request.NodeID, node.ID})
	}
	p.Revision++
	p.UpdatedAt = now()
	t.putProject(p)
}

// Import stores a user-supplied reference image. The file is written before
// the transaction, so a large import never blocks other writers.
func (e *Engine) Import(data []byte, name string) (Asset, error) {
	e.mediaMu.Lock()
	defer e.mediaMu.Unlock()
	if err := e.ready(); err != nil {
		return Asset{}, err
	}
	if len(data) > maxReferenceBytes {
		return Asset{}, errors.New("导入图片最大 20 MB")
	}
	name = filepath.Base(name)
	if len(name) > 200 {
		name = "参考图片"
	}
	a, err := e.storeAsset(Output{Data: data}, name, "image")
	if err != nil {
		return Asset{}, err
	}
	if err = e.update(func(t *tx) error {
		if current, exists := t.doc.Assets[a.ID]; exists {
			a.ClassicPinned = current.ClassicPinned
		}
		t.putAsset(a)
		return nil
	}); err != nil {
		e.removeAssetFile(a)
		return Asset{}, err
	}
	return a, nil
}

// Asset looks up registered media metadata without locking.
func (e *Engine) Asset(id string) (Asset, bool) {
	a, ok := e.cur.Load().doc.Assets[id]
	if !ok || !safeAsset(a, id) {
		return Asset{}, false
	}
	return a, true
}

func safeAsset(a Asset, id string) bool {
	return checkID(id) == nil && a.ID == id && filepath.Base(a.FileName) == a.FileName && strings.HasPrefix(a.FileName, id+".")
}

// MediaHandler serves only opaque, registered IDs, with Range support for video
// seeking. Lookups read the published state, so media requests never wait for
// a running write.
func (e *Engine) MediaHandler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/studio-media/") {
			next.ServeHTTP(w, r)
			return
		}
		if r.Method != "GET" && r.Method != "HEAD" {
			w.Header().Set("Allow", "GET, HEAD")
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		a, ok := e.Asset(strings.TrimPrefix(r.URL.Path, "/studio-media/"))
		if !ok {
			http.NotFound(w, r)
			return
		}
		f, err := os.Open(filepath.Join(e.repo.mediaDir(), a.FileName))
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer f.Close()
		stat, err := f.Stat()
		if err != nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", a.MIME)
		w.Header().Set("X-Content-Type-Options", "nosniff")
		// Asset files are immutable: a given ID always names the same bytes.
		w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
		http.ServeContent(w, r, a.FileName, stat.ModTime(), f)
	})
}

// CopyAssetTo streams a registered asset. The destination comes only from the
// desktop Save dialog; the source is never a path supplied by the browser.
func (e *Engine) CopyAssetTo(id string, dst io.Writer) error {
	a, ok := e.Asset(id)
	if !ok {
		return errors.New("素材不存在")
	}
	f, err := os.Open(filepath.Join(e.repo.mediaDir(), a.FileName))
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = io.Copy(dst, f)
	return err
}
