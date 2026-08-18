package backend

import (
	"os"
	"path/filepath"
)

func portableFallbackDir() string {
	return filepath.Join(".", "image-studio-output")
}

func documentsDataRoot() (string, error) {
	docs, err := defaultDocumentsDir()
	if err != nil {
		return portableFallbackDir(), nil
	}
	return filepath.Join(docs, appDocumentDirName), nil
}

func configDataRoot() (string, error) {
	cfg, err := os.UserConfigDir()
	if err != nil {
		return portableFallbackDir(), nil
	}
	return filepath.Join(cfg, appConfigDirName), nil
}

// defaultOutputDir returns the output root, without the images/log subdirs.
//
// Windows stores generated artifacts under the user's Documents folder. The
// WebView2 profile is anchored to the same root, so renaming the executable
// does not move IndexedDB/localStorage-backed history.
func defaultOutputDir() (string, error) {
	return platformDefaultOutputDir()
}

// importsDir holds dropped/pasted source files plus rotate/flip/crop
// derivatives. It intentionally shares the stable app data root with history.
func importsDir() (string, error) {
	root, err := platformStableDataRoot()
	if err != nil {
		return filepath.Join(portableFallbackDir(), "imports"), nil
	}
	return filepath.Join(root, "imports"), nil
}
