package promptscheme

import (
	"os"
	"path/filepath"
	"strings"
)

const Scheme = "image-studio"

type Status struct {
	Registered bool
	Handler    string
	Detail     string
}

func RegisterCurrentExecutable() error {
	executable, err := currentExecutable()
	if err != nil {
		return err
	}
	return RegisterExecutable(executable)
}

func UnregisterCurrentExecutable() error {
	executable, err := currentExecutable()
	if err != nil {
		return err
	}
	return UnregisterExecutable(executable)
}

func StatusForCurrentExecutable() (Status, error) {
	executable, err := currentExecutable()
	if err != nil {
		return Status{}, err
	}
	return StatusForExecutable(executable)
}

func currentExecutable() (string, error) {
	executable, err := os.Executable()
	if err != nil {
		return "", err
	}
	if abs, absErr := filepath.Abs(executable); absErr == nil {
		executable = abs
	}
	return strings.TrimSpace(executable), nil
}
