package backend

import (
	"testing"

	"image-studio/backend/studio"
)

func openStudioV2(t *testing.T, keys *memoryAPIKeyStore) *StudioV2 {
	t.Helper()
	e, err := studio.Open(t.TempDir(), studioSecrets{keys}, studio.Options{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(e.Close)
	return &StudioV2{keys: keys, engine: e}
}

func TestClassicProfilesMoveIntoTheSharedRegistry(t *testing.T) {
	keys := &memoryAPIKeyStore{values: map[string]string{"api-key:profile:2f1c9a4e-0d6b-4c55-9a1e-1d2b3c4d5e6f": "sk-classic"}}
	s := openStudioV2(t, keys)
	classic := studio.Profile{ID: "2f1c9a4e-0d6b-4c55-9a1e-1d2b3c4d5e6f", Name: "Sunburst", BaseURL: "https://img.example.com", Protocol: "openai", ImageModel: "gpt-image-2"}
	n, err := s.ImportClassicProfiles([]studio.Profile{classic})
	if err != nil || n != 1 {
		t.Fatalf("import = %d, %v", n, err)
	}
	key, err := s.GetProfileKey(classic.ID)
	if err != nil || key != "sk-classic" {
		t.Fatalf("key = %q, %v", key, err)
	}
	list, err := s.ListProfiles()
	if err != nil || len(list) != 1 || !list[0].HasKey {
		t.Fatalf("list = %+v, %v", list, err)
	}
	copyOf, err := s.DuplicateProfile(classic.ID)
	if err != nil || copyOf.ID == classic.ID {
		t.Fatalf("duplicate = %+v, %v", copyOf, err)
	}
	if err = s.DeleteProfile(classic.ID); err != nil {
		t.Fatal(err)
	}
	if _, ok := keys.values["api-key:profile:"+classic.ID]; ok {
		t.Fatal("deleting the profile left its classic key behind")
	}
	if key, _ = s.GetProfileKey(copyOf.ID); key != "sk-classic" {
		t.Fatal("the copy lost its key")
	}
}

func TestClassicKeyIDsAreRestricted(t *testing.T) {
	for id, want := range map[string]bool{
		"2f1c9a4e-0d6b-4c55-9a1e-1d2b3c4d5e6f": true,
		"p-lq2x9-abc123":                       true,
		"has_underscore":                       false,
		"":                                     false,
	} {
		if got := classicKeyID(id); got != want {
			t.Errorf("classicKeyID(%q) = %v", id, got)
		}
	}
}

func TestStudioProxySettingIsValidated(t *testing.T) {
	s := openStudioV2(t, &memoryAPIKeyStore{values: map[string]string{}})
	if _, err := s.SetNetworkProxy("custom", ""); err == nil {
		t.Fatal("custom proxy without an address accepted")
	}
	n, err := s.SetNetworkProxy("custom", "http://127.0.0.1:7890")
	if err != nil || n.ProxyMode != "custom" {
		t.Fatalf("proxy = %+v, %v", n, err)
	}
}
