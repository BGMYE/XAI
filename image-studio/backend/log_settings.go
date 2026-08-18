package backend

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"

	compat "image-studio/shared/compat"
)

func (s *Service) SetKeepLogsEnabled(enabled bool) {
	s.mu.Lock()
	s.keepLogs = enabled
	s.mu.Unlock()
}

func (s *Service) SetCleanupPreviewCacheOnExitEnabled(enabled bool) {
	s.mu.Lock()
	s.cleanupPreviewCacheOnExit = enabled
	s.mu.Unlock()
}

func (s *Service) Shutdown(_ context.Context) {
	if err := cleanupManagedRuntimeArtifacts(s.keepLogsEnabled(), s.cleanupPreviewCacheOnExitEnabled(), s.managedRuntimeCleanupDirs()); err != nil {
		println("Warning:", err.Error())
	}
}

func (s *Service) keepLogsEnabled() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.keepLogs
}

func (s *Service) cleanupPreviewCacheOnExitEnabled() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.cleanupPreviewCacheOnExit
}

func (s *Service) loadCompatibilitySettings() {
	path, err := compatibilityStatePath()
	if err != nil {
		return
	}
	state, err := compat.Load(path)
	if err != nil {
		return
	}
	s.syncCompatibilitySettings(state)
}

func (s *Service) syncCompatibilitySettings(state compat.State) {
	s.SetKeepLogsEnabled(state.Settings.KeepLogs)
	s.SetCleanupPreviewCacheOnExitEnabled(state.Settings.CleanupPreviewCacheOnExit)
	if outputDir := strings.TrimSpace(state.Settings.OutputDir); outputDir != "" {
		if abs, err := filepath.Abs(outputDir); err == nil {
			s.mu.Lock()
			s.outputDir = abs
			s.mu.Unlock()
			s.addTrustedOutputRoot(abs)
		}
	}
	for _, root := range state.Settings.TrustedOutputRoots {
		s.addTrustedOutputRoot(root)
	}
}

func (s *Service) managedLogDirs() []string {
	return normalizeRoots(s.allowedRoots(managedRawLogFile))
}

func (s *Service) managedRuntimeCleanupDirs() []string {
	dirs := make([]string, 0, 16)
	if s.cleanupPreviewCacheOnExitEnabled() {
		for _, root := range s.managedOutputRootsForCleanup() {
			dirs = append(dirs, thumbsSubdir(root), previewsSubdir(root))
		}
		if importsRoot, err := importsDir(); err == nil {
			dirs = append(dirs, previewsSubdir(importsRoot))
		}
	}
	if !s.keepLogsEnabled() {
		dirs = append(dirs, s.managedLogDirs()...)
	}
	return normalizeRoots(dirs)
}

func (s *Service) managedOutputRootsForCleanup() []string {
	roots := make([]string, 0, 8)
	if root, err := defaultOutputDir(); err == nil {
		roots = append(roots, root)
	}
	roots = append(roots, platformLegacyOutputRoots()...)
	if root := s.currentOutputRootSnapshot(); root != "" {
		roots = append(roots, root)
	}
	roots = append(roots, s.trustedOutputRootsSnapshot()...)
	return normalizeRoots(roots)
}

func cleanupLogDirsIfDisabled(keepLogs bool, dirs []string) error {
	if keepLogs {
		return nil
	}
	return removeDirs(dirs)
}

func cleanupManagedRuntimeArtifacts(_ bool, _ bool, dirs []string) error {
	return removeDirs(dirs)
}

func removeDirs(dirs []string) error {
	var firstErr error
	for _, dir := range normalizeRoots(dirs) {
		if strings.TrimSpace(dir) == "" {
			continue
		}
		if err := os.RemoveAll(dir); err != nil && !errors.Is(err, os.ErrNotExist) && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}
