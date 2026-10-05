// Package dlss5bridge embeds the credential-free Python NR adapter and its MIT core.
package dlss5bridge

import (
	"bytes"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sync"
)

//go:embed bridge.py vendor
var resources embed.FS

var materializeMu sync.Mutex

// Materialize writes the pinned adapter to a content-addressed user cache.
// It never reads the development checkout or downloads runtime binaries.
func Materialize(root string) (string, error) {
	materializeMu.Lock()
	defer materializeMu.Unlock()
	hash := sha256.New()
	names := make([]string, 0)
	err := fs.WalkDir(resources, ".", func(name string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		data, err := resources.ReadFile(name)
		if err != nil {
			return err
		}
		hash.Write([]byte(name))
		hash.Write([]byte{0})
		hash.Write(data)
		names = append(names, name)
		return nil
	})
	if err != nil {
		return "", fmt.Errorf("read DLSS bridge resources: %w", err)
	}
	destination := filepath.Join(root, hex.EncodeToString(hash.Sum(nil))[:24])
	if err := os.MkdirAll(destination, 0700); err != nil {
		return "", err
	}
	for _, name := range names {
		path := filepath.Join(destination, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			return "", err
		}
		// A native runtime never belongs in this managed source directory.
		data, err := resources.ReadFile(name)
		if err != nil {
			return "", err
		}
		if info, err := os.Lstat(path); err == nil {
			if !info.Mode().IsRegular() {
				return "", fmt.Errorf("DLSS cache is not a regular file: %s", path)
			}
			existing, err := os.ReadFile(path)
			if err != nil {
				return "", err
			}
			if bytes.Equal(existing, data) {
				continue
			}
			return "", fmt.Errorf("DLSS cache was modified; remove this cache directory and retry: %s", destination)
		} else if !os.IsNotExist(err) {
			return "", err
		}
		temporary, err := os.CreateTemp(filepath.Dir(path), ".bridge-*")
		if err != nil {
			return "", err
		}
		tempPath := temporary.Name()
		_, writeErr := temporary.Write(data)
		closeErr := temporary.Close()
		if writeErr != nil {
			os.Remove(tempPath)
			return "", writeErr
		}
		if closeErr != nil {
			os.Remove(tempPath)
			return "", closeErr
		}
		if err := os.Rename(tempPath, path); err != nil {
			os.Remove(tempPath)
			return "", err
		}
	}
	return filepath.Join(destination, "bridge.py"), nil
}

// Extract is retained for the process runner's concise call site.
func Extract(root string) (string, error) { return Materialize(root) }
