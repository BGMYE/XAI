//go:build windows

package backend

import (
	"os"
	"path/filepath"
	"testing"
)

func TestMigrateWindowsWebviewDataDirMovesLegacyProfile(t *testing.T) {
	root := t.TempDir()
	legacy := filepath.Join(root, "image-studio.exe")
	dst := filepath.Join(root, "Image Studio", "webview")
	dbFile := filepath.Join(legacy, "IndexedDB", "image-studio.indexeddb.leveldb", "000003.log")
	if err := os.MkdirAll(filepath.Dir(dbFile), secureDirMode); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(dbFile, []byte("image-studio historyFull gptcodex.profiles history-db"), secureFileMode); err != nil {
		t.Fatal(err)
	}

	if err := MigrateWindowsWebviewDataDir(dst, legacy); err != nil {
		t.Fatal(err)
	}

	migrated := filepath.Join(dst, "IndexedDB", "image-studio.indexeddb.leveldb", "000003.log")
	data, err := os.ReadFile(migrated)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "image-studio historyFull gptcodex.profiles history-db" {
		t.Fatalf("migrated data = %q", data)
	}
}

func TestMigrateWindowsWebviewDataDirKeepsExistingDestination(t *testing.T) {
	root := t.TempDir()
	legacy := filepath.Join(root, "image-studio.exe")
	dst := filepath.Join(root, "Image Studio", "webview")
	if err := os.MkdirAll(legacy, secureDirMode); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(dst, secureDirMode); err != nil {
		t.Fatal(err)
	}
	sentinel := filepath.Join(dst, "sentinel")
	if err := os.WriteFile(sentinel, []byte("keep"), secureFileMode); err != nil {
		t.Fatal(err)
	}

	if err := MigrateWindowsWebviewDataDir(dst, legacy); err != nil {
		t.Fatal(err)
	}

	data, err := os.ReadFile(sentinel)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "keep" {
		t.Fatalf("destination was overwritten: %q", data)
	}
}

func TestMigrateWindowsWebviewDataDirSkipsNonProfileDirectory(t *testing.T) {
	root := t.TempDir()
	legacy := filepath.Join(root, "renamed.exe")
	dst := filepath.Join(root, "Image Studio", "webview")
	if err := os.MkdirAll(legacy, secureDirMode); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(legacy, "notes.txt"), []byte("not-webview"), secureFileMode); err != nil {
		t.Fatal(err)
	}

	if err := MigrateWindowsWebviewDataDir(dst, legacy); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(dst); !os.IsNotExist(err) {
		t.Fatalf("expected destination to stay absent, stat err = %v", err)
	}
}

func TestMigrateWindowsWebviewDataDirsPrefersProfileWithStoredData(t *testing.T) {
	root := t.TempDir()
	emptyProfile := filepath.Join(root, "renamed.exe")
	populatedProfile := filepath.Join(root, "image-studio.exe")
	dst := filepath.Join(root, "Image Studio", "webview")

	if err := os.MkdirAll(filepath.Join(emptyProfile, "Network"), secureDirMode); err != nil {
		t.Fatal(err)
	}
	dbFile := filepath.Join(populatedProfile, "IndexedDB", "image-studio.indexeddb.leveldb", "000003.log")
	if err := os.MkdirAll(filepath.Dir(dbFile), secureDirMode); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(dbFile, []byte("gptcodex.profiles real-history"), secureFileMode); err != nil {
		t.Fatal(err)
	}

	if err := MigrateWindowsWebviewDataDirs(dst, []string{emptyProfile, populatedProfile}); err != nil {
		t.Fatal(err)
	}

	data, err := os.ReadFile(filepath.Join(dst, "IndexedDB", "image-studio.indexeddb.leveldb", "000003.log"))
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "gptcodex.profiles real-history" {
		t.Fatalf("migrated data = %q", data)
	}
}

func TestMigrateWindowsWebviewDataDirsFindsHistoricalExeName(t *testing.T) {
	root := t.TempDir()
	defaultProfile := filepath.Join(root, "image-studio.exe")
	currentProfile := filepath.Join(root, "current-name.exe")
	historicalProfile := filepath.Join(root, "old-custom-name.exe")
	dst := filepath.Join(root, "Image Studio", "webview")

	if err := os.MkdirAll(filepath.Join(defaultProfile, "Network"), secureDirMode); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(currentProfile, "Network"), secureDirMode); err != nil {
		t.Fatal(err)
	}
	dbFile := filepath.Join(historicalProfile, "IndexedDB", "wails.localhost_0.indexeddb.leveldb", "000003.log")
	if err := os.MkdirAll(filepath.Dir(dbFile), secureDirMode); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(dbFile, []byte("historyFull gptcodex.promptHistory old-data"), secureFileMode); err != nil {
		t.Fatal(err)
	}

	if err := MigrateWindowsWebviewDataDirs(dst, []string{defaultProfile, currentProfile, historicalProfile}); err != nil {
		t.Fatal(err)
	}

	data, err := os.ReadFile(filepath.Join(dst, "IndexedDB", "wails.localhost_0.indexeddb.leveldb", "000003.log"))
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "historyFull gptcodex.promptHistory old-data" {
		t.Fatalf("migrated data = %q", data)
	}
}

func TestMigrateWindowsWebviewDataDirsReplacesEmptyDestination(t *testing.T) {
	root := t.TempDir()
	legacy := filepath.Join(root, "old-custom-name.exe")
	dst := filepath.Join(root, "Image Studio", "webview")
	if err := os.MkdirAll(filepath.Join(dst, "Network"), secureDirMode); err != nil {
		t.Fatal(err)
	}
	dbFile := filepath.Join(legacy, "Local Storage", "leveldb", "000003.log")
	if err := os.MkdirAll(filepath.Dir(dbFile), secureDirMode); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(dbFile, []byte("gptcodex.outputFormat"), secureFileMode); err != nil {
		t.Fatal(err)
	}

	if err := MigrateWindowsWebviewDataDirs(dst, []string{legacy}); err != nil {
		t.Fatal(err)
	}

	data, err := os.ReadFile(filepath.Join(dst, "Local Storage", "leveldb", "000003.log"))
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "gptcodex.outputFormat" {
		t.Fatalf("migrated data = %q", data)
	}
}

func TestMigrateWindowsWebviewDataDirsRejectsUnmarkedProfile(t *testing.T) {
	root := t.TempDir()
	foreignProfile := filepath.Join(root, "other-app.exe")
	dst := filepath.Join(root, "Image Studio", "webview")
	dbFile := filepath.Join(foreignProfile, "IndexedDB", "foreign.indexeddb.leveldb", "000003.log")
	if err := os.MkdirAll(filepath.Dir(dbFile), secureDirMode); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(dbFile, []byte("unrelated webview data"), secureFileMode); err != nil {
		t.Fatal(err)
	}

	if err := MigrateWindowsWebviewDataDirs(dst, []string{foreignProfile}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(dst); !os.IsNotExist(err) {
		t.Fatalf("expected destination to stay absent, stat err = %v", err)
	}
}
