package ui

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadCodexAPIConfigFromDir(t *testing.T) {
	dir := t.TempDir()
	config := `
model_provider = "openai"

[model_providers.openai]
base_url = "https://api.openai.example.com/v1"
`
	if err := os.WriteFile(filepath.Join(dir, "config.toml"), []byte(config), 0o600); err != nil {
		t.Fatalf("write config.toml: %v", err)
	}
	auth := `{"OPENAI_API_KEY":"sk-test"}`
	if err := os.WriteFile(filepath.Join(dir, "auth.json"), []byte(auth), 0o600); err != nil {
		t.Fatalf("write auth.json: %v", err)
	}

	got, err := loadCodexAPIConfigFromDir(dir)
	if err != nil {
		t.Fatalf("loadCodexAPIConfigFromDir: %v", err)
	}
	if got.Provider != "openai" {
		t.Fatalf("provider=%q want openai", got.Provider)
	}
	if got.BaseURL != "https://api.openai.example.com" {
		t.Fatalf("baseURL=%q want https://api.openai.example.com", got.BaseURL)
	}
	if got.APIKey != "sk-test" {
		t.Fatalf("apiKey=%q want sk-test", got.APIKey)
	}
}

func TestParseCodexConfigTOMLQuotedProvider(t *testing.T) {
	raw := `
model_provider = 'azure-openai'

[model_providers."azure-openai"]
base_url = 'https://relay.example.com/'
`
	provider, baseURL, err := parseCodexConfigTOML(raw)
	if err != nil {
		t.Fatalf("parseCodexConfigTOML: %v", err)
	}
	if provider != "azure-openai" {
		t.Fatalf("provider=%q want azure-openai", provider)
	}
	if baseURL != "https://relay.example.com" {
		t.Fatalf("baseURL=%q want https://relay.example.com", baseURL)
	}
}
