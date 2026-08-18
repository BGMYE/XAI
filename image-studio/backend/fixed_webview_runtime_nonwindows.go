//go:build !windows

package backend

func WindowsPortableWebviewBrowserPath() (string, error) {
	return "", nil
}

func EnsureWindowsFixedWebviewRuntimePermissions(_ string) error {
	return nil
}
