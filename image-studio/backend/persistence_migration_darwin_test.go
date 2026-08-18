//go:build darwin

package backend

import (
	"os"
	"path/filepath"
	"testing"
)

func TestMigrateMacWebkitDataDirsMovesLegacyProfile(t *testing.T) {
	root := t.TempDir()
	legacy := filepath.Join(root, macLegacyWebkitDirName)
	dst := filepath.Join(root, macCurrentWebkitDirName)
	dbFile := filepath.Join(legacy, "WebsiteData", "Default", "profile", "profile", "LocalStorage", "localstorage.sqlite3")
	if err := os.MkdirAll(filepath.Dir(dbFile), secureDirMode); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(dbFile, []byte("gptcodex.profiles historyFull gptcodex.activeProfileId"), secureFileMode); err != nil {
		t.Fatal(err)
	}

	if err := migrateMacWebkitDataDirs(dst, []string{legacy}); err != nil {
		t.Fatal(err)
	}

	migrated := filepath.Join(dst, "WebsiteData", "Default", "profile", "profile", "LocalStorage", "localstorage.sqlite3")
	data, err := os.ReadFile(migrated)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "gptcodex.profiles historyFull gptcodex.activeProfileId" {
		t.Fatalf("migrated data = %q", data)
	}
}

func TestMigrateMacWebkitDataDirsKeepsExistingPopulatedDestination(t *testing.T) {
	root := t.TempDir()
	legacy := filepath.Join(root, macLegacyWebkitDirName)
	dst := filepath.Join(root, macCurrentWebkitDirName)
	if err := os.MkdirAll(legacy, secureDirMode); err != nil {
		t.Fatal(err)
	}
	dstFile := filepath.Join(dst, "WebsiteData", "Default", "profile", "profile", "LocalStorage", "localstorage.sqlite3")
	if err := os.MkdirAll(filepath.Dir(dstFile), secureDirMode); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(dstFile, []byte("gptcodex.profiles current"), secureFileMode); err != nil {
		t.Fatal(err)
	}

	if err := migrateMacWebkitDataDirs(dst, []string{legacy}); err != nil {
		t.Fatal(err)
	}

	data, err := os.ReadFile(dstFile)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "gptcodex.profiles current" {
		t.Fatalf("destination was overwritten: %q", data)
	}
}
