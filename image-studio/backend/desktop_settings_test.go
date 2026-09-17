package backend

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	compat "image-studio/shared/compat"
)

func isolatedDesktopSettings(t *testing.T) *DesktopSettingsService {
	t.Helper()
	t.Setenv("IMAGE_STUDIO_DATA_ROOT", t.TempDir())
	svc := NewService()
	svc.ctx = context.Background()
	svc.apiKeys = &memoryAPIKeyStore{values: map[string]string{}}
	d := NewDesktopSettingsService(svc)
	d.path = filepath.Join(t.TempDir(), "state.json")
	return d
}

func TestDesktopSettingsFileFailureRollsBackCredentialAndRevision(t *testing.T) {
	d := isolatedDesktopSettings(t)
	first, err := d.SaveProfile(SaveDesktopProfileRequest{Profile: desktopTestProfile("one"), Credential: DesktopCredentialChange{Action: "replace", Value: "original-test-value"}})
	if err != nil {
		t.Fatal(err)
	}
	events := 0
	ConfigureDesktopSettingsEvents(d, func(int64) { events++ })
	d.writeState = func(string, compat.State) error { return errors.New("simulated disk failure") }
	changed := desktopTestProfile("one")
	changed.Name = "Unsaved name"
	if _, err = d.SaveProfile(SaveDesktopProfileRequest{ExpectedRevision: first.Revision, Profile: changed, Credential: DesktopCredentialChange{Action: "replace", Value: "unsaved-test-value"}}); err == nil {
		t.Fatal("failed file write must not report success")
	}
	key, err := d.svc.GetStoredAPIKey("profile:one")
	if err != nil || key != "original-test-value" {
		t.Fatal("failed save did not roll back credential")
	}
	current, err := d.GetSnapshot()
	if err != nil || current.Revision != first.Revision || current.Profiles[0].Name != first.Profiles[0].Name || events != 0 {
		t.Fatal("failed save changed durable profile or emitted change event")
	}
}

func TestDesktopSettingsFailedDeletePreservesProfileCredentialAndRoles(t *testing.T) {
	d := isolatedDesktopSettings(t)
	first, err := d.SaveProfile(SaveDesktopProfileRequest{Profile: desktopTestProfile("one"), Credential: DesktopCredentialChange{Action: "replace", Value: "original-test-value"}, SetActive: true})
	if err != nil {
		t.Fatal(err)
	}
	d.writeState = func(string, compat.State) error { return errors.New("simulated disk failure") }
	if _, err = d.DeleteProfile(first.Revision, "one"); err == nil {
		t.Fatal("expected failed deletion")
	}
	current, err := d.GetSnapshot()
	if err != nil || current.Revision != first.Revision || current.ActiveProfileID != "one" || len(current.Profiles) != 1 || !current.Profiles[0].HasAPIKey {
		t.Fatal("failed deletion lost profile or credential")
	}
}

func TestDesktopSettingsOutputDirectoryFailureRestoresRuntimeAndSavedPreference(t *testing.T) {
	d := isolatedDesktopSettings(t)
	original := filepath.Join(t.TempDir(), "original")
	next := filepath.Join(t.TempDir(), "next")
	originalJSON, _ := json.Marshal(original)
	nextJSON, _ := json.Marshal(next)
	first, err := d.PatchPreferences(0, map[string]json.RawMessage{"outputDir": originalJSON})
	if err != nil {
		t.Fatal(err)
	}
	d.writeState = func(string, compat.State) error { return errors.New("simulated disk failure") }
	if _, err = d.PatchPreferences(first.Revision, map[string]json.RawMessage{"outputDir": nextJSON}); err == nil {
		t.Fatal("expected failed preference save")
	}
	resolved, err := d.svc.resolvedOutputDir()
	if err != nil || resolved != original {
		t.Fatal("runtime output folder was not rolled back")
	}
	current, err := d.GetSnapshot()
	if err != nil || current.Preferences.OutputDir != original || current.Revision != first.Revision {
		t.Fatal("failed preference write changed durable settings")
	}
}

func TestDesktopSettingsMigrationKeepsExistingProfilesHistoryAndModelCatalog(t *testing.T) {
	d := isolatedDesktopSettings(t)
	saved := compat.EmptyState()
	saved.UpdatedAt = 123
	saved.Profiles = []compat.UpstreamProfile{desktopTestProfile("original")}
	saved.ActiveProfile, saved.AIProfile = "original", "assistant"
	saved.Settings.FontScale = 2
	saved.History = []compat.HistoryItem{{ID: "saved-work"}}
	if err := compat.Save(d.path, saved); err != nil {
		t.Fatal(err)
	}
	legacy := compat.EmptyState()
	legacy.Profiles = []compat.UpstreamProfile{desktopTestProfile("stale")}
	current, err := d.Initialize(legacy)
	if err != nil {
		t.Fatal(err)
	}
	if len(current.Profiles) != 1 || current.Profiles[0].ID != "original" || len(current.Profiles[0].ModelIDs) != 2 || current.Profiles[0].VideoModelID != "video-test" || current.AIProfileID != "assistant" || current.Preferences.FontScale != 2 {
		t.Fatal("migration replaced durable profile/model settings with stale WebView data")
	}
	restored, err := compat.Load(d.path)
	if err != nil || len(restored.History) != 1 || restored.History[0].ID != "saved-work" {
		t.Fatal("migration lost saved history")
	}
}

