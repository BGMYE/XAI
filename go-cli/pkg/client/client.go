package client

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// RequestAndExtract performs one HTTP request (no retry) and returns the parsed image.
// It writes the raw response stream to rawSink, and (optionally) reports progress
// via the supplied callback. The callback is invoked from the goroutine that calls
// RequestAndExtract; receivers should be cheap or buffer internally.
func RequestAndExtract(
	ctx context.Context,
	transport Transport,
	opts Options,
	rawSink io.Writer,
	onProgress func(stage string, elapsedSeconds int, bytesReceived int64),
) (ImageResult, error) {
	return RequestAndExtractWithPartial(ctx, transport, opts, rawSink, onProgress, nil)
}

func RequestAndExtractWithPartial(
	ctx context.Context,
	transport Transport,
	opts Options,
	rawSink io.Writer,
	onProgress func(stage string, elapsedSeconds int, bytesReceived int64),
	onPartial func(PartialImage),
) (ImageResult, error) {
	payload, err := BuildPayload(opts)
	if err != nil {
		return ImageResult{}, err
	}

	baseURL := strings.TrimSpace(opts.BaseURL)
	if baseURL == "" {
		baseURL = strings.TrimSpace(BaseURL)
	}
	if baseURL == "" {
		return ImageResult{}, errors.New("未配置上游 BASE_URL,请在「设置 → 上游 BASE_URL」中填入兼容 Responses API 的中转站地址")
	}
	baseURL, err = ValidateAPIBaseURL(baseURL, opts.AllowInsecureConnection)
	if err != nil {
		return ImageResult{}, err
	}
	req := Request{
		URL:     OpenAIAPIEndpoint(baseURL, "responses"),
		APIKey:  opts.APIKey,
		Payload: payload,
	}

	collector := newResponseCollectorWithPartial(rawSink, onPartial)

	progressCh := make(chan string, 16)
	done := make(chan error, 1)
	startedAt := time.Now()

	go func() {
		done <- transport.Stream(ctx, req, collector, progressCh)
		close(progressCh)
	}()

	ticker := time.NewTicker(time.Duration(StatusIntervalSecond) * time.Second)
	defer ticker.Stop()

	lastStage := "等待接口响应"
	var streamErr error
loop:
	for {
		select {
		case <-ctx.Done():
			// Wait for goroutine to wind down so we don't leak.
			<-done
			result, _ := collector.result()
			return result, ctx.Err()
		case err, ok := <-done:
			if ok {
				streamErr = err
			}
			break loop
		case stage, ok := <-progressCh:
			if !ok {
				// Channel closed before done signal — drain.
				continue
			}
			lastStage = stage
			if onProgress != nil {
				elapsed := int(time.Since(startedAt).Seconds())
				onProgress(lastStage, elapsed, collector.bytesReceived())
			}
		case <-ticker.C:
			if onProgress != nil {
				elapsed := int(time.Since(startedAt).Seconds())
				onProgress(lastStage, elapsed, collector.bytesReceived())
			}
		}
	}

	if streamErr != nil {
		result, parseErr := collector.result()
		var status *HTTPStatusError
		if errors.As(streamErr, &status) {
			if status.StatusCode < 500 {
				result.Status = "failed"
			} else {
				result.Status = "uncertain"
			}
			return result, streamErr
		}
		// A complete image is useful even when a subsequent read fails. Keep
		// Status uncertain unless the terminal event was actually observed.
		if parseErr == nil && len(result.Images) > 0 {
			return result, nil
		}
		return result, streamErr
	}

	return collector.result()
}

// RequestAndExtractWithRetries wraps RequestAndExtract with the same retry
// policy as the Python script. It writes one raw-response file per attempt
// (sse-response-{timestamp}-attempt{N}.txt) under outputDir.
//
// Dispatches between the Responses API SSE flow and the standard Images API
// based on opts.APIMode. Empty / "responses" → SSE; "images" → Images API.
//
// Returns the final ImageResult and the path of the last raw-response file
// (handy for the CLI to print).
func RequestAndExtractWithRetries(
	ctx context.Context,
	transport Transport,
	opts Options,
	outputDir string,
	timestamp string,
	onLog func(string),
	onProgress func(stage string, elapsed int, bytes int64),
) (ImageResult, string, error) {
	return RequestAndExtractWithRetriesAndPartial(ctx, transport, opts, outputDir, timestamp, onLog, onProgress, nil)
}

func RequestAndExtractWithRetriesAndPartial(
	ctx context.Context,
	transport Transport,
	opts Options,
	outputDir string,
	timestamp string,
	onLog func(string),
	onProgress func(stage string, elapsed int, bytes int64),
	onPartial func(PartialImage),
) (ImageResult, string, error) {
	if opts.APIMode == APIModeImages {
		return imagesAPIWithRetries(ctx, opts, outputDir, timestamp, onLog, onProgress, onPartial)
	}
	return responsesAPIWithRetries(ctx, transport, opts, outputDir, timestamp, onLog, onProgress, onPartial)
}

