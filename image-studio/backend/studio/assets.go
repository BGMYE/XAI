package studio

import (
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
)

const (
	maxMediaBytes     = 160 * 1024 * 1024
	maxReferenceBytes = 20 * 1024 * 1024
)

var mediaExtensions = map[string]string{
	"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif",
	"video/mp4": ".mp4", "video/webm": ".webm",
}

// storeAsset moves a result into the media directory and returns its metadata.
// It performs all file I/O itself, so callers must not hold the write lock.
func (e *Engine) storeAsset(output Output, name, kind string) (Asset, error) {
	var head []byte
	var size int64
	if output.Path != "" {
		f, err := os.Open(output.Path)
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
	if size == 0 || size > maxMediaBytes {
		return Asset{}, errors.New("素材为空或超过 160 MB")
	}
	mime := http.DetectContentType(head)
	ext, ok := mediaExtensions[mime]
	if !ok || !strings.HasPrefix(mime, kind+"/") {
		return Asset{}, errors.New("上游素材不是支持的图片或视频文件")
	}
	a := Asset{ID: NewID(), Kind: kind, Name: name, MIME: mime, Bytes: size, CreatedAt: now()}
	a.FileName = a.ID + ext
	target := filepath.Join(e.repo.mediaDir(), a.FileName)
	if output.Path != "" {
		// The runner already synced the file in the media directory; the rename
		// is atomic on the same filesystem.
		if err := os.Rename(output.Path, target); err != nil {
			return Asset{}, err
		}
		return a, nil
	}
	if err := atomicWrite(target, output.Data); err != nil {
		return Asset{}, err
	}
	return a, nil
}

func (e *Engine) removeAssetFile(a Asset) {
	if a.ID != "" && safeAsset(a, a.ID) {
		_ = os.Remove(filepath.Join(e.repo.mediaDir(), a.FileName))
	}
}

// discardOutput removes a temporary result file that was not moved into place.
func discardOutput(o Output) {
	if o.Path != "" {
		_ = os.Remove(o.Path)
	}
}

// attachResult records a finished job and appends its result to the canvas
// the job was submitted from, next to the node that produced it.
func attachResult(t *tx, j Job, a Asset) {
	t.putAsset(a)
	j.State = "succeeded"
	j.Progress = 100
	j.Error = ""
	j.ResultAssetID = a.ID
	j.UpdatedAt = now()
	t.putJob(j)
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
	if err = e.update(func(t *tx) error { t.putAsset(a); return nil }); err != nil {
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
