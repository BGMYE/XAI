//go:build windows

package promptscheme

import (
	"fmt"
	"strings"

	"golang.org/x/sys/windows/registry"
)

const windowsProtocolRegistryPath = `Software\Classes\image-studio`

func RegisterExecutable(executable string) error {
	executable = strings.TrimSpace(executable)
	if executable == "" {
		return fmt.Errorf("executable path is empty")
	}
	key, _, err := registry.CreateKey(registry.CURRENT_USER, windowsProtocolRegistryPath, registry.SET_VALUE|registry.QUERY_VALUE)
	if err != nil {
		return err
	}
	defer key.Close()
	if err := key.SetStringValue("", "URL:Image-Studio Prompt Import"); err != nil {
		return err
	}
	if err := key.SetStringValue("URL Protocol", ""); err != nil {
		return err
	}
	iconKey, _, err := registry.CreateKey(registry.CURRENT_USER, windowsProtocolRegistryPath+`\DefaultIcon`, registry.SET_VALUE)
	if err == nil {
		_ = iconKey.SetStringValue("", executable+",0")
		iconKey.Close()
	}
	commandKey, _, err := registry.CreateKey(registry.CURRENT_USER, windowsProtocolRegistryPath+`\shell\open\command`, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer commandKey.Close()
	return commandKey.SetStringValue("", fmt.Sprintf(`"%s" "%%1"`, executable))
}

func UnregisterExecutable(executable string) error {
	status, err := StatusForExecutable(executable)
	if err != nil {
		return err
	}
	if !status.Registered {
		return nil
	}
	paths := []string{
		windowsProtocolRegistryPath + `\shell\open\command`,
		windowsProtocolRegistryPath + `\shell\open`,
		windowsProtocolRegistryPath + `\shell`,
		windowsProtocolRegistryPath + `\DefaultIcon`,
		windowsProtocolRegistryPath,
	}
	for _, path := range paths {
		if err := registry.DeleteKey(registry.CURRENT_USER, path); err != nil && err != registry.ErrNotExist {
			return err
		}
	}
	return nil
}

func StatusForExecutable(executable string) (Status, error) {
	commandKey, err := registry.OpenKey(registry.CURRENT_USER, windowsProtocolRegistryPath+`\shell\open\command`, registry.QUERY_VALUE)
	if err != nil {
		return Status{}, nil
	}
	defer commandKey.Close()
	command, _, err := commandKey.GetStringValue("")
	if err != nil {
		return Status{}, nil
	}
	normalizedCommand := strings.ToLower(strings.TrimSpace(command))
	normalizedExecutable := strings.ToLower(strings.TrimSpace(executable))
	return Status{
		Registered: normalizedExecutable != "" && strings.Contains(normalizedCommand, normalizedExecutable),
		Handler:    command,
		Detail:     windowsProtocolRegistryPath,
	}, nil
}
