//go:build darwin

package backend

import (
	"os"
	"path/filepath"
	"strings"
)

const (
	macCurrentWebkitDirName = "top.gptcodex.imagestudio"
	macLegacyWebkitDirName  = "com.wails.image-studio"
)

func MigrateMacWebkitDataDir() error {
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	root := filepath.Join(home, "Library", "WebKit")
	current := filepath.Join(root, macCurrentWebkitDirName)
	legacy := filepath.Join(root, macLegacyWebkitDirName)
	return migrateMacWebkitDataDirs(current, []string{legacy})
}

func migrateMacWebkitDataDirs(dst string, legacyPaths []string) error {
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
	return copyDir(legacyAbs, dstAbs)
}
