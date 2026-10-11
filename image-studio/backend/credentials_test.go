package backend

import "testing"

type memoryAPIKeyStore struct {
	values map[string]string
}

func (m *memoryAPIKeyStore) Get(mode string) (string, error) {
	return m.values[mode], nil
}

func (m *memoryAPIKeyStore) Set(mode, value string) error {
	m.values[mode] = value
	return nil
}

func (m *memoryAPIKeyStore) Delete(mode string) error {
	delete(m.values, mode)
	return nil
}

func TestStoredAPIKeyLifecycle(t *testing.T) {
	t.Parallel()

	svc := NewService()
	mem := &memoryAPIKeyStore{values: map[string]string{}}
	svc.apiKeys = mem

	if err := svc.SetStoredAPIKey("responses", "  sk-test  "); err != nil {
		t.Fatalf("set stored api key: %v", err)
	}
	got, err := svc.GetStoredAPIKey("responses")
	if err != nil {
		t.Fatalf("get stored api key: %v", err)
	}
	if got != "sk-test" {
		t.Fatalf("got %q, want sk-test", got)
	}
	if err := svc.SetStoredAPIKey("responses", ""); err != nil {
		t.Fatalf("delete stored api key: %v", err)
	}
	got, err = svc.GetStoredAPIKey("responses")
	if err != nil {
		t.Fatalf("get after delete: %v", err)
	}
	if got != "" {
		t.Fatalf("got %q after delete, want empty", got)
	}
}

func TestStoredAPIKeyRejectsUnknownMode(t *testing.T) {
	t.Parallel()

	svc := NewService()
	svc.apiKeys = &memoryAPIKeyStore{values: map[string]string{}}
	if err := svc.SetStoredAPIKey("chat", "sk-test"); err == nil {
		t.Fatal("expected unknown mode to be rejected")
	}
}
