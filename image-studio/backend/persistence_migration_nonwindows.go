//go:build !windows

package backend

func MigrateWindowsWebviewDataDir(_, _ string) error {
	return nil
}

func MigrateWindowsWebviewDataDirs(_ string, _ []string) error {
	return nil
}
