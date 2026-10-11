package dlss5

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"strings"
)

const bundleRepair = "请重新安装或完整解压配套的 XAI Windows 版本，并保留 EXE 旁的 runtimes 文件夹。"

type bundleManifest struct {
	SchemaVersion   int          `json:"schemaVersion"`
	ProtocolVersion int          `json:"protocolVersion"`
	EngineVersion   string       `json:"engineVersion"`
	BundleVersion   string       `json:"bundleVersion,omitempty"`
	Platform        string       `json:"platform"`
	Architecture    string       `json:"architecture"`
	Executable      string       `json:"executable"`
	ToolRoot        string       `json:"toolRoot"`
	RuntimePath     string       `json:"runtimePath"`
	Files           []bundleFile `json:"files"`
}
type bundleFile struct {
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
}
type runtimeBundle struct {
	Root, Executable, ToolRoot, RuntimePath, Fingerprint string
	Manifest                                             bundleManifest
}
type bundleError struct{ Status, Message string }

func (e *bundleError) Error() string { return e.Message }
func invalidBundle() error {
	return &bundleError{"incompatible_runtime", "内置视频引擎文件不完整、已损坏或版本不兼容。" + bundleRepair}
}

// Bundle paths use a portable spelling, including Windows device/stream rules.
// The runtime may only read its private installation; user settings cannot
// select another worker executable or native library.
func validBundlePath(value string) bool {
	if value == "" || len(value) > 4096 || path.Clean(value) != value || path.IsAbs(value) || strings.ContainsAny(value, "\\:\x00\r\n") {
		return false
	}
	for _, part := range strings.Split(value, "/") {
		if part == ".." || part == "." || strings.TrimRight(part, ". ") != part {
			return false
		}
		stem := strings.ToUpper(strings.SplitN(part, ".", 2)[0])
		if stem == "CON" || stem == "PRN" || stem == "AUX" || stem == "NUL" || (len(stem) == 4 && (strings.HasPrefix(stem, "COM") || strings.HasPrefix(stem, "LPT")) && stem[3] >= '1' && stem[3] <= '9') {
			return false
		}
	}
	return true
}
func regularBundleFile(name string) (*os.File, error) {
	st, err := os.Lstat(name)
	if err != nil || !st.Mode().IsRegular() {
		return nil, invalidBundle()
	}
	f, err := os.Open(name)
	if err != nil {
		return nil, invalidBundle()
	}
	opened, err := f.Stat()
	if err != nil || !opened.Mode().IsRegular() || !os.SameFile(st, opened) {
		f.Close()
		return nil, invalidBundle()
	}
	return f, nil
}

