//go:build windows

package backend

import (
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

const (
	windowsFixedWebviewEnvName    = "IMAGE_STUDIO_WEBVIEW2_BROWSER_PATH"
	windowsFixedWebviewDirName    = "WebView2FixedRuntime"
	windowsFixedWebviewLegacyName = "webview2-fixed"
	windowsFixedWebviewExeName    = "msedgewebview2.exe"
)

var windowsFixedWebviewACLGrants = []string{
	"*S-1-15-2-2:(OI)(CI)(RX)",
	"*S-1-15-2-1:(OI)(CI)(RX)",
}

// WindowsPortableWebviewBrowserPath returns the directory that contains a
// bundled Fixed Version WebView2 runtime, if one is present next to the app.
func WindowsPortableWebviewBrowserPath() (string, error) {
	candidates, err := windowsFixedWebviewCandidates()
	if err != nil {
		return "", err
	}
	for _, candidate := range candidates {
		resolved, err := resolveWindowsFixedWebviewDir(candidate)
		if err != nil {
			return "", err
		}
		if resolved != "" {
			return resolved, nil
		}
	}
	return "", nil
}

// EnsureWindowsFixedWebviewRuntimePermissions applies the ACLs Microsoft
// requires for unpackaged Win32 apps that ship Fixed Version WebView2.
func EnsureWindowsFixedWebviewRuntimePermissions(runtimeDir string) error {
	runtimeDir = strings.TrimSpace(runtimeDir)
	if runtimeDir == "" {
		return nil
	}
	if _, err := os.Stat(filepath.Join(runtimeDir, windowsFixedWebviewExeName)); err != nil {
		return err
	}

	var failures []string
	for _, grant := range windowsFixedWebviewACLGrants {
		cmd := exec.Command("icacls", runtimeDir, "/grant", grant)
		output, err := cmd.CombinedOutput()
		if err == nil {
			continue
		}
		msg := strings.TrimSpace(string(output))
		if msg == "" {
			msg = err.Error()
		}
		failures = append(failures, fmt.Sprintf("%s: %s", grant, msg))
	}
	if len(failures) > 0 {
		return fmt.Errorf("failed to apply Fixed Version WebView2 ACLs: %s", strings.Join(failures, "; "))
	}
	return nil
}

func windowsFixedWebviewCandidates() ([]string, error) {
	exePath, err := os.Executable()
	if err != nil {
		return nil, err
	}
	exeDir := filepath.Dir(exePath)

	var candidates []string
	add := func(path string) {
		path = strings.TrimSpace(path)
		if path == "" {
			return
		}
		for _, existing := range candidates {
			if strings.EqualFold(filepath.Clean(existing), filepath.Clean(path)) {
				return
			}
		}
		candidates = append(candidates, path)
	}

	add(os.Getenv(windowsFixedWebviewEnvName))
	add(filepath.Join(exeDir, windowsFixedWebviewDirName))
	add(filepath.Join(exeDir, windowsFixedWebviewLegacyName))

	entries, err := os.ReadDir(exeDir)
	if err != nil {
		if os.IsNotExist(err) {
			return candidates, nil
		}
		return nil, err
	}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		name := strings.ToLower(strings.TrimSpace(entry.Name()))
		if strings.HasPrefix(name, "microsoft.webview2.fixedversionruntime.") {
			add(filepath.Join(exeDir, entry.Name()))
		}
	}
	return candidates, nil
}

func resolveWindowsFixedWebviewDir(candidate string) (string, error) {
	candidate = strings.TrimSpace(candidate)
	if candidate == "" {
		return "", nil
	}

	info, err := os.Stat(candidate)
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", err
	}

	if !info.IsDir() {
		if strings.EqualFold(filepath.Base(candidate), windowsFixedWebviewExeName) {
			return filepath.Dir(candidate), nil
		}
		return "", nil
	}

	if fileExists(filepath.Join(candidate, windowsFixedWebviewExeName)) {
		return candidate, nil
	}

	rootDepth := strings.Count(filepath.Clean(candidate), string(os.PathSeparator))
	var resolved string
	walkErr := filepath.WalkDir(candidate, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			if path == candidate {
				return nil
			}
			depth := strings.Count(filepath.Clean(path), string(os.PathSeparator)) - rootDepth
			if depth > 3 {
				return fs.SkipDir
			}
			return nil
		}
		if strings.EqualFold(d.Name(), windowsFixedWebviewExeName) {
			resolved = filepath.Dir(path)
			return fs.SkipAll
		}
		return nil
	})
	if walkErr != nil && walkErr != fs.SkipAll {
		return "", walkErr
	}
	return resolved, nil
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}
