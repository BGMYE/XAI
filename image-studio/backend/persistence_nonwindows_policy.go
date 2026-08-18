//go:build !windows

package backend

import (
	"os"
	"path/filepath"
)

func defaultDocumentsDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return portableFallbackDir(), nil
	}
	return filepath.Join(home, "Documents"), nil
}

func platformDefaultOutputDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return portableFallbackDir(), nil
	}
	return filepath.Join(home, "Pictures", appDocumentDirName), nil
}

func platformStableDataRoot() (string, error) {
	return configDataRoot()
}

func platformLegacyOutputRoots() []string {
	return nil
}

func platformLegacyImportDirs() []string {
	return nil
}
