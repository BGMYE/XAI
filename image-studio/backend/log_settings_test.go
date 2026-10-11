package backend

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	compat "image-studio/shared/compat"
)

func TestSyncCompatibilitySettingsTracksKeepLogsAndRoots(t *testing.T) {
	svc := NewService()
	outputRoot := filepath.Join(t.TempDir(), "output")
	trustedRoot := filepath.Join(t.TempDir(), "trusted")

	svc.syncCompatibilitySettings(compat.State{
		Settings: compat.Settings{
			OutputDir:                 outputRoot,
			TrustedOutputRoots:        []string{trustedRoot},
			KeepLogs:                  true,
			CleanupPreviewCacheOnExit: true,
		},
	})

	if !svc.keepLogsEnabled() {
		t.Fatal("expected keepLogs to be enabled")
	}
	if !svc.cleanupPreviewCacheOnExitEnabled() {
		t.Fatal("expected cleanupPreviewCacheOnExit to be enabled")
	}
	if got := svc.currentOutputRootSnapshot(); got != outputRoot {
		t.Fatalf("currentOutputRootSnapshot() = %q, want %q", got, outputRoot)
	}
	roots := svc.trustedOutputRootsSnapshot()
	if len(roots) != 2 {
		t.Fatalf("trustedOutputRootsSnapshot() len = %d, want 2 (%v)", len(roots), roots)
	}
}

func TestCleanupLogDirsIfDisabledRemovesLogDirectories(t *testing.T) {
	logA := filepath.Join(t.TempDir(), "a", "log")
	logB := filepath.Join(t.TempDir(), "b", "log")
	if err := os.MkdirAll(logA, secureDirMode); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(logB, secureDirMode); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(logA, "raw.txt"), []byte("raw"), secureFileMode); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(logB, "raw.json"), []byte("{}"), secureFileMode); err != nil {
		t.Fatal(err)
	}

	if err := cleanupLogDirsIfDisabled(false, []string{logA, logB}); err != nil {
		t.Fatalf("cleanupLogDirsIfDisabled() error = %v", err)
	}
	if _, err := os.Stat(logA); !os.IsNotExist(err) {
		t.Fatalf("expected %s to be removed, got %v", logA, err)
	}
	if _, err := os.Stat(logB); !os.IsNotExist(err) {
		t.Fatalf("expected %s to be removed, got %v", logB, err)
	}
}

func TestCleanupLogDirsIfDisabledLeavesLogsWhenEnabled(t *testing.T) {
	logDir := filepath.Join(t.TempDir(), "log")
	if err := os.MkdirAll(logDir, secureDirMode); err != nil {
		t.Fatal(err)
	}
	logFile := filepath.Join(logDir, "raw.txt")
	if err := os.WriteFile(logFile, []byte("raw"), secureFileMode); err != nil {
		t.Fatal(err)
	}

	if err := cleanupLogDirsIfDisabled(true, []string{logDir}); err != nil {
		t.Fatalf("cleanupLogDirsIfDisabled() error = %v", err)
	}
	if _, err := os.Stat(logFile); err != nil {
		t.Fatalf("expected %s to remain, got %v", logFile, err)
	}
}

