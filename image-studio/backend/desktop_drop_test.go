package backend

import (
	"bytes"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func desktopDropPNG(t *testing.T, path string) []byte {
	t.Helper()
	var data bytes.Buffer
	if err := png.Encode(&data, image.NewRGBA(image.Rect(0, 0, 3, 2))); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data.Bytes(), 0600); err != nil {
		t.Fatal(err)
	}
	return data.Bytes()
}

func TestDesktopDropCopiesIntoManagedImports(t *testing.T) {
	root := t.TempDir()
	t.Setenv("IMAGE_STUDIO_DATA_ROOT", filepath.Join(root, "application"))
	source := filepath.Join(root, "reference.jpg")
	original := desktopDropPNG(t, source)
	result := ImportDesktopDroppedImages([]string{source, source})
	if len(result.Errors) != 0 || len(result.Images) != 1 {
		t.Fatalf("drop result: %+v", result)
	}
	item := result.Images[0]
	dir, err := importsDir()
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Dir(item.Path) != dir || filepath.Ext(item.Path) != ".png" || item.Name != "reference.jpg" || item.Width != 3 || item.Height != 2 || item.Size != int64(len(original)) {
		t.Fatalf("unexpected managed image: %+v", item)
	}
	if err := os.WriteFile(source, []byte("changed original"), 0600); err != nil {
		t.Fatal(err)
	}
	copy, err := os.ReadFile(item.Path)
	if err != nil || !bytes.Equal(copy, original) {
		t.Fatalf("managed copy changed with source: %v", err)
	}
	if _, err := NewService().ensureManagedReadablePath(item.Path, managedImageFile); err != nil {
		t.Fatalf("copy is not managed: %v", err)
	}
	if _, exposed := reflect.TypeOf(NewService()).MethodByName("ImportDesktopDroppedImages"); exposed {
		t.Fatal("native drop paths must not become a bound Service method")
	}
}

func TestDesktopDropRejectsInvalidFilesAndContinuesBatch(t *testing.T) {
	root := t.TempDir()
	t.Setenv("IMAGE_STUDIO_DATA_ROOT", filepath.Join(root, "application"))
	valid := filepath.Join(root, "valid.png")
	desktopDropPNG(t, valid)
	invalid := filepath.Join(root, "private.png")
	if err := os.WriteFile(invalid, []byte("private non-image content"), 0600); err != nil {
		t.Fatal(err)
	}
	large := filepath.Join(root, "large.png")
	f, err := os.Create(large)
	if err != nil {
		t.Fatal(err)
	}
	if err := f.Truncate(maxImageSnapshotBytes + 1); err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
	result := ImportDesktopDroppedImages([]string{invalid, root, large, "relative.png", valid})
	if len(result.Images) != 1 || len(result.Errors) != 4 {
		t.Fatalf("expected only the valid image: %+v", result)
	}
	for _, message := range result.Errors {
		if strings.Contains(message, root) || strings.Contains(message, "private non-image content") {
			t.Fatalf("error exposes local content or absolute path: %q", message)
		}
	}
}

func TestDesktopDropRepeatedNameNeverOverwritesExistingImport(t *testing.T) {
	t.Setenv("IMAGE_STUDIO_DATA_ROOT", t.TempDir())
	source := filepath.Join(t.TempDir(), "same.png")
	desktopDropPNG(t, source)
	first, second := ImportDesktopDroppedImages([]string{source}), ImportDesktopDroppedImages([]string{source})
	if len(first.Images) != 1 || len(second.Images) != 1 || first.Images[0].Path == second.Images[0].Path {
		t.Fatalf("repeated import overwrote the existing file: %+v / %+v", first, second)
	}
}
