package studio

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func repairImage(t *testing.T) []byte {
	t.Helper()
	im := image.NewNRGBA(image.Rect(0, 0, 3, 2))
	im.SetNRGBA(1, 1, color.NRGBA{R: 90, G: 170, B: 30, A: 255})
	var out bytes.Buffer
	if err := png.Encode(&out, im); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}

// ImportHistory reaches storeAsset through a synced temporary Path, whereas
// Import supplies bytes. Neither test path talks to an upstream.
func reimportRepairAsset(t *testing.T, e *Engine, data []byte, mode string) (Asset, error) {
	t.Helper()
	if mode == "bytes" {
		return e.Import(data, "replacement-name.png")
	}
	source := filepath.Join(t.TempDir(), "old-output.png")
	if err := os.WriteFile(source, data, 0600); err != nil {
		t.Fatal(err)
	}
	job, err := e.ImportHistory(source, Request{ID: "repair-history", Source: "classic", ProjectID: "classic", Kind: "image", Prompt: "restored output"}, "2025-01-01T00:00:00Z", "generate", "")
	if remaining, readErr := os.ReadFile(source); readErr != nil || !bytes.Equal(remaining, data) {
		t.Fatal("history import changed its original source")
	}
	if err != nil {
		return Asset{}, err
	}
	asset, ok := e.Asset(job.ResultAssetID)
	if !ok {
		t.Fatal("path import did not preserve asset record")
	}
	return asset, nil
}

func TestAssetDedupRepairsMissingTruncatedAndSameSizeCorruptFiles(t *testing.T) {
	for _, mode := range []string{"bytes", "path"} {
		for _, damage := range []string{"missing", "truncated", "same-size-corrupt"} {
			t.Run(mode+"/"+damage, func(t *testing.T) {
				e, _, project := fixture(t, nil)
				data := repairImage(t)
				first, err := e.Import(data, "original-name.png")
				if err != nil {
					t.Fatal(err)
				}
				project.Nodes = []Node{{ID: "existing-reference", Kind: "asset", AssetID: first.ID, Title: "keep reference"}}
				if _, err := e.SaveProject(project); err != nil {
					t.Fatal(err)
				}
				target := filepath.Join(e.repo.mediaDir(), first.FileName)
				switch damage {
				case "missing":
					if err := os.Remove(target); err != nil {
						t.Fatal(err)
					}
				case "truncated":
					if err := os.WriteFile(target, data[:len(data)/2], 0600); err != nil {
						t.Fatal(err)
					}
				case "same-size-corrupt":
					corrupt := bytes.Clone(data)
					corrupt[len(corrupt)-1] ^= 0xff
					if err := os.WriteFile(target, corrupt, 0600); err != nil {
						t.Fatal(err)
					}
				}
				before, _ := os.Stat(target)
				// Windows resolves os.Stat file IDs lazily; capture the old ID
				// before the repair replaces the path.
				if before != nil && !os.SameFile(before, before) {
					t.Fatal("could not capture the damaged file identity")
				}
				repaired, err := reimportRepairAsset(t, e, data, mode)
				if err != nil {
					t.Fatal(err)
				}
				if repaired.ID != first.ID || repaired.FileName != first.FileName || repaired.Name != first.Name || repaired.CreatedAt != first.CreatedAt {
					t.Fatalf("asset identity changed: before=%+v after=%+v", first, repaired)
				}
				if repaired.Width != 3 || repaired.Height != 2 || repaired.OriginalWidth != 3 || repaired.OriginalHeight != 2 || repaired.Bytes != int64(len(data)) {
					t.Fatalf("lost native metadata: %+v", repaired)
				}
				actual, err := os.ReadFile(target)
				if err != nil || !bytes.Equal(actual, data) {
					t.Fatalf("file was not repaired: %v", err)
				}
				after, err := os.Stat(target)
				if err != nil {
					t.Fatal(err)
				}
				if before != nil && os.SameFile(before, after) {
					t.Fatal("repair overwrote the original file in place instead of publishing atomically")
				}
				var copied bytes.Buffer
				if err := e.CopyAssetTo(first.ID, &copied); err != nil || !bytes.Equal(copied.Bytes(), data) {
					t.Fatalf("old ID no longer reads repaired bytes: %v", err)
				}
				snapshot, err := e.Snapshot()
				if err != nil || len(snapshot.Assets) != 1 {
					t.Fatalf("dedup created another asset: %+v, %v", snapshot.Assets, err)
				}
				for _, p := range snapshot.Projects {
					if p.ID == project.ID && (len(p.Nodes) != 1 || p.Nodes[0].AssetID != first.ID) {
						t.Fatal("existing project reference changed")
					}
				}
				for _, pattern := range []string{".studio-tmp-*", ".incoming-*"} {
					leftovers, err := filepath.Glob(filepath.Join(e.repo.mediaDir(), pattern))
					if err != nil || len(leftovers) != 0 {
						t.Fatalf("temporary repair files left behind: %v %v", leftovers, err)
					}
				}
			})
		}
	}
}

