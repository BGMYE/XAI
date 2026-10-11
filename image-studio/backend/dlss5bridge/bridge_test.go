package dlss5bridge

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestMaterializeIsPinnedCompleteAndRejectsModifiedCode(t *testing.T) {
	root := t.TempDir()
	entry, err := Materialize(root)
	if err != nil {
		t.Fatal(err)
	}
	repeated, err := Extract(root)
	if err != nil || repeated != entry {
		t.Fatalf("non-deterministic extraction: %q %v", repeated, err)
	}
	for _, name := range []string{"bridge.py", "vendor/dlss5tool/dlss_host_process.py", "vendor/locales/zh_CN.json", "vendor/LICENSE-DLSS5Tool.txt", "vendor/UPSTREAM.md"} {
		data, err := os.ReadFile(filepath.Join(filepath.Dir(entry), filepath.FromSlash(name)))
		if err != nil || len(data) == 0 {
			t.Fatalf("missing packaged resource %s: %v", name, err)
		}
	}
	if err := os.WriteFile(entry, []byte("modified by another application"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := Materialize(root); err == nil || !strings.Contains(err.Error(), "modified") {
		t.Fatalf("modified executable source must be rejected: %v", err)
	}
}
