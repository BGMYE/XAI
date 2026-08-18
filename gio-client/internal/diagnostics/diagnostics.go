package diagnostics

import (
	"fmt"

	"image-studio/gio-client/internal/historymedia"
	"image-studio/gio-client/internal/ui"
	shared "image-studio/shared/compat"
)

type CombinedReport struct {
	HistoryMedia          historymedia.Report          `json:"history_media"`
	HistoryPerf           ui.HeadlessHistoryPerfReport `json:"history_perf"`
	ResultPerf            ui.HeadlessResultPerfReport  `json:"result_perf"`
	LikelyBottleneck      string                       `json:"likely_bottleneck"`
	StartupBottleneck     string                       `json:"startup_bottleneck"`
	SteadyStateBottleneck string                       `json:"steady_state_bottleneck"`
	Summary               string                       `json:"summary"`
	StartupSummary        string                       `json:"startup_summary"`
	SteadyStateSummary    string                       `json:"steady_state_summary"`
}

func BuildCombinedReport(state shared.State, statePath string) CombinedReport {
	historyMediaReport := historymedia.BuildReport(state, statePath)
	historyPerfReport := ui.BuildHeadlessHistoryPerfReport(state.History)
	resultPerfReport := ui.BuildHeadlessResultPerfReport(state.History)
	startup := likelyStartupBottleneck(historyMediaReport, historyPerfReport, resultPerfReport)
	steady := likelySteadyStateBottleneck(historyMediaReport, historyPerfReport, resultPerfReport)
	return CombinedReport{
		HistoryMedia:          historyMediaReport,
		HistoryPerf:           historyPerfReport,
		ResultPerf:            resultPerfReport,
		LikelyBottleneck:      startup,
		StartupBottleneck:     startup,
		SteadyStateBottleneck: steady,
		Summary:               summarizeLikelyBottleneck(startup, historyMediaReport, historyPerfReport, resultPerfReport),
		StartupSummary:        summarizeLikelyBottleneck(startup, historyMediaReport, historyPerfReport, resultPerfReport),
		SteadyStateSummary:    summarizeSteadyStateBottleneck(steady, historyMediaReport, historyPerfReport, resultPerfReport),
	}
}

func likelyStartupBottleneck(historyReport historymedia.Report, historyPerf ui.HeadlessHistoryPerfReport, resultPerf ui.HeadlessResultPerfReport) string {
	switch {
	case historyReport.PreviewOnlyBackfillCandidates > 0 || historyReport.HeavyBackfillCandidates > 0:
		return "history-media-backfill"
	case historyPerf.VisibleThumbEligible > 0 && historyPerf.VisibleThumbAfterStartupPrewarmMs > 20:
		return "history-first-visible-thumbs"
	case resultPerf.HasResult && !resultPerf.ManagedPreviewReady && resultPerf.ColdMs > 100:
		return "result-canvas-cold-decode"
	case resultPerf.HasResult && resultPerf.ManagedPreviewReady && resultPerf.ColdMs > 100 && resultPerf.ManagedPreviewMs > 0 && resultPerf.ManagedPreviewMs <= maxFloat64(20, resultPerf.ColdMs*0.5):
		return "result-canvas-managed-preview"
	case historyPerf.HistoryPanelColdMs > 10 || historyPerf.HistoryTimelineColdMs > 10 || historyPerf.TimelineModalColdMs > 10:
		return "history-layout-grouping"
	default:
		return "runtime-layout-or-gpu"
	}
}

func likelySteadyStateBottleneck(historyReport historymedia.Report, historyPerf ui.HeadlessHistoryPerfReport, resultPerf ui.HeadlessResultPerfReport) string {
	switch {
	case historyReport.PreviewOnlyBackfillCandidates > 0 || historyReport.HeavyBackfillCandidates > 0:
		return "history-media-backfill"
	case historyPerf.VisibleThumbEligible > 0 && historyPerf.VisibleThumbAfterPrewarmMs > 5:
		return "history-visible-thumbs-steady"
	case resultPerf.HasResult && !resultPerf.ManagedPreviewReady && resultPerf.ColdMs > 100:
		return "result-canvas-cold-decode"
	case resultPerf.HasResult && (resultPerf.WarmMs > 10 || resultPerf.ReducedWarmMs > 10):
		return "result-canvas-cache-miss"
	case historyPerf.HistoryPanelColdMs > 10 || historyPerf.HistoryTimelineColdMs > 10 || historyPerf.TimelineModalColdMs > 10:
		return "history-layout-grouping"
	default:
		return "runtime-layout-or-gpu"
	}
}

