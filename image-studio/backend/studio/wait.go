package studio

import (
	"context"
	"errors"
	"os"
	"path/filepath"
)

// Wait observes durable transitions without polling the database. It also
// returns paused jobs, which require an explicit user decision to resume.
func (e *Engine) Wait(ctx context.Context, id string) (Job, error) {
	for {
		e.writeMu.Lock()
		j, ok := e.cur.Load().doc.Jobs[id]
		changed := e.updates
		e.writeMu.Unlock()
		if !ok {
			return Job{}, errors.New("任务不存在")
		}
		if terminal(j.State) || j.State == "paused" {
			return cloneJob(j), nil
		}
		if err := e.failure(); err != nil {
			return Job{}, err
		}
		select {
		case <-ctx.Done():
			return Job{}, ctx.Err()
		case <-e.ctx.Done():
			return Job{}, context.Canceled
		case <-e.failed:
			return Job{}, e.failure()
		case <-changed:
		}
	}
}

func (e *Engine) AssetPath(id string) (string, error) {
	a, ok := e.Asset(id)
	if !ok {
		return "", errors.New("素材不存在")
	}
	return filepath.Join(e.repo.mediaDir(), a.FileName), nil
}

func (e *Engine) MediaRoot() string { return e.repo.mediaDir() }

func (e *Engine) Job(id string) (Job, bool) {
	j, ok := e.cur.Load().doc.Jobs[id]
	return cloneJob(j), ok
}

func (e *Engine) ReadReference(id string) (Output, error) {
	a, ok := e.Asset(id)
	if !ok || a.Kind != "image" || a.Bytes > maxReferenceBytes {
		return Output{}, errors.New("参考图片不存在或超过 20 MB")
	}
	path, err := e.AssetPath(id)
	if err != nil {
		return Output{}, err
	}
	b, err := os.ReadFile(path)
	return Output{Data: b, MIME: a.MIME}, err
}
