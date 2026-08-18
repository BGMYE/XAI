package compat

import shared "image-studio/shared/compat"

func NormaliseCompletionNotificationSettings(value *shared.CompletionNotificationSettings) shared.CompletionNotificationSettings {
	if value == nil {
		return shared.CompletionNotificationSettings{Enabled: true}
	}
	return *value
}