func RequestAndExtractWithRetriesAndPartialInMemory(
	ctx context.Context,
	transport Transport,
	opts Options,
	onLog func(string),
	onProgress func(stage string, elapsed int, bytes int64),
	onPartial func(PartialImage),
) (ImageResult, string, error) {
	if opts.APIMode == APIModeImages {
		return imagesAPIWithRetriesInMemory(ctx, opts, onLog, onProgress, onPartial)
	}
	return responsesAPIWithRetriesInMemory(ctx, transport, opts, onLog, onProgress, onPartial)
}

func effectiveMaxAttempts(opts Options) int {
	retryCount := opts.AutoRetryCount
	if retryCount <= 0 {
		retryCount = DefaultAutoRetryCount
	}
	if retryCount > MaxAutoRetryCount {
		retryCount = MaxAutoRetryCount
	}
	return retryCount + 1
}

func responsesAPIWithRetries(
	ctx context.Context,
	transport Transport,
	opts Options,
	outputDir string,
	timestamp string,
	onLog func(string),
	onProgress func(stage string, elapsed int, bytes int64),
	onPartial func(PartialImage),
) (ImageResult, string, error) {
	if onLog == nil {
		onLog = func(string) {}
	}

	if err := os.MkdirAll(outputDir, 0o700); err != nil {
		return ImageResult{}, "", fmt.Errorf("create output dir: %w", err)
	}

	var lastErr error
	var lastPath string
	autoRetryEnabled := true
	if opts.AutoRetryEnabled != nil && !*opts.AutoRetryEnabled {
		autoRetryEnabled = false
	}
	maxAttempts := effectiveMaxAttempts(opts)
	sizeRepairTried := false

	for attempt := 1; attempt <= maxAttempts; attempt++ {
		rawPrefix := "sse-response"
		if normalizeResponsesTransport(opts.ResponsesTransport) == ResponsesTransportWebSocket {
			rawPrefix = "ws-response"
		}
		rawPath := filepath.Join(outputDir, fmt.Sprintf("%s-%s-attempt%d.txt", rawPrefix, timestamp, attempt))
		lastPath = rawPath
		onLog(fmt.Sprintf("第 %d/%d 次请求...", attempt, maxAttempts))

		f, err := os.OpenFile(rawPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
		if err != nil {
			return ImageResult{}, lastPath, fmt.Errorf("create raw response file: %w", err)
		}

		var (
			result ImageResult
			reqErr error
		)
		if normalizeResponsesTransport(opts.ResponsesTransport) == ResponsesTransportWebSocket {
			result, reqErr = requestResponsesWithWebSocketReplay(ctx, opts, f, onProgress, onPartial, attempt, onLog)
		} else {
			result, reqErr = RequestAndExtractWithPartial(ctx, transport, opts, f, onProgress, onPartial)
		}
		f.Close()

		if reqErr == nil {
			return result, rawPath, nil
		}

		// Decide whether to retry based on the body we just wrote.
		rawBytes, _ := os.ReadFile(rawPath)
		raw := string(rawBytes)

		if !sizeRepairTried {
			if repairedOpts, repaired, reason := repairSizeRetryOptions(opts, raw, reqErr); repaired {
				sizeRepairTried = true
				opts = repairedOpts
				onLog(reason)
				continue
			}
		}

		if errors.Is(reqErr, ErrNoImageInResponse) {
			lastErr = reqErr
			reason := DescribeProblem(raw)
			if autoRetryEnabled && !workerAlreadyRetried(raw) && attempt < maxAttempts && SafeToRetry(reqErr) {
				onLog(reason)
				onLog(fmt.Sprintf("这是可重试错误,%d 秒后自动重试...", RetryBackoffSeconds))
				if !sleepCtx(ctx, time.Duration(RetryBackoffSeconds)*time.Second) {
					return ImageResult{}, lastPath, ctx.Err()
				}
				continue
			}
			// 路径不再拼进 error message;调用方通过返回值里的 lastPath
			// 单独拿,前端用「查看日志」按钮直接打开。
			return result, lastPath, submissionError(fmt.Errorf("%s", reason))
		}

		// Transport-level error (network / native HTTP failure). Retry up to MaxAttempts.
		lastErr = reqErr
		if autoRetryEnabled && !workerAlreadyRetried(raw) && attempt < maxAttempts && SafeToRetry(reqErr) {
			onLog(fmt.Sprintf("%v", reqErr))
			onLog(fmt.Sprintf("%d 秒后自动重试...", RetryBackoffSeconds))
			if !sleepCtx(ctx, time.Duration(RetryBackoffSeconds)*time.Second) {
				return ImageResult{}, lastPath, ctx.Err()
			}
			continue
		}
		return result, lastPath, submissionError(reqErr)
	}

	if lastErr != nil {
		return ImageResult{}, lastPath, fmt.Errorf("多次请求后仍未成功:%w", lastErr)
	}
	return ImageResult{}, lastPath, fmt.Errorf("多次请求后仍未成功")
}

func responsesAPIWithRetriesInMemory(
	ctx context.Context,
	transport Transport,
	opts Options,
	onLog func(string),
	onProgress func(stage string, elapsed int, bytes int64),
	onPartial func(PartialImage),
) (ImageResult, string, error) {
	if onLog == nil {
		onLog = func(string) {}
	}

	var lastErr error
	var lastRaw string
	autoRetryEnabled := true
	if opts.AutoRetryEnabled != nil && !*opts.AutoRetryEnabled {
		autoRetryEnabled = false
	}
	maxAttempts := effectiveMaxAttempts(opts)
	sizeRepairTried := false

	for attempt := 1; attempt <= maxAttempts; attempt++ {
		onLog(fmt.Sprintf("第 %d/%d 次请求...", attempt, maxAttempts))

		var (
			buf    bytes.Buffer
			result ImageResult
			reqErr error
		)
		if normalizeResponsesTransport(opts.ResponsesTransport) == ResponsesTransportWebSocket {
			result, reqErr = requestResponsesWithWebSocketReplay(ctx, opts, &buf, onProgress, onPartial, attempt, onLog)
		} else {
			result, reqErr = RequestAndExtractWithPartial(ctx, transport, opts, &buf, onProgress, onPartial)
		}
		raw := buf.String()
		lastRaw = raw

		if reqErr == nil {
			return result, raw, nil
		}

		if !sizeRepairTried {
			if repairedOpts, repaired, reason := repairSizeRetryOptions(opts, raw, reqErr); repaired {
				sizeRepairTried = true
				opts = repairedOpts
				onLog(reason)
				continue
			}
		}

		if errors.Is(reqErr, ErrNoImageInResponse) {
			lastErr = reqErr
			reason := DescribeProblem(raw)
			if autoRetryEnabled && !workerAlreadyRetried(raw) && attempt < maxAttempts && SafeToRetry(reqErr) {
				onLog(reason)
				onLog(fmt.Sprintf("这是可重试错误,%d 秒后自动重试...", RetryBackoffSeconds))
				if !sleepCtx(ctx, time.Duration(RetryBackoffSeconds)*time.Second) {
					return ImageResult{}, lastRaw, ctx.Err()
				}
				continue
			}
			return result, raw, submissionError(fmt.Errorf("%s", reason))
		}

		lastErr = reqErr
		if autoRetryEnabled && !workerAlreadyRetried(raw) && attempt < maxAttempts && SafeToRetry(reqErr) {
			onLog(fmt.Sprintf("%v", reqErr))
			onLog(fmt.Sprintf("%d 秒后自动重试...", RetryBackoffSeconds))
			if !sleepCtx(ctx, time.Duration(RetryBackoffSeconds)*time.Second) {
				return ImageResult{}, lastRaw, ctx.Err()
			}
			continue
		}
		return result, raw, submissionError(reqErr)
	}

	if lastErr != nil {
		return ImageResult{}, lastRaw, fmt.Errorf("多次请求后仍未成功:%w", lastErr)
	}
	return ImageResult{}, lastRaw, fmt.Errorf("多次请求后仍未成功")
}

func sleepCtx(ctx context.Context, d time.Duration) bool {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-t.C:
		return true
	}
}

