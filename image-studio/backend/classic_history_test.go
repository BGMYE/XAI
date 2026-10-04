package backend

import (
	"context"
	"encoding/json"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"testing"
)

func TestClassicHistoryMigrationPreservesEditingMetadata(t *testing.T) {
	svc := NewService()
	svc.ctx = context.Background()
	svc.studio = openStudioV2(t, &memoryAPIKeyStore{values: map[string]string{}})
	root := t.TempDir()
	path := filepath.Join(imagesSubdir(root), "old.png")
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	if err = png.Encode(f, image.NewNRGBA(image.Rect(0, 0, 2, 2))); err != nil {
		t.Fatal(err)
	}
	f.Close()
	svc.addTrustedOutputRoot(root)
	var item ClassicHistoryInput
	if err = json.Unmarshal([]byte(`{"id":"old-edit","mode":"edit","revisedPrompt":"revised original prompt"}`), &item); err != nil {
		t.Fatal(err)
	}
	item.SavedPath = path
	item.CreatedAt = "2025-01-01T00:00:00Z"
	imported, err := svc.ImportClassicHistory([]ClassicHistoryInput{item})
	if err != nil || len(imported) != 1 || imported[0].Error != "" {
		t.Fatalf("%+v %v", imported, err)
	}
	results, err := svc.GetGenerationHistory()
	if err != nil || len(results) != 1 {
		t.Fatalf("%+v %v", results, err)
	}
	if results[0].Mode != "edit" || results[0].RevisedPrompt != "revised original prompt" {
		t.Fatalf("lost editing metadata: %+v", results[0])
	}
}
