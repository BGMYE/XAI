package backend

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadCodexAPIConfigFromDir(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "config.toml"), []byte(`
model_provider = "sub2api"

[model_providers.sub2api]
base_url = "https://api.example.com/proxy/v1"
wire_api = "responses"
`), 0o600); err != nil {
		t.Fatalf("write config.toml: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "auth.json"), []byte(`{"OPENAI_API_KEY":"sk-test"}`), 0o600); err != nil {
		t.Fatalf("write auth.json: %v", err)
	}

	got, err := loadCodexAPIConfigFromDir(dir)
	if err != nil {
		t.Fatalf("loadCodexAPIConfigFromDir returned error: %v", err)
	}
	if got.Provider != "sub2api" {
		t.Fatalf("Provider = %q, want sub2api", got.Provider)
	}
	if got.BaseURL != "https://api.example.com/proxy" {
		t.Fatalf("BaseURL = %q, want https://api.example.com/proxy", got.BaseURL)
	}
	if got.APIKey != "sk-test" {
		t.Fatalf("APIKey = %q, want sk-test", got.APIKey)
	}
	if got.WireAPI != "responses" {
		t.Fatalf("WireAPI = %q, want responses", got.WireAPI)
	}
}

func TestLoadCodexAPIConfigFromDirRejectsMissingAPIKey(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "config.toml"), []byte(`
model_provider = "sub2api"

[model_providers."sub2api"]
base_url = "https://api.example.com/v1"
`), 0o600); err != nil {
		t.Fatalf("write config.toml: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "auth.json"), []byte(`{"OPENAI_API_KEY":"   "}`), 0o600); err != nil {
		t.Fatalf("write auth.json: %v", err)
	}

	if _, err := loadCodexAPIConfigFromDir(dir); err == nil {
		t.Fatal("loadCodexAPIConfigFromDir unexpectedly succeeded")
	}
}
