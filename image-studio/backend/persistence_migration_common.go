package backend

import (
	"bytes"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

var imageStudioStorageNeedles = [][]byte{
	[]byte("image-studio"),
	[]byte("historyFull"),
	[]byte("gptcodex."),
	[]byte("gptcodex:"),
}

type webviewMigrationCandidate struct {
	path  string
	score int64
}

func webviewMigrationCandidates(dstAbs string, legacyPaths []string) []webviewMigrationCandidate {
	candidates := make([]webviewMigrationCandidate, 0, len(legacyPaths))
	seen := map[string]struct{}{}
	for _, legacy := range legacyPaths {
		legacy = strings.TrimSpace(legacy)
		if legacy == "" {
			continue
		}
		legacyAbs, err := filepath.Abs(legacy)
		if err != nil || samePath(dstAbs, legacyAbs) {
			continue
		}
		key := strings.ToLower(filepath.Clean(legacyAbs))
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		if !dirExists(legacyAbs) {
			continue
		}
		score := imageStudioWebviewProfileScore(legacyAbs)
		if score <= 0 {
			continue
		}
		candidates = append(candidates, webviewMigrationCandidate{path: legacyAbs, score: score})
	}
	return candidates
}

func samePath(a, b string) bool {
	return strings.EqualFold(filepath.Clean(a), filepath.Clean(b))
}

func dirExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

func imageStudioWebviewProfileScore(path string) int64 {
	var total int64
	var matched int64
	for _, rel := range []string{"IndexedDB", "Local Storage", filepath.Join("WebsiteData", "Default")} {
		scanned, hit := storageDirScore(filepath.Join(path, rel))
		total += scanned
		matched += hit
	}
	if matched > 0 {
		return total + matched
	}
	return 0
}

func moveAsideEmptyWebviewProfile(path string) error {
	if !dirExists(path) {
		return nil
	}
	if !isEmptyOrDisposableWebviewProfile(path) {
		return os.ErrExist
	}
	target := path + ".empty-before-documents-migration"
	for i := 1; dirExists(target); i++ {
		target = path + ".empty-before-documents-migration-" + strconv.Itoa(i)
	}
	return os.Rename(path, target)
}

func isEmptyOrDisposableWebviewProfile(path string) bool {
	entries, err := os.ReadDir(path)
	if err != nil {
		return false
	}
	for _, entry := range entries {
		name := entry.Name()
		full := filepath.Join(path, name)
		if name == "Crashpad" || name == "BrowserMetrics" || name == "DevToolsActivePort" {
			continue
		}
		if name == "Network" || name == "Default" || name == "ShaderCache" || name == "GrShaderCache" || name == "WebsiteData" {
			if dirSize(full) == 0 {
				continue
			}
		}
		return false
	}
	return true
}

func dirSize(path string) int64 {
	var size int64
	_ = filepath.WalkDir(path, func(walkPath string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil || entry.IsDir() || entry.Type()&os.ModeSymlink != 0 {
			return nil
		}
		info, err := entry.Info()
		if err == nil {
			size += info.Size()
		}
		_ = walkPath
		return nil
	})
	return size
}

func storageDirScore(path string) (int64, int64) {
	var total int64
	var matched int64
	_ = filepath.WalkDir(path, func(walkPath string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil || entry.IsDir() || entry.Type()&os.ModeSymlink != 0 {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return nil
		}
		total += info.Size()
		if fileContainsAny(walkPath, imageStudioStorageNeedles) {
			matched += info.Size()
		}
		return nil
	})
	return total, matched
}

func fileContainsAny(path string, needles [][]byte) bool {
	data, err := os.ReadFile(path)
	if err != nil {
		return false
	}
	for _, needle := range needles {
		if bytes.Contains(data, needle) {
			return true
		}
	}
	return false
}

func copyDir(src, dst string) error {
	return filepath.WalkDir(src, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)
		if entry.IsDir() {
			return os.MkdirAll(target, secureDirMode)
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		return copyFile(src, dst, rel, info)
	})
}

func copyFile(srcRoot, dstRoot, rel string, info fs.FileInfo) error {
	src := filepath.Join(srcRoot, rel)
	dst := filepath.Join(dstRoot, rel)
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	if err := os.MkdirAll(filepath.Dir(dst), secureDirMode); err != nil {
		return err
	}
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, info.Mode().Perm())
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(out, in)
	closeErr := out.Close()
	if copyErr != nil {
		return copyErr
	}
	if closeErr != nil {
		return closeErr
	}
	mtime := info.ModTime()
	if mtime.IsZero() {
		mtime = time.Now()
	}
	return os.Chtimes(dst, mtime, mtime)
}
