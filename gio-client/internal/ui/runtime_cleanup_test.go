package ui

import (
	"os"
	"path/filepath"
	"testing"

	"image-studio/gio-client/internal/kernel"
	sharedCompat "image-studio/shared/compat"
)

func TestManagedRuntimeCleanupDirsMatchesPreviewAndLogSemantics(t *testing.T) {
	t.Setenv("HOME", t.TempDir())

	state := sharedCompat.State{
		Settings: sharedCompat.Settings{
			OutputDir:          filepath.Join(t.TempDir(), "state-output"),
			TrustedOutputRoots: []string{filepath.Join(t.TempDir(), "trusted-a"), filepath.Join(t.TempDir(), "trusted-b")},
		},
	}
	currentOutputDir := filepath.Join(t.TempDir(), "current-output")
	stableDataRoot := filepath.Join(t.TempDir(), "stable-data")

	got := managedRuntimeCleanupDirs(state, currentOutputDir, stableDataRoot, false, true)
	roots := normalizeCleanupRoots([]string{
		kernel.DefaultOutputDir(),
		state.Settings.OutputDir,
		currentOutputDir,
		state.Settings.TrustedOutputRoots[0],
		state.Settings.TrustedOutputRoots[1],
	})
	want := make([]string, 0, len(roots)*3+1)
	for _, root := range roots {
		want = append(want,
			filepath.Join(root, "thumbs"),
			filepath.Join(root, "previews"),
			filepath.Join(root, "log"),
		)
	}
	want = append(want, filepath.Join(stableDataRoot, "source-previews"))
	want = normalizeCleanupRoots(want)

	if len(got) != len(want) {
		t.Fatalf("managedRuntimeCleanupDirs len=%d want %d: %v", len(got), len(want), got)
	}
	for _, path := range want {
		found := false
		for _, gotPath := range got {
			if gotPath == path {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("missing cleanup path %q in %v", path, got)
		}
	}
	for _, forbidden := range []string{
		kernel.DefaultOutputDir(),
		state.Settings.OutputDir,
		currentOutputDir,
		stableDataRoot,
		filepath.Join(kernel.DefaultOutputDir(), "images"),
		filepath.Join(state.Settings.OutputDir, "images"),
		filepath.Join(currentOutputDir, "images"),
	} {
		for _, gotPath := range got {
			if gotPath == filepath.Clean(forbidden) {
				t.Fatalf("unexpected primary data path scheduled for cleanup: %q", gotPath)
			}
		}
	}
}

func TestManagedRuntimeCleanupDirsKeepsPreviewCachesWhenDisabled(t *testing.T) {
	t.Setenv("HOME", t.TempDir())

	state := sharedCompat.State{
		Settings: sharedCompat.Settings{
			OutputDir: filepath.Join(t.TempDir(), "state-output"),
		},
	}
	got := managedRuntimeCleanupDirs(state, "", filepath.Join(t.TempDir(), "stable-data"), false, false)

	for _, path := range got {
		base := filepath.Base(path)
		if base == "thumbs" || base == "previews" || base == "source-previews" {
			t.Fatalf("unexpected preview cache cleanup path when disabled: %q", path)
		}
	}
	if len(got) == 0 {
		t.Fatal("expected log cleanup paths when keepLogs is disabled")
	}
	for _, path := range got {
		if filepath.Base(path) != "log" {
			t.Fatalf("expected only log cleanup paths when preview cleanup is disabled, got %q", path)
		}
	}
}

func TestRemoveCleanupDirsOnlyRemovesRequestedCaches(t *testing.T) {
	root := t.TempDir()
	thumbsDir := filepath.Join(root, "thumbs")
	previewsDir := filepath.Join(root, "previews")
	imagesDir := filepath.Join(root, "images")
	for _, dir := range []string{thumbsDir, previewsDir, imagesDir} {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			t.Fatalf("mkdir %s: %v", dir, err)
		}
	}
	if err := os.WriteFile(filepath.Join(thumbsDir, "thumb.avif"), []byte("thumb"), 0o600); err != nil {
		t.Fatalf("write thumb: %v", err)
	}
	if err := os.WriteFile(filepath.Join(previewsDir, "preview.avif"), []byte("preview"), 0o600); err != nil {
		t.Fatalf("write preview: %v", err)
	}
	keepImage := filepath.Join(imagesDir, "result.png")
	if err := os.WriteFile(keepImage, []byte("image"), 0o600); err != nil {
		t.Fatalf("write image: %v", err)
	}

	if err := removeCleanupDirs([]string{thumbsDir, previewsDir}); err != nil {
		t.Fatalf("removeCleanupDirs: %v", err)
	}
	for _, dir := range []string{thumbsDir, previewsDir} {
		if _, err := os.Stat(dir); !os.IsNotExist(err) {
			t.Fatalf("expected %s to be removed, got %v", dir, err)
		}
	}
	if _, err := os.Stat(keepImage); err != nil {
		t.Fatalf("expected %s to remain, got %v", keepImage, err)
	}
}
