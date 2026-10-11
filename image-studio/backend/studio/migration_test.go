package studio

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestV1MigrationPreservesOriginalBackup(t *testing.T) {
	r := repository{t.TempDir()}
	d := emptyDocument()
	d.Version = 1
	d.RetiredProfileIDs = []string{"deleted"}
	raw, _ := json.MarshalIndent(d, "", "  ")
	path := filepath.Join(r.root, "studio.json")
	if err := os.WriteFile(path, raw, 0600); err != nil {
		t.Fatal(err)
	}
	got, err := r.read()
	if err != nil {
		t.Fatal(err)
	}
	if got.Version != 2 || len(got.RetiredProfileIDs) != 1 {
		t.Fatalf("migration lost fields: %+v", got)
	}
	if err := r.write(got); err != nil {
		t.Fatal(err)
	}
	backup := filepath.Join(r.root, "studio.v1.json.bak")
	b, err := os.ReadFile(backup)
	if err != nil || !bytes.Equal(b, raw) {
		t.Fatalf("original backup: %s, %v", b, err)
	}
	if _, err := r.read(); err != nil {
		t.Fatal(err)
	}
	b, _ = os.ReadFile(backup)
	if !bytes.Equal(b, raw) {
		t.Fatal("backup overwritten")
	}
}

func TestInvalidMigrationDoesNotModifyOriginal(t *testing.T) {
	for _, raw := range []string{`{"version":1}`, `{"version":99}`, `{"version":1`} {
		r := repository{t.TempDir()}
		path := filepath.Join(r.root, "studio.json")
		if err := os.WriteFile(path, []byte(raw), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := r.read(); err == nil {
			t.Fatal("expected validation failure")
		}
		b, _ := os.ReadFile(path)
		if string(b) != raw {
			t.Fatal("original changed")
		}
		if _, err := os.Stat(filepath.Join(r.root, "studio.v1.json.bak")); !os.IsNotExist(err) {
			t.Fatal("invalid backup created")
		}
	}
}

func TestMigrationBackupFailureLeavesV1Untouched(t *testing.T) {
	r := repository{t.TempDir()}
	d := emptyDocument()
	d.Version = 1
	raw, _ := json.Marshal(d)
	path := filepath.Join(r.root, "studio.json")
	if err := os.WriteFile(path, raw, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(r.root, "studio.v1.json.bak"), 0700); err != nil {
		t.Fatal(err)
	}
	if _, err := r.read(); err == nil {
		t.Fatal("expected backup failure")
	}
	b, _ := os.ReadFile(path)
	if !bytes.Equal(b, raw) {
		t.Fatal("original changed")
	}
}
