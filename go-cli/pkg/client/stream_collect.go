package client

import (
	"bytes"
	"encoding/json"
	"io"
	"strings"
	"sync/atomic"
)

const fallbackResponseCap = 1 << 20 // 1 MB

type responseCollector struct {
	rawSink io.Writer

	receivedBytes atomic.Int64
	pending       bytes.Buffer
	fallback      bytes.Buffer
	extractor     streamImageExtractor
}

func newResponseCollector(rawSink io.Writer) *responseCollector {
	return &responseCollector{rawSink: rawSink}
}

func newResponseCollectorWithPartial(rawSink io.Writer, onPartial func(PartialImage)) *responseCollector {
	return &responseCollector{
		rawSink:   rawSink,
		extractor: streamImageExtractor{onPartial: onPartial},
	}
}

func (c *responseCollector) Write(p []byte) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}
	if c.rawSink != nil {
		if _, err := c.rawSink.Write(p); err != nil {
			return 0, err
		}
	}
	c.receivedBytes.Add(int64(len(p)))
	_, _ = c.pending.Write(p)
	for {
		data := c.pending.Bytes()
		idx := bytes.IndexByte(data, '\n')
		if idx < 0 {
			break
		}
		line := append([]byte(nil), data[:idx]...)
		c.pending.Next(idx + 1)
		c.consumeLine(line)
	}
	return len(p), nil
}

func (c *responseCollector) finalize() {
	if c.pending.Len() == 0 {
		return
	}
	line := append([]byte(nil), c.pending.Bytes()...)
	c.pending.Reset()
	c.consumeLine(line)
}

func (c *responseCollector) bytesReceived() int64 {
	return c.receivedBytes.Load()
}

func (c *responseCollector) result() (ImageResult, error) {
	c.finalize()
	if res, ok := c.extractor.result(); ok {
		return res, nil
	}
	if c.fallback.Len() > 0 {
		return ExtractImageResult(c.fallback.String())
	}
	return ImageResult{}, ErrNoImageInResponse
}

func (c *responseCollector) consumeLine(line []byte) {
	trimmed := bytes.TrimRight(line, "\r")
	if len(trimmed) == 0 {
		return
	}
	if c.extractor.consume(trimmed) {
		return
	}
	if c.fallback.Len() >= fallbackResponseCap {
		return
	}
	remain := fallbackResponseCap - c.fallback.Len()
	if remain <= 0 {
		return
	}
	if len(trimmed) > remain {
		trimmed = trimmed[:remain]
	}
	_, _ = c.fallback.Write(trimmed)
	if c.fallback.Len() < fallbackResponseCap {
		_, _ = c.fallback.WriteString("\n")
	}
}

type streamImageExtractor struct {
	partialB64    string
	partialPrompt string
	final         ImageResult
	hasFinal      bool
	onPartial     func(PartialImage)
}

func (e *streamImageExtractor) consume(line []byte) bool {
	stripped := strings.TrimSpace(string(line))
	if stripped == "" {
		return false
	}
	if strings.HasPrefix(stripped, "data: ") {
		payload := strings.TrimSpace(stripped[6:])
		if payload == "" || payload == "[DONE]" {
			return true
		}
		return e.consumeJSONPayload(payload)
	}
	if strings.HasPrefix(stripped, "{") {
		if res, ok := findImageResultInJSON(stripped); ok {
			e.final = res
			e.hasFinal = true
			return true
		}
	}
	return false
}

func (e *streamImageExtractor) consumeJSONPayload(payload string) bool {
	var ev Event
	if err := decodeEvent(payload, &ev); err != nil {
		return false
	}
	evType, _ := ev["type"].(string)
	switch evType {
	case "response.image_generation_call.partial_image":
		if v, ok := ev["partial_image_b64"].(string); ok && v != "" {
			e.partialB64 = v
			partial := PartialImage{
				ImageB64:          v,
				RevisedPrompt:     e.partialPrompt,
				PartialImageIndex: -1,
			}
			if prompt, ok := ev["revised_prompt"].(string); ok && prompt != "" {
				partial.RevisedPrompt = prompt
			}
			if idx, ok := numberFromAny(ev["partial_image_index"]); ok {
				partial.PartialImageIndex = idx
			}
			if e.onPartial != nil {
				e.onPartial(partial)
			}
		}
		if v, ok := ev["revised_prompt"].(string); ok && v != "" {
			e.partialPrompt = v
		}
		return true
	case "response.output_item.done":
		itemAny, _ := ev["item"]
		item, ok := itemAny.(map[string]any)
		if !ok {
			return true
		}
		if t, _ := item["type"].(string); t != "image_generation_call" {
			return true
		}
		if result, _ := item["result"].(string); result != "" {
			revised, _ := item["revised_prompt"].(string)
			e.final = ImageResult{
				ImageB64:      result,
				RevisedPrompt: revised,
				SourceEvent:   "final",
			}
			e.hasFinal = true
			return true
		}
		if e.partialB64 != "" {
			e.final = ImageResult{
				ImageB64:      e.partialB64,
				RevisedPrompt: e.partialPrompt,
				SourceEvent:   "partial",
			}
			e.hasFinal = true
		}
		return true
	default:
		return true
	}
}

func (e *streamImageExtractor) result() (ImageResult, bool) {
	if e.hasFinal {
		return e.final, true
	}
	return ImageResult{}, false
}

func numberFromAny(value any) (int, bool) {
	switch v := value.(type) {
	case int:
		return v, true
	case int64:
		return int(v), true
	case float64:
		return int(v), true
	case json.Number:
		i, err := v.Int64()
		if err == nil {
			return int(i), true
		}
	}
	return 0, false
}
