//go:build windows

package backend

import (
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

const (
	windowsRegistryPath            = `Software\` + appCompanyName + `\` + appProductName
	windowsRegistryDataRootValue   = "DataRoot"
	windowsRegistrySchemaValue     = "DataRootSchema"
	windowsRegistrySchemaVersion   = uint32(1)
	windowsLegacyWebviewDirEnvName = "IMAGE_STUDIO_LEGACY_WEBVIEW_DIR"
	windowsDefaultExecutableName   = "image-studio.exe"
)

func defaultDocumentsDir() (string, error) {
	dir, err := windows.KnownFolderPath(windows.FOLDERID_Documents, windows.KF_FLAG_DEFAULT)
	if err == nil && strings.TrimSpace(dir) != "" {
		return dir, nil
	}
	home, homeErr := os.UserHomeDir()
	if homeErr != nil {
		return portableFallbackDir(), nil
	}
	return filepath.Join(home, "Documents"), nil
}

func platformDefaultOutputDir() (string, error) {
	root, err := windowsPersistentDataRoot()
	if err != nil {
		return portableFallbackDir(), nil
	}
	return root, nil
}

func platformStableDataRoot() (string, error) {
	return windowsPersistentDataRoot()
}

func platformLegacyOutputRoots() []string {
	root, err := configDataRoot()
	if err != nil {
		return nil
	}
	return []string{root}
}

func platformLegacyImportDirs() []string {
	root, err := configDataRoot()
	if err != nil {
		return nil
	}
	return []string{filepath.Join(root, "imports")}
}

func WindowsWebviewUserDataPath() (string, error) {
	root, err := windowsPersistentDataRoot()
	if err != nil {
		return "", err
	}
	return filepath.Join(root, "webview"), nil
}

func WindowsLegacyWebviewUserDataPaths() ([]string, error) {
	if override := strings.TrimSpace(os.Getenv(windowsLegacyWebviewDirEnvName)); override != "" {
		return []string{override}, nil
	}
	cfg, err := os.UserConfigDir()
	if err != nil {
		return nil, err
	}
	paths := make([]string, 0, 16)
	add := func(path string) { paths = appendUniquePath(paths, path) }
	add(filepath.Join(cfg, windowsDefaultExecutableName))
	if exe, err := os.Executable(); err == nil {
		name := strings.TrimSpace(filepath.Base(exe))
		if name != "" && !strings.EqualFold(name, windowsDefaultExecutableName) {
			add(filepath.Join(cfg, name))
		}
	}
	entries, err := os.ReadDir(cfg)
	if err == nil {
		for _, entry := range entries {
			if !entry.IsDir() {
				continue
			}
			name := strings.TrimSpace(entry.Name())
			if !strings.HasSuffix(strings.ToLower(name), ".exe") {
				continue
			}
			add(filepath.Join(cfg, name))
		}
	}
	return paths, nil
}

func appendUniquePath(paths []string, path string) []string {
	path = strings.TrimSpace(path)
	if path == "" {
		return paths
	}
	for _, existing := range paths {
		if strings.EqualFold(filepath.Clean(existing), filepath.Clean(path)) {
			return paths
		}
	}
	return append(paths, path)
}

func windowsPersistentDataRoot() (string, error) {
	if root, err := readWindowsRegistryDataRoot(); err == nil && strings.TrimSpace(root) != "" {
		if err := os.MkdirAll(root, secureDirMode); err != nil {
			return "", err
		}
		return root, nil
	}
	root, err := documentsDataRoot()
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(root, secureDirMode); err != nil {
		return "", err
	}
	if err := writeWindowsRegistryDataRoot(root); err != nil {
		return root, err
	}
	return root, nil
}

func readWindowsRegistryDataRoot() (string, error) {
	key, err := registry.OpenKey(registry.CURRENT_USER, windowsRegistryPath, registry.QUERY_VALUE)
	if err != nil {
		return "", err
	}
	defer key.Close()
	value, _, err := key.GetStringValue(windowsRegistryDataRootValue)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(value), nil
}

func writeWindowsRegistryDataRoot(root string) error {
	key, _, err := registry.CreateKey(registry.CURRENT_USER, windowsRegistryPath, registry.QUERY_VALUE|registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer key.Close()
	if err := key.SetStringValue(windowsRegistryDataRootValue, root); err != nil {
		return err
	}
	return key.SetDWordValue(windowsRegistrySchemaValue, windowsRegistrySchemaVersion)
}
