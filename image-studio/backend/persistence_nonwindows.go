//go:build !windows

package backend

func WindowsWebviewUserDataPath() (string, error) {
	return "", nil
}

func WindowsLegacyWebviewUserDataPaths() ([]string, error) {
	return nil, nil
}