// inspectBundle checks every directory/file and fingerprints installation
// metadata. ProcessRunner reuses hashes only while this fingerprint is stable;
// replacing a bundle invalidates both file verification and the GPU probe cache.
func inspectBundle(ctx context.Context, appExecutable, goos, goarch string) (runtimeBundle, error) {
	var b runtimeBundle
	if goos != "windows" || goarch != "amd64" {
		return b, &bundleError{"unsupported_platform", "内置视频增强当前仅支持 Windows x64 和兼容的 NVIDIA 显卡。"}
	}
	if !filepath.IsAbs(appExecutable) {
		return b, invalidBundle()
	}
	appDir := filepath.Dir(appExecutable)
	b.Root = filepath.Join(appDir, "runtimes", "dlss5")
	for _, dir := range []string{filepath.Join(appDir, "runtimes"), b.Root} {
		st, err := os.Lstat(dir)
		if errors.Is(err, os.ErrNotExist) {
			return b, &bundleError{"missing_runtime", "未找到内置视频引擎。" + bundleRepair}
		}
		if err != nil || !st.IsDir() || st.Mode()&os.ModeSymlink != 0 {
			return b, invalidBundle()
		}
	}
	manifestPath := filepath.Join(b.Root, "manifest.json")
	if _, err := os.Lstat(manifestPath); errors.Is(err, os.ErrNotExist) {
		return b, &bundleError{"missing_runtime", "未找到内置视频引擎。" + bundleRepair}
	}
	f, err := regularBundleFile(manifestPath)
	if err != nil {
		return b, err
	}
	data, err := io.ReadAll(io.LimitReader(f, (16<<20)+1))
	f.Close()
	if err != nil || len(data) > 16<<20 || json.Unmarshal(data, &b.Manifest) != nil {
		return b, invalidBundle()
	}
	m := b.Manifest
	if m.SchemaVersion != 1 || m.ProtocolVersion != 1 || m.Platform != "windows" || m.Architecture != "amd64" || strings.TrimSpace(m.EngineVersion) == "" || len(m.EngineVersion) > 200 || len(m.BundleVersion) > 200 || len(m.Files) < 2 || len(m.Files) > 100000 || m.Executable != "worker/xai-video-engine.exe" || m.ToolRoot != "runtime" || m.RuntimePath != "runtime/nvngx_dlssnr.dll" {
		return b, invalidBundle()
	}
	want := make(map[string]bundleFile, len(m.Files))
	folded := make(map[string]bool, len(m.Files))
	for _, entry := range m.Files {
		key := strings.ToLower(entry.Path)
		digest, err := hex.DecodeString(entry.SHA256)
		if !validBundlePath(entry.Path) || key == "manifest.json" || folded[key] || err != nil || len(digest) != sha256.Size || strings.ToLower(entry.SHA256) != entry.SHA256 {
			return b, invalidBundle()
		}
		folded[key] = true
		want[entry.Path] = entry
	}
	if _, ok := want[m.Executable]; !ok {
		return b, invalidBundle()
	}
	if _, ok := want[m.RuntimePath]; !ok {
		return b, invalidBundle()
	}
	fingerprint := sha256.New()
	fingerprint.Write(data)
	seen := 0
	err = filepath.WalkDir(b.Root, func(name string, entry fs.DirEntry, walkErr error) error {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if walkErr != nil || entry.Type()&os.ModeSymlink != 0 {
			return invalidBundle()
		}
		rel, err := filepath.Rel(b.Root, name)
		if err != nil {
			return invalidBundle()
		}
		rel = filepath.ToSlash(rel)
		if rel == "." {
			return nil
		}
		if !validBundlePath(rel) {
			return invalidBundle()
		}
		info, err := entry.Info()
		if err != nil || (!info.IsDir() && !info.Mode().IsRegular()) {
			return invalidBundle()
		}
		if entry.IsDir() {
			return nil
		}
		if rel != "manifest.json" {
			if _, ok := want[rel]; !ok {
				return invalidBundle()
			}
			seen++
		}
		fmt.Fprintf(fingerprint, "\x00%s\x00%d\x00%d\x00%d", rel, info.Size(), info.ModTime().UnixNano(), info.Mode())
		return nil
	})
	if err != nil {
		return b, err
	}
	if seen != len(want) {
		return b, invalidBundle()
	}
	b.Executable = filepath.Join(b.Root, filepath.FromSlash(m.Executable))
	b.ToolRoot = filepath.Join(b.Root, filepath.FromSlash(m.ToolRoot))
	b.RuntimePath = filepath.Join(b.Root, filepath.FromSlash(m.RuntimePath))
	st, err := os.Lstat(b.ToolRoot)
	if err != nil || !st.IsDir() {
		return b, invalidBundle()
	}
	b.Fingerprint = hex.EncodeToString(fingerprint.Sum(nil))
	return b, nil
}
func verifyBundle(ctx context.Context, b runtimeBundle) error {
	for _, entry := range b.Manifest.Files {
		if err := ctx.Err(); err != nil {
			return err
		}
		f, err := regularBundleFile(filepath.Join(b.Root, filepath.FromSlash(entry.Path)))
		if err != nil {
			return err
		}
		h := sha256.New()
		_, err = io.Copy(h, &contextReader{ctx, f})
		f.Close()
		if err != nil {
			return err
		}
		if hex.EncodeToString(h.Sum(nil)) != entry.SHA256 {
			return invalidBundle()
		}
	}
	return nil
}

type contextReader struct {
	ctx context.Context
	r   io.Reader
}

func (r *contextReader) Read(p []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.r.Read(p)
}
func loadBundle(ctx context.Context, appExecutable, goos, goarch string) (runtimeBundle, error) {
	b, err := inspectBundle(ctx, appExecutable, goos, goarch)
	if err == nil {
		err = verifyBundle(ctx, b)
	}
	return b, err
}
