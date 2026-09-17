package compat

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func TestDesktopProfileCatalogAndRolesRoundTrip(t *testing.T) {
	state := EmptyState()
	state.DesktopSettingsRevision = 12
	state.ActiveProfile, state.AIProfile = "images", "assistant"
	state.Settings.LastSettingsPane = "connections"
	state.Settings.CompletionSound = &CompletionSoundSettings{Enabled: false, Mode: "default"}
	state.Settings.CompletionNotification = &CompletionNotificationSettings{Enabled: false}
	state.Profiles = []UpstreamProfile{{ID: "images", Name: "Images", APIMode: "images", ModelIDs: []string{"gpt-image-2.5-sunburst", "custom-model"}, VideoModelID: "custom-video"}}
	path := filepath.Join(t.TempDir(), "state.json")
	if err := Save(path, state); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil || bytes.Count(data, []byte(`"enabled": false`)) != 2 {
		t.Fatal("disabled completion preferences must serialize explicit false values")
	}
	loaded, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.AIProfile != "assistant" || loaded.DesktopSettingsRevision != 12 || loaded.Settings.LastSettingsPane != "connections" || len(loaded.Profiles[0].ModelIDs) != 2 || loaded.Profiles[0].VideoModelID != "custom-video" {
		t.Fatal("desktop configuration lost on round trip")
	}
}
