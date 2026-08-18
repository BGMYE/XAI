package ui

import (
	"errors"
	"os"
	"path/filepath"
	"strings"

	gioCompat "image-studio/gio-client/internal/compat"
	"image-studio/gio-client/internal/kernel"
	sharedCompat "image-studio/shared/compat"
)

func normalizeCleanupRoots(roots []string) []string {
	out := make([]string, 0, len(roots))
	seen := map[string]struct{}{}
	for _, root := range roots {
		root = strings.TrimSpace(root)
		if root == "" {
			continue
		}
		abs, err := filepath.Abs(root)
		if err == nil {
			root = abs
		}
		root = filepath.Clean(root)
		if _, ok := seen[root]; ok {
			continue
		}
		seen[root] = struct{}{}
		out = append(out, root)
	}
	return out
}

func managedOutputRootsForCleanup(state sharedCompat.State, currentOutputDir string) []string {
	roots := []string{kernel.DefaultOutputDir()}
	if outputDir := strings.TrimSpace(state.Settings.OutputDir); outputDir != "" {
		roots = append(roots, outputDir)
	}
	if outputDir := strings.TrimSpace(currentOutputDir); outputDir != "" {
		roots = append(roots, outputDir)
	}
	roots = append(roots, state.Settings.TrustedOutputRoots...)
	return normalizeCleanupRoots(roots)
}

func managedRuntimeCleanupDirs(state sharedCompat.State, currentOutputDir string, stableDataRoot string, keepLogs bool, cleanupPreviewCacheOnExit bool) []string {
	roots := managedOutputRootsForCleanup(state, currentOutputDir)
	dirs := make([]string, 0, len(roots)*3+1)
	if cleanupPreviewCacheOnExit {
		for _, root := range roots {
			dirs = append(dirs, filepath.Join(root, "thumbs"), filepath.Join(root, "previews"))
		}
		if strings.TrimSpace(stableDataRoot) != "" {
			dirs = append(dirs, filepath.Join(stableDataRoot, "source-previews"))
		}
	}
	if !keepLogs {
		for _, root := range roots {
			dirs = append(dirs, filepath.Join(root, "log"))
		}
	}
	return normalizeCleanupRoots(dirs)
}

func removeCleanupDirs(dirs []string) error {
	var firstErr error
	for _, dir := range normalizeCleanupRoots(dirs) {
		if strings.TrimSpace(dir) == "" {
			continue
		}
		if err := os.RemoveAll(dir); err != nil && !errors.Is(err, os.ErrNotExist) && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}

func (a *App) cleanupRuntimeArtifactsOnExit() {
	state, _, err := gioCompat.LoadState()
	if err != nil {
		return
	}
	state = sharedCompat.Normalize(state)
	a.mu.Lock()
	keepLogs := a.keepLogs
	cleanupPreviewCacheOnExit := a.cleanupPreviewCacheOnExit
	currentOutputDir := strings.TrimSpace(a.outputDirInput.Text())
	a.mu.Unlock()
	stableDataRoot, err := gioCompat.StableDataRoot()
	if err != nil {
		stableDataRoot = ""
	}
	dirs := managedRuntimeCleanupDirs(state, currentOutputDir, stableDataRoot, keepLogs, cleanupPreviewCacheOnExit)
	if err := removeCleanupDirs(dirs); err != nil {
		a.appendLog("退出清理运行时缓存失败: " + err.Error())
	}
}