// imagesAPIWithRetries retries only failures proven to occur before submission. Raw response per attempt is dumped to
// images-response-{timestamp}-attempt{N}.json so users can inspect upstream
// error messages.
func imagesAPIWithRetries(
	ctx context.Context,
	opts Options,
	outputDir string,
	timestamp string,
	onLog func(string),
	onProgress func(stage string, elapsed int, bytes int64),
	onPartial func(PartialImage),
) (ImageResult, string, error) {
	if onLog == nil {
		onLog = func(string) {}
	}
	if err := os.MkdirAll(outputDir, 0o700); err != nil {
		return ImageResult{}, "", fmt.Errorf("create output dir: %w", err)
	}

	var lastErr error
	var lastPath string
	autoRetryEnabled := true
	if opts.AutoRetryEnabled != nil && !*opts.AutoRetryEnabled {
		autoRetryEnabled = false
	}
	maxAttempts := effectiveMaxAttempts(opts)
	sizeRepairTried := false

	for attempt := 1; attempt <= maxAttempts; attempt++ {
		rawPath := filepath.Join(outputDir, fmt.Sprintf("images-response-%s-attempt%d.json", timestamp, attempt))
		lastPath = rawPath
		onLog(fmt.Sprintf("[Images API] 第 %d/%d 次请求...", attempt, maxAttempts))

		f, err := os.OpenFile(rawPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
		if err != nil {
			return ImageResult{}, lastPath, fmt.Errorf("create raw response file: %w", err)
		}
		result, reqErr := RequestImagesAPIWithPartial(ctx, opts, f, onProgress, onPartial)
		f.Close()

		if reqErr == nil {
			return result, rawPath, nil
		}

		rawBytes, _ := os.ReadFile(rawPath)
		raw := string(rawBytes)

		if !sizeRepairTried {
			if repairedOpts, repaired, reason := repairSizeRetryOptions(opts, raw, reqErr); repaired {
				sizeRepairTried = true
				opts = repairedOpts
				onLog(reason)
				continue
			}
		}

		lastErr = reqErr
		// Only a proven pre-submission failure is safe to retry automatically.
		if autoRetryEnabled && !workerAlreadyRetried(raw) && attempt < maxAttempts && SafeToRetry(reqErr) {
			onLog(fmt.Sprintf("%v", reqErr))
			onLog(fmt.Sprintf("%d 秒后自动重试...", RetryBackoffSeconds))
			if !sleepCtx(ctx, time.Duration(RetryBackoffSeconds)*time.Second) {
				return ImageResult{}, lastPath, ctx.Err()
			}
			continue
		}
		// 同上,raw 路径靠返回值带,不再嵌进 error message。
		return result, lastPath, submissionError(reqErr)
	}

	return ImageResult{}, lastPath, fmt.Errorf("多次请求后仍未成功:%w", lastErr)
}

func imagesAPIWithRetriesInMemory(
	ctx context.Context,
	opts Options,
	onLog func(string),
	onProgress func(stage string, elapsed int, bytes int64),
	onPartial func(PartialImage),
) (ImageResult, string, error) {
	if onLog == nil {
		onLog = func(string) {}
	}

	var lastErr error
	var lastRaw string
	autoRetryEnabled := true
	if opts.AutoRetryEnabled != nil && !*opts.AutoRetryEnabled {
		autoRetryEnabled = false
	}
	maxAttempts := effectiveMaxAttempts(opts)
	sizeRepairTried := false

	for attempt := 1; attempt <= maxAttempts; attempt++ {
		onLog(fmt.Sprintf("[Images API] 第 %d/%d 次请求...", attempt, maxAttempts))

		var buf bytes.Buffer
		result, reqErr := RequestImagesAPIWithPartial(ctx, opts, &buf, onProgress, onPartial)
		raw := buf.String()
		lastRaw = raw

		if reqErr == nil {
			return result, raw, nil
		}

		if !sizeRepairTried {
			if repairedOpts, repaired, reason := repairSizeRetryOptions(opts, raw, reqErr); repaired {
				sizeRepairTried = true
				opts = repairedOpts
				onLog(reason)
				continue
			}
		}

		lastErr = reqErr
		if autoRetryEnabled && !workerAlreadyRetried(raw) && attempt < maxAttempts && SafeToRetry(reqErr) {
			onLog(fmt.Sprintf("%v", reqErr))
			onLog(fmt.Sprintf("%d 秒后自动重试...", RetryBackoffSeconds))
			if !sleepCtx(ctx, time.Duration(RetryBackoffSeconds)*time.Second) {
				return ImageResult{}, lastRaw, ctx.Err()
			}
			continue
		}
		return result, raw, submissionError(reqErr)
	}

	return ImageResult{}, lastRaw, fmt.Errorf("多次请求后仍未成功:%w", lastErr)
}

func repairSizeRetryOptions(opts Options, raw string, reqErr error) (Options, bool, string) {
	// Even a later 400 must not replay a generation that already emitted
	// acceptance/progress/preview/final events.
	for event := range IterEvents(raw) {
		typ, _ := event["type"].(string)
		if (strings.HasPrefix(typ, "response.") && typ != "response.failed") || strings.HasPrefix(typ, "image_generation.") || strings.HasPrefix(typ, "image_edit.") {
			return opts, false, ""
		}
	}
	var status *HTTPStatusError
	if !errors.As(reqErr, &status) || status.StatusCode != http.StatusBadRequest {
		return opts, false, ""
	}
	if extractInvalidSize(raw) == "" && (reqErr == nil || extractInvalidSize(reqErr.Error()) == "") {
		return opts, false, ""
	}
	repaired := repairSizeForOpenAIOptions(opts)
	if repaired == nil {
		return opts, false, ""
	}
	return *repaired, true, fmt.Sprintf("检测到上游拒绝当前尺寸 %s，自动改为最近合法尺寸 %s 后重试一次...", opts.Size, repaired.Size)
}
