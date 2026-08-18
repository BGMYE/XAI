//go:build windows

package backend

import (
	"os"
	"path/filepath"
	"strings"
)

const windowsWebviewMigrationMarker = ".migrated-to-image-studio-documents"

func MigrateWindowsWebviewDataDir(dst, legacy string) error {
	return MigrateWindowsWebviewDataDirs(dst, []string{legacy})
}

func MigrateWindowsWebviewDataDirs(dst string, legacyPaths []string) error {
	dst = strings.TrimSpace(dst)
	if dst == "" || len(legacyPaths) == 0 {
		return nil
	}
	dstAbs, err := filepath.Abs(dst)
	if err != nil {
		return err
	}
	candidates := webviewMigrationCandidates(dstAbs, legacyPaths)
	if len(candidates) == 0 {
		return nil
	}
	if dirExists(dstAbs) {
		dstScore := imageStudioWebviewProfileScore(dstAbs)
		if dstScore >= candidates[0].score {
			return nil
		}
		if dstScore > 0 {
			return nil
		}
		if err := moveAsideEmptyWebviewProfile(dstAbs); err != nil {
			return err
		}
	}
	legacyAbs := candidates[0].path
	if err := os.MkdirAll(filepath.Dir(dstAbs), secureDirMode); err != nil {
		return err
	}
	if err := os.Rename(legacyAbs, dstAbs); err == nil {
		return nil
	}
	if err := copyDir(legacyAbs, dstAbs); err != nil {
		return err
	}
	marker := filepath.Join(legacyAbs, windowsWebviewMigrationMarker)
	return os.WriteFile(marker, []byte(dstAbs), secureFileMode)
}
