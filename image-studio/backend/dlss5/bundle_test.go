package dlss5

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func bundleFixture(t *testing.T) (string, string, bundleManifest) {
	t.Helper()
	dir := t.TempDir()
	app := filepath.Join(dir, "XAI.exe")
	root := filepath.Join(dir, "runtimes", "dlss5")
	m := bundleManifest{SchemaVersion: 1, ProtocolVersion: 1, EngineVersion: "engine-test", BundleVersion: "release-test", Platform: "windows", Architecture: "amd64", Executable: "worker/xai-video-engine.exe", ToolRoot: "runtime", RuntimePath: "runtime/nvngx_dlssnr.dll"}
	for _, name := range []string{m.Executable, m.RuntimePath, "runtime/_internal/ffmpeg.exe", "worker/_internal/python313.dll", "licenses/NOTICE.txt"} {
		data := []byte("inert fixture: " + name)
		p := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(p), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, data, 0600); err != nil {
			t.Fatal(err)
		}
		h := sha256.Sum256(data)
		m.Files = append(m.Files, bundleFile{Path: name, SHA256: hex.EncodeToString(h[:])})
	}
	writeManifest(t, root, m)
	return app, root, m
}
func writeManifest(t *testing.T, root string, m bundleManifest) {
	t.Helper()
	data, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(root, "manifest.json"), data, 0600); err != nil {
		t.Fatal(err)
	}
}
func requireBundleStatus(t *testing.T, err error, expected string) {
	t.Helper()
	var failure *bundleError
	if !errors.As(err, &failure) || failure.Status != expected {
		t.Fatalf("wanted %s, got %v", expected, err)
	}
}
func TestBundleDiscoversPrivateCompleteRuntime(t *testing.T) {
	app, root, _ := bundleFixture(t)
	b, err := loadBundle(context.Background(), app, "windows", "amd64")
	if err != nil {
		t.Fatal(err)
	}
	if b.Executable != filepath.Join(root, "worker", "xai-video-engine.exe") || b.RuntimePath != filepath.Join(root, "runtime", "nvngx_dlssnr.dll") || b.ToolRoot != filepath.Join(root, "runtime") || b.Manifest.BundleVersion != "release-test" || b.Fingerprint == "" {
		t.Fatalf("wrong resolution: %+v", b)
	}
}
func TestBundleRejectsIncompleteOrIncompatiblePackages(t *testing.T) {
	for _, name := range []string{"schema", "protocol", "architecture", "runtime-path", "traversal", "absolute", "backslash", "alternate-stream", "duplicate", "case-collision", "unlisted", "missing-file", "hash", "missing-required", "empty-version"} {
		t.Run(name, func(t *testing.T) {
			app, root, m := bundleFixture(t)
			switch name {
			case "schema":
				m.SchemaVersion = 2
			case "protocol":
				m.ProtocolVersion = 2
			case "architecture":
				m.Architecture = "arm64"
			case "runtime-path":
				m.RuntimePath = "../outside.dll"
			case "traversal":
				m.Files[0].Path = "../outside.exe"
			case "absolute":
				m.Files[0].Path = "/outside.exe"
			case "backslash":
				m.Files[0].Path = `worker\xai-video-engine.exe`
			case "alternate-stream":
				m.Files[0].Path = "worker/xai-video-engine.exe:other"
			case "duplicate":
				m.Files = append(m.Files, m.Files[0])
			case "case-collision":
				other := m.Files[0]
				other.Path = strings.ToUpper(other.Path)
				m.Files = append(m.Files, other)
			case "unlisted":
				if err := os.WriteFile(filepath.Join(root, "runtime", "extra.dll"), []byte("undeclared"), 0600); err != nil {
					t.Fatal(err)
				}
			case "missing-file":
				if err := os.Remove(filepath.Join(root, filepath.FromSlash(m.Files[2].Path))); err != nil {
					t.Fatal(err)
				}
			case "hash":
				m.Files[0].SHA256 = strings.Repeat("0", 64)
			case "missing-required":
				m.Files = m.Files[1:]
			case "empty-version":
				m.EngineVersion = ""
			}
			writeManifest(t, root, m)
			_, err := loadBundle(context.Background(), app, "windows", "amd64")
			requireBundleStatus(t, err, "incompatible_runtime")
		})
	}
}
func TestBundleMissingAndUnsupportedAreActionable(t *testing.T) {
	app := filepath.Join(t.TempDir(), "XAI.exe")
	_, err := loadBundle(context.Background(), app, "windows", "amd64")
	requireBundleStatus(t, err, "missing_runtime")
	if strings.Contains(err.Error(), app) || strings.Contains(err.Error(), "Python") || !strings.Contains(err.Error(), "完整") {
		t.Fatalf("installation error is not user-facing: %v", err)
	}
	_, err = loadBundle(context.Background(), app, "linux", "amd64")
	requireBundleStatus(t, err, "unsupported_platform")
	_, err = loadBundle(context.Background(), app, "windows", "arm64")
	requireBundleStatus(t, err, "unsupported_platform")
}
func TestBundleRejectsSymlinkDirectoryAndFile(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("creating symlinks requires optional Windows developer permissions")
	}
	for _, isDirectory := range []bool{false, true} {
		t.Run(map[bool]string{false: "file", true: "directory"}[isDirectory], func(t *testing.T) {
			app, root, m := bundleFixture(t)
			name := filepath.Join(root, filepath.FromSlash(m.RuntimePath))
			if isDirectory {
				name = filepath.Join(root, "runtime")
			}
			outside := filepath.Join(t.TempDir(), "outside")
			if err := os.Rename(name, outside); err != nil {
				t.Fatal(err)
			}
			if err := os.Symlink(outside, name); err != nil {
				t.Fatal(err)
			}
			_, err := loadBundle(context.Background(), app, "windows", "amd64")
			requireBundleStatus(t, err, "incompatible_runtime")
		})
	}
}
func TestBundleCacheInvalidatesChangedFilesAndExplicitRescan(t *testing.T) {
	app, root, m := bundleFixture(t)
	p := &ProcessRunner{}
	b, err := p.resolveAt(context.Background(), app, "windows", "amd64")
	if err != nil {
		t.Fatal(err)
	}
	if p.verified.Fingerprint != b.Fingerprint {
		t.Fatal("verified installation not cached")
	}
	file := filepath.Join(root, filepath.FromSlash(m.Executable))
	if err = os.WriteFile(file, []byte("tampered"), 0600); err != nil {
		t.Fatal(err)
	}
	if err = os.Chtimes(file, time.Now(), time.Now().Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	_, err = p.resolveAt(context.Background(), app, "windows", "amd64")
	requireBundleStatus(t, err, "incompatible_runtime")
	p.InvalidateRuntime()
	if p.verified.Fingerprint != "" {
		t.Fatal("explicit recheck retained verified file hashes")
	}
}
func TestProductionRunnerIgnoresLegacyDeveloperSettings(t *testing.T) {
	// No executable is launched: the test executable has no private runtime.
	p := &ProcessRunner{}
	c, err := p.Probe(context.Background(), Settings{PythonPath: "must-not-run\x00", ToolRoot: "/arbitrary", RuntimePath: "/arbitrary.dll"})
	if err != nil || c.Available || (c.Status != "missing_runtime" && c.Status != "unsupported_platform") || strings.Contains(c.Reason, "Python") {
		t.Fatalf("legacy settings affected bundled execution: %+v %v", c, err)
	}
}
func TestBundleHashingHonorsCancellation(t *testing.T) {
	app, _, _ := bundleFixture(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := loadBundle(ctx, app, "windows", "amd64")
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled verification returned %v", err)
	}
}
