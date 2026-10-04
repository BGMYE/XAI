package studio

import (
	"os"
	"path/filepath"
	"testing"
)

func TestHistoryImportKeepsSourceAndIsIdempotent(t *testing.T) {
	e, _, _ := fixture(t, nil)
	source := filepath.Join(t.TempDir(), "old.png")
	if err := os.WriteFile(source, pixel(), 0600); err != nil {
		t.Fatal(err)
	}
	r := Request{ID: "legacy-one", Source: "classic", ProjectID: "classic", Kind: "image", Prompt: "old work"}
	first, err := e.ImportHistory(source, r, "2025-01-01T00:00:00Z", "edit", "revised")
	if err != nil {
		t.Fatal(err)
	}
	second, err := e.ImportHistory(source, r, "2025-01-01T00:00:00Z", "edit", "revised")
	if err != nil {
		t.Fatal(err)
	}
	if first.ID != second.ID || first.ResultAssetID != second.ResultAssetID {
		t.Fatal("duplicate import")
	}
	if _, err = os.Stat(source); err != nil {
		t.Fatal("original output removed")
	}
}
