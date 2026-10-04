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

// IterEvents decodes SSE frames, including event names and multiline data.
// Malformed JSON and [DONE] markers are ignored. Explicit JSON types win.
func IterEvents(raw string) iter.Seq[Event] {
	return func(yield func(Event) bool) {
		eventName := ""
		var data []string
		flush := func() bool {
			payload := strings.TrimSpace(strings.Join(data, "\n"))
			data = nil
			var ev Event
			if payload == "" || payload == "[DONE]" || decodeEvent(payload, &ev) != nil || ev == nil {
				eventName = ""
				return true
			}
			if _, ok := ev["type"]; !ok && eventName != "" {
				ev["type"] = eventName
			}
			eventName = ""
			return yield(ev)
		}
		for line := range strings.SplitSeq(raw, "\n") {
			line = strings.TrimRight(line, "\r")
			if line == "" {
				if !flush() {
					return
				}
				continue
			}
			if strings.HasPrefix(line, "event:") {
				eventName = strings.TrimSpace(line[6:])
			}
			if strings.HasPrefix(line, "data:") {
				// Older relay dumps omit blank separators between complete JSON objects.
				var previous Event
				if len(data) > 0 && decodeEvent(strings.Join(data, "\n"), &previous) == nil && previous != nil {
					if !flush() {
						return
					}
				}
				data = append(data, strings.TrimPrefix(line[5:], " "))
			}
		}
		flush()
	}
}

// ExtractImageResult parses raw SSE text and returns the image base64.
// Priority:
//  1. response.output_item.done with item.type == image_generation_call and item.result
//  2. JSON walk of the entire body (non-SSE responses)
//
// Partial preview frames are intentionally not treated as success. If the
// stream only delivered partial_image previews but never produced the final
// image result, callers must report an uncertain outcome rather than persist it as
// if it were the completed image.
func ExtractImageResult(raw string) (ImageResult, error) {
	for ev := range IterEvents(raw) {
		evType, _ := ev["type"].(string)

		if evType == "response.image_generation_call.partial_image" {
			continue
		}

		if evType != "response.output_item.done" {
			continue
		}
		itemAny, _ := ev["item"]
		item, ok := itemAny.(map[string]any)
		if !ok {
			continue
		}
		if t, _ := item["type"].(string); t != "image_generation_call" {
			continue
		}
		if result, _ := item["result"].(string); result != "" {
			revised, _ := item["revised_prompt"].(string)
			return ImageResult{
				ImageB64:      result,
				RevisedPrompt: revised,
				SourceEvent:   "final",
			}, nil
		}
	}

	if r, ok := findImageResultInJSON(raw); ok {
		return r, nil
	}

	return ImageResult{}, ErrNoImageInResponse
}

func findImageResultInJSON(raw string) (ImageResult, bool) {
	var v any
	if err := json.Unmarshal([]byte(raw), &v); err != nil {
		return ImageResult{}, false
	}
	if found, ok := walkForImageCall(v); ok {
		result, _ := found["result"].(string)
		revised, _ := found["revised_prompt"].(string)
		if result == "" {
			return ImageResult{}, false
		}
		return ImageResult{
			ImageB64:      result,
			RevisedPrompt: revised,
			SourceEvent:   "json",
		}, true
	}
	return ImageResult{}, false
}

func walkForImageCall(v any) (map[string]any, bool) {
	switch x := v.(type) {
	case map[string]any:
		if t, _ := x["type"].(string); t == "image_generation_call" {
			if r, _ := x["result"].(string); r != "" {
				return x, true
			}
		}
		for _, child := range x {
			if found, ok := walkForImageCall(child); ok {
				return found, true
			}
		}
	case []any:
		for _, child := range x {
			if found, ok := walkForImageCall(child); ok {
				return found, true
			}
		}
	}
	return nil, false
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
	if !strings.HasPrefix(stripped, "data: ") {
		return ""
	}
	payload := strings.TrimSpace(stripped[6:])
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
	const initial = 2 << 20 // 2 MB
	const max = 1 << 30     // 1 GiB upper bound for future very large partial_image_b64 payload lines
	scanner.Buffer(make([]byte, 0, initial), max)
	return scanner
}
