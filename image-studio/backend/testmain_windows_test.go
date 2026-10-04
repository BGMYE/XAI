//go:build windows

package backend

import (
	"fmt"
	"golang.org/x/sys/windows/registry"
	"os"
	"path/filepath"
	"testing"
)

// Cleanup and migration tests must never use a developer's real output roots.
func TestMain(m *testing.M) {
	root, err := os.MkdirTemp("", "xai-backend-tests-")
	if err != nil {
		panic(err)
	}
	windowsRegistryPath = fmt.Sprintf(`Software\YuanHua\Image Studio Tests\%d`, os.Getpid())
	for _, key := range []string{"HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "XDG_CONFIG_HOME"} {
		_ = os.Setenv(key, root)
	}
	if err = writeWindowsRegistryDataRoot(filepath.Join(root, "outputs")); err != nil {
		panic(err)
	}
	code := m.Run()
	_ = registry.DeleteKey(registry.CURRENT_USER, windowsRegistryPath)
	_ = os.RemoveAll(root)
	os.Exit(code)
}