func summarizeLikelyBottleneck(kind string, historyReport historymedia.Report, historyPerf ui.HeadlessHistoryPerfReport, resultPerf ui.HeadlessResultPerfReport) string {
	switch kind {
	case "history-media-backfill":
		return fmt.Sprintf("历史媒体还没补齐：preview-only=%d, heavy=%d。优先跑历史媒体回填。", historyReport.PreviewOnlyBackfillCandidates, historyReport.HeavyBackfillCandidates)
	case "history-first-visible-thumbs":
		return fmt.Sprintf("历史首屏缩略图在启动微预热后仍偏重：cold=%.1fms, after-startup-prewarm=%.1fms。", historyPerf.VisibleThumbColdMs, historyPerf.VisibleThumbAfterStartupPrewarmMs)
	case "result-canvas-cold-decode":
		return fmt.Sprintf("当前结果画布仍在走重冷解码：cold=%.1fms，且还没有受管画布预览。", resultPerf.ColdMs)
	case "result-canvas-managed-preview":
		return fmt.Sprintf("当前结果画布冷加载主要来自首次生成受管画布预览：cold=%.1fms, managed=%.1fms。", resultPerf.ColdMs, resultPerf.ManagedPreviewMs)
	case "history-layout-grouping":
		return fmt.Sprintf("历史分组/时间线本身已经开始显著：panel=%.1fms, timeline=%.1fms, modal=%.1fms。", historyPerf.HistoryPanelColdMs, historyPerf.HistoryTimelineColdMs, historyPerf.TimelineModalColdMs)
	default:
		return "历史媒体和结果画布链路都相对健康，剩余瓶颈更可能在真实运行时布局、GPU 或窗口尺寸相关路径。"
	}
}

func summarizeSteadyStateBottleneck(kind string, historyReport historymedia.Report, historyPerf ui.HeadlessHistoryPerfReport, resultPerf ui.HeadlessResultPerfReport) string {
	switch kind {
	case "history-media-backfill":
		return fmt.Sprintf("稳定阶段前仍需先补齐历史媒体：preview-only=%d, heavy=%d。", historyReport.PreviewOnlyBackfillCandidates, historyReport.HeavyBackfillCandidates)
	case "history-visible-thumbs-steady":
		return fmt.Sprintf("即使预热后，历史可见缩略图仍偏重：after-prewarm=%.1fms。", historyPerf.VisibleThumbAfterPrewarmMs)
	case "result-canvas-cold-decode":
		return fmt.Sprintf("当前结果画布稳定阶段仍会走重冷解码：cold=%.1fms，且没有受管画布预览。", resultPerf.ColdMs)
	case "result-canvas-cache-miss":
		return fmt.Sprintf("当前结果画布稳定阶段还有缓存未命中：warm=%.1fms, reduced_warm=%.1fms。", resultPerf.WarmMs, resultPerf.ReducedWarmMs)
	case "history-layout-grouping":
		return fmt.Sprintf("历史分组/时间线本身在稳定阶段已经偏重：panel=%.1fms, timeline=%.1fms, modal=%.1fms。", historyPerf.HistoryPanelColdMs, historyPerf.HistoryTimelineColdMs, historyPerf.TimelineModalColdMs)
	default:
		return "稳定阶段下，历史媒体和结果画布链路都相对健康，剩余瓶颈更可能在真实运行时布局、GPU 或窗口尺寸相关路径。"
	}
}

func maxFloat64(a float64, b float64) float64 {
	if a > b {
		return a
	}
	return b
}
