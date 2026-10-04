package studio

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"time"
)

// ImportHistory copies an old output into the shared library. The source is
// retained for rollback. The stable ID supplied by the host makes repeats safe.
func (e *Engine) ImportHistory(path string, r Request, createdAt, mode, revisedPrompt string) (Job, error) {
	if err := checkID(r.ID); err != nil {
		return Job{}, err
	}
	if old, ok := e.Job(r.ID); ok {
		return old, nil
	}
	if mode != "" && mode != "generate" && mode != "edit" {
		return Job{}, errors.New("历史生成模式无效")
	}
	if len(revisedPrompt) > 64000 {
		return Job{}, errors.New("历史改写提示词过长")
	}
	e.mediaMu.Lock()
	defer e.mediaMu.Unlock()
	f, err := os.Open(path)
	if err != nil {
		return Job{}, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return Job{}, err
	}
	if !info.Mode().IsRegular() || info.Size() > maxMediaBytes {
		return Job{}, errors.New("历史图片过大或不是文件")
	}
	tmp, err := os.CreateTemp(e.repo.mediaDir(), ".incoming-history-*")
	if err != nil {
		return Job{}, err
	}
	defer os.Remove(tmp.Name())
	_, err = io.Copy(tmp, io.LimitReader(f, maxMediaBytes+1))
	if err == nil {
		err = tmp.Sync()
	}
	closeErr := tmp.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		return Job{}, err
	}
	a, err := e.storeAsset(Output{Path: tmp.Name()}, filepath.Base(path), "image")
	if err != nil {
		return Job{}, err
	}
	if _, err = time.Parse(time.RFC3339Nano, createdAt); err != nil {
		createdAt = now()
	}
	j := Job{ID: r.ID, Request: r, HistoryMode: mode, RevisedPrompt: revisedPrompt, Profile: Profile{Name: "经典历史导入"}, State: "succeeded", Progress: 100, ResultAssetID: a.ID, CreatedAt: createdAt, UpdatedAt: createdAt, Fingerprint: fingerprint(r, nil)}
	err = e.update(func(t *tx) error {
		if old, ok := t.doc.Jobs[r.ID]; ok {
			j = old
			return nil
		}
		if len(t.doc.Jobs) >= 10000 {
			return errors.New("请先归档任务，再导入更多旧历史")
		}
		if _, ok := t.doc.Projects["classic"]; !ok {
			t.putProject(Project{ID: "classic", Name: "经典编辑", Viewport: Viewport{Zoom: 1}, Revision: 1, UpdatedAt: now()})
		}
		if current, exists := t.doc.Assets[a.ID]; exists {
			a.ClassicPinned = current.ClassicPinned
		}
		t.putAsset(a)
		t.putJob(j)
		return nil
	})
	if err != nil {
		e.removeAssetFile(a)
	}
	return j, err
}
