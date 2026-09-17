//go:build linux

package main

import (
	"context"
	"os/exec"
	"strings"
	"time"
)

func readSystemPreferences() SystemPreferences {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	data, err := exec.CommandContext(ctx, "gsettings", "list-recursively", "org.gnome.desktop.interface").Output()
	if err != nil {
		return SystemPreferences{}
	}
	var result SystemPreferences
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 3 {
			continue
		}
		value := strings.Trim(fields[2], "'")
		switch fields[1] {
		case "color-scheme":
			if value == "prefer-dark" {
				result.Dark = boolRef(true)
			} else if value == "prefer-light" {
				result.Dark = boolRef(false)
			}
		case "enable-animations":
			result.ReduceMotion = boolRef(value == "false")
		case "gtk-theme":
			if strings.Contains(strings.ToLower(value), "highcontrast") {
				result.HighContrast = boolRef(true)
			}
		}
	}
	return result
}
