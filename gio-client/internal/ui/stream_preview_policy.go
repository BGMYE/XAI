package ui

import "image-studio/gio-client/internal/kernel"

const desktopStreamPreviewConcurrencyLimit = 8

type streamPreviewDisableReason string

const (
	streamPreviewDisableReasonNone               streamPreviewDisableReason = ""
	streamPreviewDisableReasonDesktopConcurrency streamPreviewDisableReason = "desktop_concurrency"
)

func getStreamPreviewDisableReason(enabled bool, requestedConcurrency int) streamPreviewDisableReason {
	if !enabled {
		return streamPreviewDisableReasonNone
	}
	if requestedConcurrency >= desktopStreamPreviewConcurrencyLimit {
		return streamPreviewDisableReasonDesktopConcurrency
	}
	return streamPreviewDisableReasonNone
}

func (a *App) effectivePartialImagesForRun(cfg kernel.Config, requestedConcurrency int) (int, streamPreviewDisableReason) {
	partial := cfg.PartialImages
	if partial <= 0 {
		return 0, streamPreviewDisableReasonNone
	}
	if a.loopEnabled && !a.loopLivePreview {
		return 0, streamPreviewDisableReasonNone
	}
	reason := getStreamPreviewDisableReason(cfg.ProtectStreamPreview, requestedConcurrency)
	if reason != streamPreviewDisableReasonNone {
		return 0, reason
	}
	return partial, streamPreviewDisableReasonNone
}