func desktopTestProfile(id string) compat.UpstreamProfile {
	return compat.UpstreamProfile{ID: id, Name: "Test connection", APIMode: "images", RequestPolicy: "openai", BaseURL: "https://example.invalid", ImageModelID: "image-test", ModelIDs: []string{"image-test", "custom-two"}, VideoModelID: "video-test", CreatedAt: 1}
}

func TestDesktopSettingsCredentialNeverEntersSnapshotOrFile(t *testing.T) {
	d := isolatedDesktopSettings(t)
	var events []int64
	ConfigureDesktopSettingsEvents(d, func(revision int64) { events = append(events, revision) })
	const credential = "test-private-credential-value"
	snapshot, err := d.SaveProfile(SaveDesktopProfileRequest{Profile: desktopTestProfile("one"), Credential: DesktopCredentialChange{Action: "replace", Value: credential}, SetActive: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Profiles) != 1 || !snapshot.Profiles[0].HasAPIKey {
		t.Fatal("missing credential status")
	}
	for _, data := range []func() []byte{
		func() []byte { b, _ := json.Marshal(snapshot); return b },
		func() []byte {
			b, err := os.ReadFile(d.path)
			if err != nil {
				t.Fatal(err)
			}
			return b
		},
	} {
		if strings.Contains(string(data()), credential) {
			t.Fatal("credential leaked outside keyring")
		}
	}
	if len(events) != 1 || events[0] != snapshot.Revision {
		t.Fatal("expected revision-only change notification")
	}
	key, _ := d.svc.GetStoredAPIKey("profile:one")
	if key != credential {
		t.Fatal("credential was not stored")
	}
	snapshot, err = d.SaveProfile(SaveDesktopProfileRequest{ExpectedRevision: snapshot.Revision, Profile: desktopTestProfile("one"), Credential: DesktopCredentialChange{Action: "clear"}})
	if err != nil || snapshot.Profiles[0].HasAPIKey {
		t.Fatal("clear credential did not propagate")
	}
}

func TestDesktopSettingsRejectStaleRevisionWithoutChangingCredential(t *testing.T) {
	d := isolatedDesktopSettings(t)
	_, err := d.SaveProfile(SaveDesktopProfileRequest{Profile: desktopTestProfile("one"), Credential: DesktopCredentialChange{Action: "replace", Value: "original-test-value"}})
	if err != nil {
		t.Fatal(err)
	}
	_, err = d.SaveProfile(SaveDesktopProfileRequest{Profile: desktopTestProfile("one"), Credential: DesktopCredentialChange{Action: "replace", Value: "stale-test-value"}})
	if err == nil || !strings.Contains(err.Error(), "SETTINGS_CONFLICT") {
		t.Fatal("stale revision must be rejected")
	}
	key, _ := d.svc.GetStoredAPIKey("profile:one")
	if key != "original-test-value" {
		t.Fatal("stale write modified credential")
	}
}

func TestDesktopSettingsMergeConcurrentWorkspaceExport(t *testing.T) {
	d := isolatedDesktopSettings(t)
	initial, err := d.SaveProfile(SaveDesktopProfileRequest{Profile: desktopTestProfile("one"), Credential: DesktopCredentialChange{Action: "keep"}})
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	errors := make(chan error, 2)
	wg.Add(2)
	go func() {
		defer wg.Done()
		_, err := d.PatchPreferences(initial.Revision, map[string]json.RawMessage{"fontScale": json.RawMessage("1.5")})
		errors <- err
	}()
	go func() {
		defer wg.Done()
		stale := compat.EmptyState()
		stale.Settings.FontScale = 1
		stale.History = []compat.HistoryItem{{ID: "new-work"}}
		errors <- d.saveWorkspace(stale)
	}()
	wg.Wait()
	close(errors)
	for err := range errors {
		if err != nil {
			t.Fatal(err)
		}
	}
	state, err := compat.Load(d.path)
	if err != nil {
		t.Fatal(err)
	}
	if state.Settings.FontScale != 1.5 || len(state.History) != 1 || state.History[0].ID != "new-work" || len(state.Profiles) != 1 {
		t.Fatal("concurrent writes lost owned data")
	}
}

func TestDesktopSettingsOnlyOneConcurrentPreferenceWriterWins(t *testing.T) {
	d := isolatedDesktopSettings(t)
	first, err := d.Initialize(compat.EmptyState())
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for _, value := range []string{"1.5", "2"} {
		wg.Add(1)
		go func(value string) {
			defer wg.Done()
			_, err := d.PatchPreferences(first.Revision, map[string]json.RawMessage{"fontScale": json.RawMessage(value)})
			results <- err
		}(value)
	}
	wg.Wait()
	close(results)
	wins := 0
	for err := range results {
		if err == nil {
			wins++
		}
	}
	if wins != 1 {
		t.Fatalf("got %d successful writes, want one", wins)
	}
}

func TestDesktopSettingsInitializeCannotReplaceCurrentSettings(t *testing.T) {
	d := isolatedDesktopSettings(t)
	first, err := d.SaveProfile(SaveDesktopProfileRequest{Profile: desktopTestProfile("one"), Credential: DesktopCredentialChange{Action: "keep"}})
	if err != nil {
		t.Fatal(err)
	}
	second, err := d.Initialize(compat.EmptyState())
	if err != nil || len(second.Profiles) != 1 || second.Revision != first.Revision {
		t.Fatal("second window initialization replaced settings")
	}
}

func TestDesktopSettingsDraftProbeDoesNotSaveOrActivate(t *testing.T) {
	d := isolatedDesktopSettings(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" || r.Header.Get("Authorization") != "Bearer draft-test-key" {
			t.Errorf("unexpected probe request")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"id":"gpt-image-2.5-sunburst"}]}`))
	}))
	defer server.Close()
	draft := desktopTestProfile("unsaved")
	draft.BaseURL = server.URL
	result, err := d.ProbeProfile(ProbeDesktopProfileRequest{Draft: draft, Credential: DesktopCredentialChange{Action: "replace", Value: "draft-test-key"}, ProxyMode: "none"})
	if err != nil || len(result.Models) != 1 {
		t.Fatalf("probe failed: %v", err)
	}
	snapshot, err := d.GetSnapshot()
	if err != nil || snapshot.Revision != 0 || len(snapshot.Profiles) != 0 || snapshot.ActiveProfileID != "" {
		t.Fatal("draft probe mutated saved settings")
	}
	key, _ := d.svc.GetStoredAPIKey("profile:unsaved")
	if key != "" {
		t.Fatal("draft probe wrote credentials")
	}
}

func TestDesktopSettingsProbeNeverReturnsEchoedCredential(t *testing.T) {
	d := isolatedDesktopSettings(t)
	const credential = "synthetic-private-probe-credential"
	for _, errorResponse := range []bool{false, true} {
		t.Run(map[bool]string{false: "models", true: "error"}[errorResponse], func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				if errorResponse {
					w.WriteHeader(http.StatusUnauthorized)
					_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"message": strings.Repeat("x", 150) + credential}})
					return
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"data": []map[string]string{{"id": credential}, {"id": "image-model", "name": credential, "owned_by": credential, "object": credential}}})
			}))
			defer server.Close()
			draft := desktopTestProfile("unsaved")
			draft.BaseURL = server.URL
			result, err := d.ProbeProfile(ProbeDesktopProfileRequest{Draft: draft, Credential: DesktopCredentialChange{Action: "replace", Value: credential}, ProxyMode: "none"})
			encoded, _ := json.Marshal(result)
			if strings.Contains(string(encoded), credential) {
				t.Fatal("model response leaked credential")
			}
			if errorResponse {
				if err == nil || strings.Contains(err.Error(), "synthetic-") {
					t.Fatal("truncated error leaked a credential prefix")
				}
			} else if err != nil || len(result.Models) != 1 || result.Models[0].ID != "image-model" || result.ModelCount != 1 {
				t.Fatal("model redaction removed a valid model or retained credential ID")
			}
		})
	}
}

func TestDesktopSettingsDuplicateAndDeleteKeepOtherCredentials(t *testing.T) {
	d := isolatedDesktopSettings(t)
	first, err := d.SaveProfile(SaveDesktopProfileRequest{Profile: desktopTestProfile("one"), Credential: DesktopCredentialChange{Action: "replace", Value: "original-test-key"}})
	if err != nil {
		t.Fatal(err)
	}
	next, err := d.DuplicateProfile(first.Revision, "one")
	if err != nil || len(next.Profiles) != 2 {
		t.Fatal("duplicate failed")
	}
	copyID := next.Profiles[1].ID
	if _, err = d.DeleteProfile(next.Revision, "one"); err != nil {
		t.Fatal(err)
	}
	original, _ := d.svc.GetStoredAPIKey("profile:one")
	copyKey, _ := d.svc.GetStoredAPIKey("profile:" + copyID)
	if original != "" || copyKey != "original-test-key" {
		t.Fatal("deletion affected the wrong credential")
	}
}