func TestAssetDedupLeavesHealthyFileAndIdentityUntouched(t *testing.T) {
	for _, mode := range []string{"bytes", "path"} {
		t.Run(mode, func(t *testing.T) {
			e, _, _ := fixture(t, nil)
			data := repairImage(t)
			first, err := e.Import(data, "original.png")
			if err != nil {
				t.Fatal(err)
			}
			target := filepath.Join(e.repo.mediaDir(), first.FileName)
			stamp := time.Unix(1700000000, 0)
			if err := os.Chtimes(target, stamp, stamp); err != nil {
				t.Fatal(err)
			}
			before, err := os.Stat(target)
			if err != nil {
				t.Fatal(err)
			}
			afterAsset, err := reimportRepairAsset(t, e, data, mode)
			if err != nil || afterAsset != first {
				t.Fatalf("healthy identity changed: %+v %v", afterAsset, err)
			}
			after, err := os.Stat(target)
			if err != nil || !os.SameFile(before, after) || !before.ModTime().Equal(after.ModTime()) {
				t.Fatalf("healthy media was rewritten: %v", err)
			}
		})
	}
}

func TestAssetDedupRejectsUnsafeDestinationWithoutChangingIt(t *testing.T) {
	for _, mode := range []string{"bytes", "path"} {
		for _, entry := range []string{"directory", "symlink", "dangling-symlink"} {
			t.Run(mode+"/"+entry, func(t *testing.T) {
				e, _, _ := fixture(t, nil)
				data := repairImage(t)
				first, err := e.Import(data, "original.png")
				if err != nil {
					t.Fatal(err)
				}
				target := filepath.Join(e.repo.mediaDir(), first.FileName)
				if err := os.Remove(target); err != nil {
					t.Fatal(err)
				}
				outside := filepath.Join(t.TempDir(), "must-not-change.png")
				if entry == "directory" {
					if err := os.Mkdir(target, 0700); err != nil {
						t.Fatal(err)
					}
					if err := os.WriteFile(filepath.Join(target, "keep.txt"), []byte("keep"), 0600); err != nil {
						t.Fatal(err)
					}
				} else {
					if entry == "symlink" {
						if err := os.WriteFile(outside, data, 0600); err != nil {
							t.Fatal(err)
						}
					}
					if err := os.Symlink(outside, target); err != nil {
						t.Skipf("symlinks unavailable: %v", err)
					}
				}
				before, err := os.Lstat(target)
				if err != nil {
					t.Fatal(err)
				}
				if _, err := reimportRepairAsset(t, e, data, mode); err == nil {
					t.Fatal("unsafe destination was accepted")
				}
				after, err := os.Lstat(target)
				if err != nil || !os.SameFile(before, after) {
					t.Fatalf("unsafe destination was replaced: %v", err)
				}
				if entry == "symlink" {
					if got, err := os.ReadFile(outside); err != nil || !bytes.Equal(got, data) {
						t.Fatal("symlink destination changed")
					}
				}
				if entry == "directory" {
					if got, err := os.ReadFile(filepath.Join(target, "keep.txt")); err != nil || string(got) != "keep" {
						t.Fatal("directory contents changed")
					}
				}
				if current, ok := e.Asset(first.ID); !ok || current != first {
					t.Fatal("failed repair modified metadata")
				}
			})
		}
	}
}

func TestAssetImportRejectsUnsafeNewTargetAndMediaDirectory(t *testing.T) {
	for _, scenario := range []string{"new-target-symlink", "media-directory-symlink"} {
		t.Run(scenario, func(t *testing.T) {
			e, _, _ := fixture(t, nil)
			data := repairImage(t)
			sum := sha256.Sum256(data)
			filename := hex.EncodeToString(sum[:]) + ".png"
			outside := t.TempDir()
			protected := filepath.Join(outside, filename)
			if err := os.WriteFile(protected, []byte("keep"), 0600); err != nil {
				t.Fatal(err)
			}
			if scenario == "new-target-symlink" {
				if err := os.Symlink(protected, filepath.Join(e.repo.mediaDir(), filename)); err != nil {
					t.Skipf("symlinks unavailable: %v", err)
				}
			} else {
				if err := os.Remove(e.repo.mediaDir()); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(outside, e.repo.mediaDir()); err != nil {
					t.Skipf("symlinks unavailable: %v", err)
				}
			}
			if _, err := e.Import(data, "new.png"); err == nil {
				t.Fatal("unsafe import path accepted")
			}
			if got, err := os.ReadFile(protected); err != nil || string(got) != "keep" {
				t.Fatal("external file changed")
			}
		})
	}
}
