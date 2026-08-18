//go:build !darwin

package backend

func MigrateMacWebkitDataDir() error {
	return nil
}
