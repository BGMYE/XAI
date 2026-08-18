package backend

import (
	"os/exec"
	"runtime"
)

// openInExplorer opens the given path in the OS file explorer.
func openInExplorer(path string) error {
	switch runtime.GOOS {
	case "windows":
		return exec.Command("explorer", path).Start()
	case "darwin":
		return exec.Command("open", path).Start()
	default:
		return exec.Command("xdg-open", path).Start()
	}
}