func TestManagedRuntimeCleanupDirsPreservePrimaryImageData(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	svc := NewService()
	outputRoot := filepath.Join(t.TempDir(), "output")
	trustedRoot := filepath.Join(t.TempDir(), "trusted")
	svc.addTrustedOutputRoot(trustedRoot)
	if err := svc.SetOutputDir(outputRoot); err != nil {
		t.Fatal(err)
	}
	svc.SetKeepLogsEnabled(false)
	svc.SetCleanupPreviewCacheOnExitEnabled(true)
	for _, dir := range []string{outputRoot, trustedRoot} {
		if err := os.MkdirAll(dir, secureDirMode); err != nil {
			t.Fatal(err)
		}
	}

	importRoot, err := importsDir()
	if err != nil {
		t.Fatal(err)
	}
	defaultRoot, err := defaultOutputDir()
	if err != nil {
		t.Fatal(err)
	}
	normalizedOutputRoots := normalizeRoots([]string{defaultRoot, outputRoot, trustedRoot})
	for _, root := range normalizedOutputRoots {
		for _, dir := range []string{thumbsSubdir(root), previewsSubdir(root), logSubdir(root)} {
			if err := os.MkdirAll(dir, secureDirMode); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := os.MkdirAll(previewsSubdir(importRoot), secureDirMode); err != nil {
		t.Fatal(err)
	}
	wantDirs := make([]string, 0, len(normalizedOutputRoots)*3+1)
	for _, root := range normalizedOutputRoots {
		wantDirs = append(wantDirs, thumbsSubdir(root), previewsSubdir(root), logSubdir(root))
	}
	wantDirs = append(wantDirs, normalizeRoots([]string{previewsSubdir(importRoot)})...)
	wantDirs = normalizeRoots(wantDirs)
	gotDirs := svc.managedRuntimeCleanupDirs()
	if len(gotDirs) != len(wantDirs) {
		t.Fatalf("managedRuntimeCleanupDirs len = %d, want %d (%v)", len(gotDirs), len(wantDirs), gotDirs)
	}
	for _, want := range wantDirs {
		found := false
		for _, got := range gotDirs {
			if got == want {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("missing cleanup dir %q in %v", want, gotDirs)
		}
	}
	for _, forbidden := range []string{
		imagesSubdir(defaultRoot),
		imagesSubdir(outputRoot),
		imagesSubdir(trustedRoot),
		importRoot,
	} {
		for _, got := range gotDirs {
			if got == forbidden {
				t.Fatalf("unexpected primary data dir scheduled for cleanup: %q", forbidden)
			}
		}
	}
}

func TestShutdownRemovesOnlyManagedRuntimeCaches(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	svc := NewService()
	outputRoot := filepath.Join(t.TempDir(), "output")
	if err := svc.SetOutputDir(outputRoot); err != nil {
		t.Fatal(err)
	}
	svc.SetKeepLogsEnabled(false)
	svc.SetCleanupPreviewCacheOnExitEnabled(true)

	importRoot, err := importsDir()
	if err != nil {
		t.Fatal(err)
	}
	imagesDir := imagesSubdir(outputRoot)
	thumbsDir := thumbsSubdir(outputRoot)
	previewsDir := previewsSubdir(outputRoot)
	logDir := logSubdir(outputRoot)
	importPreviewDir := previewsSubdir(importRoot)
	for _, dir := range []string{imagesDir, thumbsDir, previewsDir, logDir, importRoot, importPreviewDir} {
		if err := os.MkdirAll(dir, secureDirMode); err != nil {
			t.Fatal(err)
		}
	}
	keepImage := filepath.Join(imagesDir, "keep.png")
	keepImport := filepath.Join(importRoot, "source.png")
	for _, path := range []string{
		keepImage,
		keepImport,
		filepath.Join(thumbsDir, "thumb.avif"),
		filepath.Join(previewsDir, "preview.avif"),
		filepath.Join(logDir, "raw.txt"),
		filepath.Join(importPreviewDir, "import.avif"),
	} {
		if err := os.WriteFile(path, []byte("x"), secureFileMode); err != nil {
			t.Fatal(err)
		}
	}

	svc.Shutdown(context.Background())

	for _, path := range []string{keepImage, keepImport} {
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("expected %s to remain, got %v", path, err)
		}
	}
	for _, dir := range []string{thumbsDir, previewsDir, logDir, importPreviewDir} {
		if _, err := os.Stat(dir); !os.IsNotExist(err) {
			t.Fatalf("expected %s to be removed, got %v", dir, err)
		}
	}
}

func TestShutdownLeavesPreviewCachesWhenCleanupDisabled(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	svc := NewService()
	outputRoot := filepath.Join(t.TempDir(), "output")
	if err := svc.SetOutputDir(outputRoot); err != nil {
		t.Fatal(err)
	}
	svc.SetKeepLogsEnabled(false)
	svc.SetCleanupPreviewCacheOnExitEnabled(false)

	importRoot, err := importsDir()
	if err != nil {
		t.Fatal(err)
	}
	thumbsDir := thumbsSubdir(outputRoot)
	previewsDir := previewsSubdir(outputRoot)
	importPreviewDir := previewsSubdir(importRoot)
	logDir := logSubdir(outputRoot)
	for _, dir := range []string{thumbsDir, previewsDir, importPreviewDir, logDir} {
		if err := os.MkdirAll(dir, secureDirMode); err != nil {
			t.Fatal(err)
		}
	}
	thumbFile := filepath.Join(thumbsDir, "thumb.avif")
	previewFile := filepath.Join(previewsDir, "preview.avif")
	importPreviewFile := filepath.Join(importPreviewDir, "import.avif")
	logFile := filepath.Join(logDir, "raw.txt")
	for _, path := range []string{thumbFile, previewFile, importPreviewFile, logFile} {
		if err := os.WriteFile(path, []byte("x"), secureFileMode); err != nil {
			t.Fatal(err)
		}
	}

	svc.Shutdown(context.Background())

	for _, path := range []string{thumbFile, previewFile, importPreviewFile} {
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("expected %s to remain when preview cleanup is disabled, got %v", path, err)
		}
	}
	if _, err := os.Stat(logDir); !os.IsNotExist(err) {
		t.Fatalf("expected %s to be removed, got %v", logDir, err)
	}
}
