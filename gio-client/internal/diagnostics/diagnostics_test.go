package diagnostics

import (
	"testing"

	"image-studio/gio-client/internal/historymedia"
	"image-studio/gio-client/internal/ui"
)

func TestLikelyBottleneckPrefersBackfill(t *testing.T) {
	got := likelyStartupBottleneck(
		historymedia.Report{PreviewOnlyBackfillCandidates: 2},
		ui.HeadlessHistoryPerfReport{},
		ui.HeadlessResultPerfReport{},
	)
	if got != "history-media-backfill" {
		t.Fatalf("likelyBottleneck=%q want history-media-backfill", got)
	}
}

func TestLikelyBottleneckPrefersVisibleThumbColdPath(t *testing.T) {
	got := likelyStartupBottleneck(
		historymedia.Report{},
		ui.HeadlessHistoryPerfReport{VisibleThumbEligible: 18, VisibleThumbColdMs: 180, VisibleThumbAfterStartupPrewarmMs: 32},
		ui.HeadlessResultPerfReport{},
	)
	if got != "history-first-visible-thumbs" {
		t.Fatalf("likelyBottleneck=%q want history-first-visible-thumbs", got)
	}
}

func TestLikelyBottleneckPrefersManagedPreviewGap(t *testing.T) {
	got := likelyStartupBottleneck(
		historymedia.Report{},
		ui.HeadlessHistoryPerfReport{},
		ui.HeadlessResultPerfReport{HasResult: true, ColdMs: 220, ManagedPreviewReady: false},
	)
	if got != "result-canvas-cold-decode" {
		t.Fatalf("likelyBottleneck=%q want result-canvas-cold-decode", got)
	}
}

func TestLikelySteadyStateBottleneckTreatsPrewarmedHistoryAsHealthy(t *testing.T) {
	got := likelySteadyStateBottleneck(
		historymedia.Report{},
		ui.HeadlessHistoryPerfReport{VisibleThumbEligible: 18, VisibleThumbColdMs: 180, VisibleThumbAfterPrewarmMs: 2},
		ui.HeadlessResultPerfReport{HasResult: true, ManagedPreviewReady: true, WarmMs: 0.5, ReducedWarmMs: 0.5},
	)
	if got != "runtime-layout-or-gpu" {
		t.Fatalf("likelySteadyStateBottleneck=%q want runtime-layout-or-gpu", got)
	}
}
