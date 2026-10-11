package client

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"iter"
	"strings"
)

// Event is one decoded SSE JSON object (the part after `data: `).
type Event map[string]any

func decodeEvent(payload string, ev *Event) error {
	return json.Unmarshal([]byte(payload), ev)
}

// IterEvents uses the same SSE frame decoder as live HTTP and WebSocket streams.
func IterEvents(raw string) iter.Seq[Event] {
	return func(yield func(Event) bool) {
		stopped := false
		decoder := sseFrameDecoder{onEvent: func(ev Event) {
			if !stopped {
				stopped = !yield(ev)
			}
		}}
		for line := range strings.SplitSeq(raw, "\n") {
			if decoder.consumeLine(line) != nil || stopped {
				return
			}
		}
		decoder.flush()
	}
}

// ExtractImageResult returns every complete image plus legacy first-image
// fields. Previews never count as final images; terminal failures remain errors.
func ExtractImageResult(raw string) (ImageResult, error) {
	collector := newResponseCollector(nil)
	if _, err := collector.Write([]byte(raw)); err != nil {
		return ImageResult{}, err
	}
	return collector.result()
}

func findImageResultInJSON(raw string) (ImageResult, bool) {
	var ev Event
	if decodeEvent(raw, &ev) != nil || ev == nil {
		return ImageResult{}, false
	}
	extractor := streamImageExtractor{}
	extractor.consumeDocument(ev)
	res, err := extractor.resultWithError()
	return res, err == nil
}

// SummarizeSSELine turns one raw SSE line into a Chinese status string, or "" if not noteworthy.
// Mirrors Python summarize_sse_line.
func SummarizeSSELine(line string) string {
	stripped := strings.TrimSpace(line)
	if stripped == "" {
		return ""
	}
	if strings.HasPrefix(stripped, ":") {
		return "收到接口保活信号"
	}
	if !strings.HasPrefix(stripped, "data:") {
		return ""
	}
	payload := strings.TrimSpace(stripped[5:])
	var ev Event
	if err := decodeEvent(payload, &ev); err != nil {
		return ""
	}
	evType, _ := ev["type"].(string)
	switch evType {
	case "response.created":
		return "请求已创建"
	case "response.in_progress":
		return "模型处理中"
	case "response.image_generation_call.in_progress":
		return "图片工具已启动"
	case "response.image_generation_call.generating":
		return "图片正在生成"
	case "response.image_generation_call.partial_image":
		return "已收到图片数据片段"
	case "response.output_item.done":
		item, _ := ev["item"].(map[string]any)
		if t, _ := item["type"].(string); t == "image_generation_call" {
			if r, _ := item["result"].(string); r != "" {
				return "图片生成完成,正在保存"
			}
			status, _ := item["status"].(string)
			if status == "" {
				status = "未知"
			}
			return fmt.Sprintf("图片工具状态:%s", status)
		}
	case "response.completed":
		return "接口已完成"
	}
	if evType != "" {
		return fmt.Sprintf("接口事件:%s", evType)
	}
	return ""
}

// NewSSEScanner returns a bufio.Scanner configured to handle long base64 lines.
// Default token size is 64KB which truncates partial_image_b64 at 2048x1152 sizes.
func NewSSEScanner(r io.Reader) *bufio.Scanner {
	scanner := bufio.NewScanner(r)
	const initial = 2 << 20      // 2 MB
	const max = maxSSEFrameBytes // bounded independently of any debug log limit
	scanner.Buffer(make([]byte, 0, initial), max)
	return scanner
}
