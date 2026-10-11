package studio

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

func TestClassicUsesDurableQueueAndSharedMedia(t *testing.T) {
	var calls atomic.Int32
	e, _, _ := fixture(t, runFunc(func(_ context.Context, j Job, _ string, _ *Output, _ Checkpoint) (Output, error) {
		calls.Add(1)
		if j.Request.Image.Quality != "high" || j.Request.Image.Seed != 42 {
			t.Error("classic options lost")
		}
		return Output{Data: pixel()}, nil
	}))
	r := req("classic-job")
	r.Source = "classic"
	r.ProjectID = "classic"
	r.Image = ImageParameters{Quality: "high", Seed: 42}
	j, err := e.Submit(r)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = e.Submit(r); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second*3)
	defer cancel()
	j, err = e.Wait(ctx, j.ID)
	if err != nil || j.State != "succeeded" {
		t.Fatalf("%+v %v", j, err)
	}
	if calls.Load() != 1 {
		t.Fatalf("submitted %d times", calls.Load())
	}
	if _, ok := e.Asset(j.ResultAssetID); !ok {
		t.Fatal("shared result missing")
	}
	raw, err := os.ReadFile(filepath.Join(e.repo.root, "studio.json"))
	if err != nil {
		t.Fatal(err)
	}
	var d document
	if err = json.Unmarshal(raw, &d); err != nil {
		t.Fatal(err)
	}
	if d.Jobs[j.ID].Request.Image.Seed != 42 {
		t.Fatal("options not persisted")
	}
}

func TestContentAddressedImportDeduplicates(t *testing.T) {
	e, _, _ := fixture(t, nil)
	a, err := e.Import(pixel(), "first.png")
	if err != nil {
		t.Fatal(err)
	}
	b, err := e.Import(pixel(), "second.png")
	if err != nil {
		t.Fatal(err)
	}
	if a.ID != b.ID {
		t.Fatalf("duplicate bytes stored twice: %s %s", a.ID, b.ID)
	}
	if len(a.ID) != 64 {
		t.Fatal("expected sha256 asset id")
	}
}
