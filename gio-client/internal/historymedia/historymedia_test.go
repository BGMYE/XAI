package historymedia

import (
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"testing"

	shared "image-studio/shared/compat"
)

func writeTestPNG(t *testing.T, path string, width int, height int, fill color.NRGBA) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatalf("mkdir %s: %v", filepath.Dir(path), err)
	}
	file, err := os.Create(path)
	if err != nil {
		t.Fatalf("create %s: %v", path, err)
	}
	defer file.Close()
	img := image.NewNRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			img.SetNRGBA(x, y, fill)
		}
	}
	if err := png.Encode(file, img); err != nil {
		t.Fatalf("encode %s: %v", path, err)
	}
}

func TestBuildReportCountsCandidateKinds(t *testing.T) {
	dir := t.TempDir()
	savedPreviewOnly := filepath.Join(dir, "images", "preview-only.png")
	thumbPreviewOnly := filepath.Join(dir, "thumbs", "preview-only.png")
	savedHeavy := filepath.Join(dir, "images", "heavy.png")
	savedDone := filepath.Join(dir, "images", "done.png")
	thumbDone := filepath.Join(dir, "thumbs", "done.png")
	previewDone := filepath.Join(dir, "previews", "done.png")
	writeTestPNG(t, savedPreviewOnly, 512, 384, color.NRGBA{R: 0x11, G: 0x22, B: 0x33, A: 0xff})
	writeTestPNG(t, thumbPreviewOnly, 96, 72, color.NRGBA{R: 0x44, G: 0x55, B: 0x66, A: 0xff})
	writeTestPNG(t, savedHeavy, 512, 384, color.NRGBA{R: 0x77, G: 0x88, B: 0x99, A: 0xff})
	writeTestPNG(t, savedDone, 512, 384, color.NRGBA{R: 0xaa, G: 0xbb, B: 0xcc, A: 0xff})
	writeTestPNG(t, thumbDone, 96, 72, color.NRGBA{R: 0xcc, G: 0xbb, B: 0xaa, A: 0xff})
	writeTestPNG(t, previewDone, 64, 48, color.NRGBA{R: 0x99, G: 0x88, B: 0x77, A: 0xff})

	report := BuildReport(shared.State{
		Client: "webview2",
		History: []shared.HistoryItem{
			{ID: "preview-only", SavedPath: savedPreviewOnly, ThumbPath: thumbPreviewOnly},
			{ID: "heavy", SavedPath: savedHeavy},
			{ID: "done", SavedPath: savedDone, ThumbPath: thumbDone, PreviewPath: previewDone},
		},
	}, filepath.Join(dir, "state.json"))

	if report.HistoryCount != 3 {
		t.Fatalf("history_count=%d want 3", report.HistoryCount)
	}
	if report.SavedFilePresent != 3 || report.ThumbFilePresent != 2 || report.PreviewFilePresent != 1 {
		t.Fatalf("report=%+v", report)
	}
	if report.PreviewOnlyBackfillCandidates != 1 {
		t.Fatalf("preview_only_backfill_candidates=%d want 1", report.PreviewOnlyBackfillCandidates)
	}
	if report.HeavyBackfillCandidates != 1 {
		t.Fatalf("heavy_backfill_candidates=%d want 1", report.HeavyBackfillCandidates)
	}
}

func TestBuildBackfillUpdatesUsesExistingThumbForPreview(t *testing.T) {
	dir := t.TempDir()
	savedPath := filepath.Join(dir, "images", "source.png")
	thumbPath := filepath.Join(dir, "thumbs", "source.png")
	writeTestPNG(t, savedPath, 512, 384, color.NRGBA{R: 0x11, G: 0x22, B: 0x33, A: 0xff})
	writeTestPNG(t, thumbPath, 96, 72, color.NRGBA{R: 0x44, G: 0x55, B: 0x66, A: 0xff})

	updates, summary := BuildBackfillUpdates([]shared.HistoryItem{{
		ID:        "item-1",
		SavedPath: savedPath,
		ThumbPath: thumbPath,
	}}, 0, false)
	update, ok := updates["item-1"]
	if !ok {
		t.Fatalf("updates=%v want item-1", updates)
	}
	if update.PreviewPath == "" || update.ThumbPath != "" {
		t.Fatalf("update=%+v", update)
	}
	if !pathReady(update.PreviewPath) {
		t.Fatalf("preview path not ready: %s", update.PreviewPath)
	}
	if summary.PreviewPathsAdded != 1 || summary.ThumbPathsAdded != 0 || summary.FailedPaths != 0 {
		t.Fatalf("summary=%+v", summary)
	}
}

func TestBuildBackfillUpdatesAddsPreviewAndThumbForHeavyItem(t *testing.T) {
	dir := t.TempDir()
	savedPath := filepath.Join(dir, "images", "heavy.png")
	writeTestPNG(t, savedPath, 512, 384, color.NRGBA{R: 0x77, G: 0x88, B: 0x99, A: 0xff})

	updates, summary := BuildBackfillUpdates([]shared.HistoryItem{{
		ID:        "item-1",
		SavedPath: savedPath,
	}}, 0, false)
	update, ok := updates["item-1"]
	if !ok {
		t.Fatalf("updates=%v want item-1", updates)
	}
	if !pathReady(update.PreviewPath) || !pathReady(update.ThumbPath) {
		t.Fatalf("update=%+v", update)
	}
	if summary.PreviewPathsAdded != 1 || summary.ThumbPathsAdded != 1 || summary.FailedPaths != 0 {
		t.Fatalf("summary=%+v", summary)
	}
}
