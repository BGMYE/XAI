//go:build windows

package backend

import (
	"path/filepath"
	"testing"
)

func TestAppendUniquePathDeduplicatesCaseInsensitiveWindowsPaths(t *testing.T) {
	root := filepath.Join("C:", "Users", "alice", "AppData", "Roaming")
	paths := []string{}
	paths = appendUniquePath(paths, filepath.Join(root, "image-studio.exe"))
	paths = appendUniquePath(paths, filepath.Join(root, "IMAGE-STUDIO.EXE"))
	paths = appendUniquePath(paths, filepath.Join(root, "old-custom-name.exe"))

	if len(paths) != 2 {
		t.Fatalf("paths = %#v, want two unique entries", paths)
	}
	if paths[1] != filepath.Join(root, "old-custom-name.exe") {
		t.Fatalf("historical exe path was not preserved: %#v", paths)
	}
}
