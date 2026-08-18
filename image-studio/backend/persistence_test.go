package backend

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestDefaultOutputDirUsesPicturesOnNonWindows(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("non-Windows path policy")
	}
	t.Setenv("HOME", filepath.Join(t.TempDir(), "home"))

	got, err := defaultOutputDir()
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(os.Getenv("HOME"), "Pictures", appDocumentDirName)
	if got != want {
		t.Fatalf("defaultOutputDir() = %q, want %q", got, want)
	}
}

func TestImportsDirUsesConfigRootOnNonWindows(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("non-Windows path policy")
	}
	home := filepath.Join(t.TempDir(), "home")
	t.Setenv("HOME", home)

	got, err := importsDir()
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(got, filepath.Join(appConfigDirName, "imports")) {
		t.Fatalf("importsDir() = %q, want suffix %q", got, filepath.Join(appConfigDirName, "imports"))
	}
	if !strings.Contains(got, home) {
		t.Fatalf("importsDir() = %q, want under test HOME %q", got, home)
	}
}
