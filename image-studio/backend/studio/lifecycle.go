package studio

import (
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Reference counts are derived from the durable graph. This avoids a second
// counter that can drift during import, cancellation, or a crash.
func assetReferences(d document) map[string]int {
	refs := map[string]int{}
	for id, asset := range d.Assets {
		if asset.ClassicPinned {
			refs[id]++
		}
	}
	for _, p := range d.PromptCards {
		if p.PreviewAssetID != "" {
			refs[p.PreviewAssetID]++
		}
	}
	for _, p := range d.Projects {
		for _, n := range p.Nodes {
			if n.AssetID != "" {
				refs[n.AssetID]++
			}
		}
	}
	for _, j := range d.Jobs {
		ids := append([]string{j.ResultAssetID, j.Request.ReferenceAssetID, j.Request.MaskAssetID}, j.Request.ReferenceAssetIDs...)
		if j.DLSS5 != nil {
			ids = append(ids, j.DLSS5.SourceAssetID, j.DLSS5.ResultAssetID)
			ids = append(ids, j.DLSS5.ResultAssetIDs...)
		}
		ids = append(ids, j.ResultAssetIDs...)
		ids = append(ids, j.ParentAssetIDs...)
		for _, id := range ids {
			if id != "" {
				refs[id]++
			}
		}
	}
	return refs
}

// The classic workspace lives in the WebView. Persist its shared-media pins so
// collection remains safe before that workspace is opened again after restart.
func (e *Engine) SetClassicAssetReferences(ids []string) error {
	if len(ids) > 10000 {
		return errors.New("经典画布引用数量超限")
	}
	keep := make(map[string]bool, len(ids))
	for _, id := range ids {
		keep[id] = true
	}
	return e.update(func(t *tx) error {
		for id, asset := range t.doc.Assets {
			pinned := keep[id]
			if asset.ClassicPinned == pinned && (!pinned || asset.DeletedAt == "") {
				continue
			}
			asset.ClassicPinned = pinned
			if pinned {
				asset.DeletedAt = ""
			}
			t.putAsset(asset)
		}
		return nil
	})
}

func canDeleteJob(d document, id string) error {
	j, ok := d.Jobs[id]
	if !ok {
		return errors.New("任务不存在")
	}
	if !terminal(j.State) {
		return errors.New("只能删除已结束的任务")
	}
	if activeDLSS5(j) {
		return errors.New("本地视频增强仍在执行，请先等待或取消")
	}
	for _, other := range d.Jobs {
		if !terminal(other.State) {
			for _, dep := range other.DependsOn {
				if dep == id {
					return errors.New("任务仍被待执行的工作流引用")
				}
			}
		}
	}
	return nil
}

func (e *Engine) DeleteJob(id string) error {
	return e.DeleteJobs([]string{id})
}

func (e *Engine) DeleteJobs(ids []string) error {
	return e.update(func(t *tx) error {
		for _, id := range ids {
			if _, exists := t.doc.Jobs[id]; !exists {
				continue
			}
			if e.dlss.runs[id] != nil {
				return errors.New("本地视频处理器尚未退出，请稍后删除")
			}
			if err := canDeleteJob(t.doc, id); err != nil {
				return err
			}
		}
		for _, id := range ids {
			if _, exists := t.doc.Jobs[id]; exists {
				removeJob(t, id)
			}
		}
		return nil
	})
}

func removeJob(t *tx, id string) {
	delete(t.jobs(), id)
	t.touch(colJobs, id, true)
	for _, p := range t.doc.PromptCards {
		if p.SourceJobID == id {
			p.SourceJobID = ""
			p.Revision++
			p.UpdatedAt = now()
			t.putPromptCard(p)
		}
	}
}

func (e *Engine) ArchiveJobs(before time.Time) (string, int, error) {
	path := ""
	count := 0
	err := e.update(func(t *tx) error {
		jobs := []Job{}
		for id, j := range t.doc.Jobs {
			at, err := time.Parse(time.RFC3339Nano, j.UpdatedAt)
			if err == nil && at.Before(before) && e.dlss.runs[id] == nil && canDeleteJob(t.doc, id) == nil {
				jobs = append(jobs, cloneJob(j))
			}
		}
		if len(jobs) == 0 {
			return nil
		}
		data, err := json.Marshal(struct {
			Version int   `json:"version"`
			Jobs    []Job `json:"jobs"`
		}{SchemaVersion, jobs})
		if err != nil {
			return err
		}
		path = filepath.Join(e.repo.root, "jobs-archive-"+time.Now().UTC().Format("20060102T150405")+"-"+NewID()[:8]+".json")
		if err = atomicWrite(path, data); err != nil {
			return err
		}
		for _, j := range jobs {
			removeJob(t, j.ID)
		}
		count = len(jobs)
		return nil
	})
	return path, count, err
}

func (e *Engine) TrashProject(id string) error   { return e.setProjectTrash(id, true) }
func (e *Engine) RestoreProject(id string) error { return e.setProjectTrash(id, false) }
func (e *Engine) setProjectTrash(id string, deleted bool) error {
	return e.update(func(t *tx) error {
		p, ok := t.doc.Projects[id]
		if !ok {
			return errors.New("画布不存在")
		}
		if id == "classic" {
			return errors.New("经典编辑的共享项目不能删除")
		}
		if deleted {
			for _, j := range t.doc.Jobs {
				if j.Request.ProjectID == id && (!terminal(j.State) || activeDLSS5(j) || e.dlss.runs[j.ID] != nil) {
					return errors.New("画布仍有未结束任务，请先取消或完成")
				}
			}
			p.DeletedAt = now()
		} else {
			p.DeletedAt = ""
		}
		p.Revision++
		p.UpdatedAt = now()
		t.putProject(p)
		return nil
	})
}

func (e *Engine) TrashAsset(id string) error   { return e.setAssetTrash(id, true) }
func (e *Engine) RestoreAsset(id string) error { return e.setAssetTrash(id, false) }
func (e *Engine) setAssetTrash(id string, deleted bool) error {
	return e.update(func(t *tx) error {
		a, ok := t.doc.Assets[id]
		if !ok {
			return errors.New("素材不存在")
		}
		if deleted {
			for _, p := range e.dlss.previews {
				if !p.ready && p.sourceAssetID == id {
					return errors.New("素材正在用于本地视频预览，请先取消预览")
				}
			}
			if n := assetReferences(t.doc)[id]; n > 0 {
				return fmt.Errorf("素材仍有 %d 处画布或任务引用，请先移除引用", n)
			}
			a.DeletedAt = now()
		} else {
			a.DeletedAt = ""
		}
		t.putAsset(a)
		return nil
	})
}

// CollectTrash removes metadata first, then unreferenced files. A crash can
// leave an orphan, but can never leave a live record pointing to deleted media.
func (e *Engine) CollectTrash(at time.Time) error {
	e.mediaMu.Lock()
	defer e.mediaMu.Unlock()
	expired := func(value string) bool {
		t, err := time.Parse(time.RFC3339Nano, value)
		return err == nil && t.Before(at.Add(-30*24*time.Hour))
	}
	removed := []Asset{}
	err := e.update(func(t *tx) error {
		for id, p := range t.doc.Projects {
			if expired(p.DeletedAt) {
				if !t.cloned[colProjects] {
					t.doc.Projects = maps.Clone(t.doc.Projects)
					t.cloned[colProjects] = true
				}
				delete(t.doc.Projects, id)
				t.touch(colProjects, id, true)
			}
		}
		refs := assetReferences(t.doc)
		for id, a := range t.doc.Assets {
			if expired(a.DeletedAt) && refs[id] == 0 {
				if !t.cloned[colAssets] {
					t.doc.Assets = maps.Clone(t.doc.Assets)
					t.cloned[colAssets] = true
				}
				delete(t.doc.Assets, id)
				t.touch(colAssets, id, true)
				removed = append(removed, a)
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	for _, a := range removed {
		e.removeAssetFile(a)
	}
	// Only old, unregistered media files are eligible; directories and in-flight
	// temporary files are excluded. A crashed store can leave a file here.
	registered := map[string]bool{}
	for _, a := range e.cur.Load().doc.Assets {
		registered[a.FileName] = true
	}
	entries, err := os.ReadDir(e.repo.mediaDir())
	if err != nil {
		return err
	}
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || entry.Type()&os.ModeSymlink != 0 || registered[name] || strings.HasPrefix(name, ".") {
			continue
		}
		supported := false
		for _, ext := range mediaExtensions {
			if filepath.Ext(name) == ext {
				supported = true
				break
			}
		}
		if !supported {
			continue
		}
		info, err := entry.Info()
		if err == nil && info.ModTime().Before(at.Add(-30*24*time.Hour)) {
			_ = os.Remove(filepath.Join(e.repo.mediaDir(), name))
		}
	}
	return nil
}

func (e *Engine) collectDaily() {
	defer e.wg.Done()
	ticker := time.NewTicker(24 * time.Hour)
	defer ticker.Stop()
	for {
		select {
		case at := <-ticker.C:
			if err := e.CollectTrash(at); err != nil && !e.closed.Load() {
				e.fail(err)
				return
			}
		case <-e.ctx.Done():
			return
		}
	}
}
