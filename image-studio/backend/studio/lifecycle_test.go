package studio

import (
	"context"
	"os"
	"testing"
	"time"
)

func TestTrashProtectsReferencedMediaAndCanRestore(t *testing.T) {
	e, _, p := fixture(t, nil)
	a, err := e.Import(pixel(), "ref.png")
	if err != nil {
		t.Fatal(err)
	}
	p.Nodes = []Node{{ID: "n", Kind: "asset", AssetID: a.ID}}
	p, err = e.SaveProject(p)
	if err != nil {
		t.Fatal(err)
	}
	if err = e.TrashAsset(a.ID); err == nil {
		t.Fatal("referenced media deleted")
	}
	if err = e.TrashProject(p.ID); err != nil {
		t.Fatal(err)
	}
	if err = e.TrashAsset(a.ID); err == nil {
		t.Fatal("trash restore would lose media")
	}
	if err = e.RestoreProject(p.ID); err != nil {
		t.Fatal(err)
	}
	p.Nodes = nil
	p.Revision++
	// Reload the revision because soft delete and restore are durable edits.
	s, _ := e.Snapshot()
	for _, current := range s.Projects {
		if current.ID == p.ID {
			p.Revision = current.Revision
		}
	}
	if _, err = e.SaveProject(p); err != nil {
		t.Fatal(err)
	}
	if err = e.TrashAsset(a.ID); err != nil {
		t.Fatal(err)
	}
	if err = e.CollectTrash(time.Now()); err != nil {
		t.Fatal(err)
	}
	if _, err = e.AssetPath(a.ID); err != nil {
		t.Fatal("collected before 30 days")
	}
	if err = e.RestoreAsset(a.ID); err != nil {
		t.Fatal(err)
	}
	if err = e.TrashAsset(a.ID); err != nil {
		t.Fatal(err)
	}
	path, _ := e.AssetPath(a.ID)
	if err = e.CollectTrash(time.Now().Add(31 * 24 * time.Hour)); err != nil {
		t.Fatal(err)
	}
	if _, ok := e.Asset(a.ID); ok {
		t.Fatal("trash metadata not collected")
	}
	if _, err = os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("trash file not collected")
	}
}

func TestDeleteJobsRejectsActiveAndArchivesTerminal(t *testing.T) {
	e, _, _ := fixture(t, runFunc(func(ctx context.Context, _ Job, _ string, _ *Output, _ Checkpoint) (Output, error) {
		<-ctx.Done()
		return Output{}, ctx.Err()
	}))
	j, err := e.Submit(req("active"))
	if err != nil {
		t.Fatal(err)
	}
	if err = e.DeleteJob(j.ID); err == nil {
		t.Fatal("active job deleted")
	}
	if err = e.Cancel(j.ID); err != nil {
		t.Fatal(err)
	}
	path, count, err := e.ArchiveJobs(time.Now().Add(time.Hour))
	if err != nil || count != 1 {
		t.Fatalf("%s %d %v", path, count, err)
	}
	if _, err = os.Stat(path); err != nil {
		t.Fatal(err)
	}
	if _, ok := e.Job(j.ID); ok {
		t.Fatal("archived job remained")
	}
}
