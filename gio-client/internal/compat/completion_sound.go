package compat

import (
	"strings"

	shared "image-studio/shared/compat"
)

const defaultCompletionSoundMode = "default"

func NormaliseCompletionSoundSettings(value *shared.CompletionSoundSettings) shared.CompletionSoundSettings {
	if value == nil {
		return shared.CompletionSoundSettings{
			Enabled: true,
			Mode:    defaultCompletionSoundMode,
		}
	}
	next := *value
	if strings.TrimSpace(next.Mode) != "custom" || strings.TrimSpace(next.CustomData) == "" {
		next.Mode = defaultCompletionSoundMode
	}
	if strings.TrimSpace(next.Mode) == "" {
		next.Mode = defaultCompletionSoundMode
	}
	return next
}
