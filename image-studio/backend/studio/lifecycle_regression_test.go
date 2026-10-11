package studio

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestBatchDeleteIgnoresAlreadyRemovedHistory(t *testing.T) {
	e, _, _ := fixture(t, runFunc(func(context.Context, Job, string, *Output, Checkpoint) (Output, error) {
		return Output{Data: pixel()}, nil
	}))
	if _, err := e.Submit(req("finished")); err != nil {
		t.Fatal(err)
	}
	await(t, e, "finished", "succeeded")
	if err := e.DeleteJobs([]string{"already-removed", "finished", "finished"}); err != nil {
		t.Fatal(err)
	}
	if _, ok := e.Job("finished"); ok {
		t.Fatal("history survived deletion")
	}
	if err := e.DeleteJobs([]string{"finished"}); err != nil {
		t.Fatal(err)
	}
}

func TestClassicCanvasReferencesSurviveHistoryDeletionAndRestart(t *testing.T) {
	e, _, _ := fixture(t, runFunc(func(context.Context, Job, string, *Output, Checkpoint) (Output, error) {
		return Output{Data: pixel()}, nil
	}))
	r := req("classic-result")
	r.Source = "classic"
	r.ProjectID = "classic"
	if _, err := e.Submit(r); err != nil {
		t.Fatal(err)
	}
	job := await(t, e, r.ID, "succeeded")
	if err := e.SetClassicAssetReferences([]string{job.ResultAssetID}); err != nil {
		t.Fatal(err)
	}
	if err := e.DeleteJob(job.ID); err != nil {
		t.Fatal(err)
	}
	e.Close()
	reopened, err := Open(e.repo.root, e.secrets, Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	if err = reopened.TrashAsset(job.ResultAssetID); err == nil {
		t.Fatal("classic canvas reference ignored after restart")
	}
	if err = reopened.SetClassicAssetReferences(nil); err != nil {
		t.Fatal(err)
	}
	if err = reopened.TrashAsset(job.ResultAssetID); err != nil {
		t.Fatal(err)
	}
	if err = reopened.CollectTrash(time.Now().Add(31 * 24 * time.Hour)); err != nil {
		t.Fatal(err)
	}
	if _, ok := reopened.Asset(job.ResultAssetID); ok {
		t.Fatal("unused classic media was not collected")
	}
}

func TestRemovalChangeFeedAndStartupCollection(t *testing.T) {
	e, _, p := fixture(t, nil)
	a, err := e.Import(pixel(), "test.png")
	if err != nil {
		t.Fatal(err)
	}
	if err = e.TrashAsset(a.ID); err != nil {
		t.Fatal(err)
	}
	if err = e.TrashProject(p.ID); err != nil {
		t.Fatal(err)
	}
	before, _ := e.Snapshot()
	if err = e.CollectTrash(time.Now().Add(31 * 24 * time.Hour)); err != nil {
		t.Fatal(err)
	}
	changes, _ := e.Changes(before.Epoch, before.Revision)
	raw, _ := json.Marshal(changes.Removed)
	var removed map[string][]string
	_ = json.Unmarshal(raw, &removed)
	if len(removed["assets"]) != 1 || len(removed["projects"]) != 1 {
		t.Fatalf("missing removals: %s", raw)
	}
	a, err = e.Import(pixel(), "old.png")
	if err != nil {
		t.Fatal(err)
	}
	if err = e.update(func(tx *tx) error {
		a.DeletedAt = time.Now().Add(-31 * 24 * time.Hour).UTC().Format(time.RFC3339Nano)
		tx.putAsset(a)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	orphan := filepath.Join(e.MediaRoot(), "orphan.png")
	if err = os.WriteFile(orphan, pixel(), 0600); err != nil {
		t.Fatal(err)
	}
	old := time.Now().Add(-31 * 24 * time.Hour)
	_ = os.Chtimes(orphan, old, old)
	e.Close()
	reopened, err := Open(e.repo.root, e.secrets, Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	if _, ok := reopened.Asset(a.ID); ok {
		t.Fatal("expired trash survived restart")
	}
	if _, err = os.Stat(orphan); !os.IsNotExist(err) {
		t.Fatal("expired orphan survived collection")
	}
}

func TestReimportRestoresTrashedContent(t *testing.T) {
	e, _, _ := fixture(t, nil)
	a, err := e.Import(pixel(), "one.png")
	if err != nil {
		t.Fatal(err)
	}
	if err = e.TrashAsset(a.ID); err != nil {
		t.Fatal(err)
	}
	restored, err := e.Import(pixel(), "two.png")
	if err != nil {
		t.Fatal(err)
	}
	if restored.ID != a.ID || restored.DeletedAt != "" {
		t.Fatalf("not restored: %+v", restored)
	}
}

func TestWaitReturnsOnFatalPersistenceFailure(t *testing.T) {
	entered := make(chan struct{})
	e, _, _ := fixture(t, runFunc(func(ctx context.Context, _ Job, _ string, _ *Output, _ Checkpoint) (Output, error) {
		close(entered)
		<-ctx.Done()
		return Output{}, ctx.Err()
	}))
	if _, err := e.Submit(req("waiter")); err != nil {
		t.Fatal(err)
	}
	<-entered
	done := make(chan error, 1)
	go func() { _, err := e.Wait(context.Background(), "waiter"); done <- err }()
	time.Sleep(20 * time.Millisecond)
	e.fail(errors.New("disk unavailable"))
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("missing failure")
		}
	case <-time.After(time.Second):
		t.Fatal("waiter did not wake")
	}
}

func TestSharedProfileConcurrencyLimit(t *testing.T) {
	entered := make(chan string, 3)
	release := make(chan struct{})
	e, p, _ := fixture(t, runFunc(func(ctx context.Context, j Job, _ string, _ *Output, _ Checkpoint) (Output, error) {
		entered <- j.ID
		select {
		case <-release:
			return Output{Data: pixel()}, nil
		case <-ctx.Done():
			return Output{}, ctx.Err()
		}
	}))
	p.ConcurrencyLimit = 1
	if _, err := e.SaveProfile(p, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := e.Submit(req("first")); err != nil {
		t.Fatal(err)
	}
	<-entered
	if _, err := e.Submit(req("second")); err != nil {
		t.Fatal(err)
	}
	select {
	case id := <-entered:
		t.Fatalf("concurrency limit ignored by %s", id)
	case <-time.After(80 * time.Millisecond):
	}
	close(release)
	await(t, e, "second", "succeeded")
}
