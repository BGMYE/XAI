package client

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync/atomic"
)

// Large enough for multi-image payloads, but bounded independently of the raw
// log sink. In particular, trimming debug logs must never truncate a final image.
const maxSSEFrameBytes = 128 << 20

type responseCollector struct {
	rawSink       io.Writer
	receivedBytes atomic.Int64
	pending       bytes.Buffer
	jsonBody      bytes.Buffer
	frames        sseFrameDecoder
	extractor     streamImageExtractor
	sawSSE        bool
	parseErr      error
}

func newResponseCollector(rawSink io.Writer) *responseCollector {
	return newResponseCollectorWithPartial(rawSink, nil)
}

func newResponseCollectorWithPartial(rawSink io.Writer, onPartial func(PartialImage)) *responseCollector {
	c := &responseCollector{rawSink: rawSink, extractor: streamImageExtractor{onPartial: onPartial}}
	c.frames.onEvent = c.extractor.consumeEvent
	return c
}

func (c *responseCollector) setResponseHeaders(headers http.Header) {
	for _, name := range []string{"X-Request-Id", "Request-Id", "Openai-Request-Id"} {
		if id := strings.TrimSpace(headers.Get(name)); id != "" {
			c.extractor.collected.RequestID = id
			return
		}
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
		c.consumeLine(data[:idx])
		c.pending.Next(idx + 1)
	}
	if c.pending.Len() > maxSSEFrameBytes {
		c.parseErr = fmt.Errorf("upstream frame exceeds %d bytes", maxSSEFrameBytes)
		c.pending.Reset()
	}
	if c.parseErr != nil {
		return len(p), c.parseErr
	}
	return len(p), nil
}

func (c *responseCollector) finalize() {
	if c.pending.Len() != 0 {
		c.consumeLine(c.pending.Bytes())
		c.pending.Reset()
	}
	c.frames.flush()
	if !c.sawSSE && c.jsonBody.Len() > 0 {
		var ev Event
		if decodeEvent(c.jsonBody.String(), &ev) == nil && ev != nil {
			c.extractor.consumeDocument(ev)
		}
		c.jsonBody.Reset()
	}
}

func (c *responseCollector) bytesReceived() int64 { return c.receivedBytes.Load() }

func (c *responseCollector) result() (ImageResult, error) {
	c.finalize()
	res, err := c.extractor.resultWithError()
	if c.parseErr != nil {
		res.Status, res.Error = "incomplete", c.parseErr.Error()
		return res, c.parseErr
	}
	return res, err
}

func (c *responseCollector) consumeLine(raw []byte) {
	line := strings.TrimSuffix(string(raw), "\r")
	if strings.HasPrefix(line, "data:") || strings.HasPrefix(line, "event:") || strings.HasPrefix(line, ":") {
		c.sawSSE = true
	}
	if c.sawSSE {
		if err := c.frames.consumeLine(line); err != nil {
			c.parseErr = err
		}
		return
	}
	if c.jsonBody.Len()+len(line)+1 > maxSSEFrameBytes {
		c.parseErr = fmt.Errorf("upstream JSON response exceeds %d bytes", maxSSEFrameBytes)
		return
	}
	c.jsonBody.WriteString(line)
	c.jsonBody.WriteByte('\n')
}

// sseFrameDecoder follows SSE field and frame boundaries, accepting CRLF,
// comment heartbeats and multiline JSON. Complete one-line JSON data is emitted
// immediately as a compatibility concession to relays without blank separators.
type sseFrameDecoder struct {
	eventName string
	data      []string
	dataBytes int
	onEvent   func(Event)
}

func (d *sseFrameDecoder) consumeLine(line string) error {
	line = strings.TrimSuffix(line, "\r")
	if line == "" {
		d.flush()
		return nil
	}
	if strings.HasPrefix(line, ":") {
		return nil
	}
	field, value, _ := strings.Cut(line, ":")
	value = strings.TrimPrefix(value, " ")
	switch field {
	case "event":
		d.eventName = value
	case "data":
		d.dataBytes += len(value) + 1
		if d.dataBytes > maxSSEFrameBytes {
			return fmt.Errorf("SSE frame exceeds %d bytes", maxSSEFrameBytes)
		}
		d.data = append(d.data, value)
		payload := strings.TrimSpace(strings.Join(d.data, "\n"))
		if payload == "[DONE]" {
			d.flush()
			return nil
		}
		if json.Valid([]byte(payload)) {
			d.flush()
		}
	}
	return nil
}

func (d *sseFrameDecoder) flush() {
	payload := strings.TrimSpace(strings.Join(d.data, "\n"))
	name := d.eventName
	d.eventName, d.data, d.dataBytes = "", nil, 0
	if payload == "" || payload == "[DONE]" {
		return
	}
	var ev Event
	if decodeEvent(payload, &ev) != nil || ev == nil {
		return
	}
	if typ, _ := ev["type"].(string); typ == "" && name != "" {
		ev["type"] = name
	}
	if d.onEvent != nil {
		d.onEvent(ev)
	}
}

type streamImageExtractor struct {
	collected ImageResult
	onPartial func(PartialImage)
}

func (e *streamImageExtractor) consumeEvent(ev Event) {
	e.captureMetadata(ev)
	typ, _ := ev["type"].(string)
	switch typ {
	case "response.created", "response.in_progress":
		if response, ok := ev["response"].(map[string]any); ok {
			e.captureResponseMetadata(response)
		}
	case "response.image_generation_call.partial_image", "image_generation.partial_image", "image_edit.partial_image":
		b64, _ := ev["partial_image_b64"].(string)
		if b64 == "" {
			b64, _ = ev["b64_json"].(string)
		}
		if b64 != "" && e.onPartial != nil {
			partial := PartialImage{ImageB64: b64, PartialImageIndex: -1}
			partial.RevisedPrompt, _ = ev["revised_prompt"].(string)
			if idx, ok := numberFromAny(ev["partial_image_index"]); ok {
				partial.PartialImageIndex = idx
			}
			e.onPartial(partial)
		}
	case "response.output_item.done":
		if item, ok := ev["item"].(map[string]any); ok {
			e.addResponseItem(item, optionalIndex(ev["output_index"]), "final")
		}
	case "response.completed", "response.failed", "response.incomplete":
		if response, ok := ev["response"].(map[string]any); ok {
			e.captureResponseMetadata(response)
			e.collectOutput(response["output"], "final")
			if msg := upstreamEventError(response); msg != "" {
				e.collected.Error = msg
			}
		}
		e.setTerminalStatus(strings.TrimPrefix(typ, "response."))
		if msg := upstreamEventError(ev); msg != "" {
			e.collected.Error = msg
		}
	case "image_generation.completed", "image_edit.completed":
		e.addImageDatum(ev, optionalIndex(ev["output_index"]), "images_api")
		e.collectImageData(ev["data"])
		e.setTerminalStatus("completed")
	case "image_generation.failed", "image_edit.failed", "error":
		e.collected.Status = "failed"
		e.collected.Error = upstreamEventError(ev)
		if e.collected.Error == "" {
			e.collected.Error = "upstream image generation failed"
		}
	default:
		// Some Images gateways stream the standard JSON data[] envelope.
		if _, ok := ev["data"].([]any); ok {
			e.collectImageData(ev["data"])
			e.setTerminalStatus("completed")
		}
	}
}

func (e *streamImageExtractor) consumeDocument(ev Event) {
	if typ, _ := ev["type"].(string); strings.HasPrefix(typ, "response.") || strings.HasPrefix(typ, "image_generation.") || strings.HasPrefix(typ, "image_edit.") || typ == "error" {
		e.consumeEvent(ev)
		return
	}
	e.captureResponseMetadata(ev)
	e.collectOutput(ev["output"], "json")
	if response, ok := ev["response"].(map[string]any); ok {
		e.captureResponseMetadata(response)
		e.collectOutput(response["output"], "json")
	}
	e.collectImageData(ev["data"])
	if typ, _ := ev["type"].(string); typ == "image_generation_call" {
		e.addResponseItem(ev, nil, "json")
	}
	status, _ := ev["status"].(string)
	if status == "" {
		if response, ok := ev["response"].(map[string]any); ok {
			status, _ = response["status"].(string)
		}
	}
	switch status {
	case "failed", "incomplete", "completed":
		e.setTerminalStatus(status)
	case "":
		e.setTerminalStatus("completed")
	default:
		e.collected.Status = "uncertain"
	}
	if msg := upstreamEventError(ev); msg != "" {
		e.collected.Error, e.collected.Status = msg, "failed"
	}
}

func (e *streamImageExtractor) setTerminalStatus(status string) {
	if e.collected.Status != "failed" && e.collected.Status != "incomplete" {
		e.collected.Status = status
	}
}

func (e *streamImageExtractor) captureResponseMetadata(response map[string]any) {
	e.captureMetadata(response)
	if id, _ := response["id"].(string); id != "" {
		e.collected.ResponseID = id
	}
}

func (e *streamImageExtractor) captureMetadata(ev map[string]any) {
	if id, _ := ev["response_id"].(string); id != "" {
		e.collected.ResponseID = id
	}
	if id, _ := ev["id"].(string); id != "" {
		if object, _ := ev["object"].(string); object == "response" || strings.HasPrefix(id, "resp_") {
			e.collected.ResponseID = id
		}
	}
	if id, _ := ev["request_id"].(string); id != "" {
		e.collected.RequestID = id
	}
	if usage, ok := ev["usage"].(map[string]any); ok {
		e.collected.Usage = usage
	}
}

func (e *streamImageExtractor) collectOutput(value any, source string) {
	items, _ := value.([]any)
	for i, value := range items {
		if item, ok := value.(map[string]any); ok {
			idx := i
			e.addResponseItem(item, &idx, source)
		}
	}
}

func (e *streamImageExtractor) addResponseItem(item map[string]any, index *int, source string) {
	if item["type"] != "image_generation_call" {
		return
	}
	if status, _ := item["status"].(string); status != "" && status != "completed" {
		return
	}
	b64, _ := item["result"].(string)
	if b64 == "" {
		return
	}
	image := generatedImageMetadata(item, index)
	image.ImageB64 = b64
	e.addFinal(image, source)
}

func (e *streamImageExtractor) collectImageData(value any) {
	items, _ := value.([]any)
	for i, value := range items {
		if item, ok := value.(map[string]any); ok {
			idx := i
			e.addImageDatum(item, &idx, "images_api")
		}
	}
}

func generatedImageMetadata(item map[string]any, index *int) GeneratedImage {
	image := GeneratedImage{OutputIndex: index, Source: "final"}
	image.ItemID, _ = item["id"].(string)
	if image.ItemID == "" {
		image.ItemID, _ = item["item_id"].(string)
	}
	image.RevisedPrompt, _ = item["revised_prompt"].(string)
	image.Format, _ = item["output_format"].(string)
	if image.Format == "" {
		image.Format, _ = item["format"].(string)
	}
	image.Width, _ = numberFromAny(item["width"])
	image.Height, _ = numberFromAny(item["height"])
	if image.Width == 0 || image.Height == 0 {
		if size, _ := item["size"].(string); size != "" {
			_, _ = fmt.Sscanf(size, "%dx%d", &image.Width, &image.Height)
		}
	}
	return image
}

func (e *streamImageExtractor) addImageDatum(item map[string]any, index *int, source string) {
	image := generatedImageMetadata(item, index)
	image.ImageB64, _ = item["b64_json"].(string)
	image.URL, _ = item["url"].(string)
	if image.ImageB64 == "" && image.URL == "" {
		return
	}
	e.addFinal(image, source)
}

func (e *streamImageExtractor) addFinal(image GeneratedImage, source string) {
	digest := sha256.Sum256([]byte(image.ImageB64 + "\x00" + image.URL))
	for i, existing := range e.collected.Images {
		byID := image.ItemID != "" && image.ItemID == existing.ItemID
		byIndex := image.OutputIndex != nil && existing.OutputIndex != nil && *image.OutputIndex == *existing.OutputIndex
		byContent := digest == sha256.Sum256([]byte(existing.ImageB64+"\x00"+existing.URL))
		if !byID && !byIndex && !byContent {
			continue
		}
		if existing.ItemID == "" {
			existing.ItemID = image.ItemID
		}
		if existing.OutputIndex == nil {
			existing.OutputIndex = image.OutputIndex
		}
		if image.RevisedPrompt != "" {
			existing.RevisedPrompt = image.RevisedPrompt
		}
		if image.Format != "" {
			existing.Format = image.Format
		}
		if image.Width > 0 {
			existing.Width = image.Width
		}
		if image.Height > 0 {
			existing.Height = image.Height
		}
		e.collected.Images[i] = existing
		return
	}
	e.collected.Images = append(e.collected.Images, image)
	if e.collected.SourceEvent == "" {
		e.collected.SourceEvent = source
	}
}

func (e *streamImageExtractor) resultWithError() (ImageResult, error) {
	res := e.collected
	if res.Status == "" {
		res.Status = "uncertain"
	}
	res.syncLegacyImage()
	if res.Status == "failed" || res.Status == "incomplete" {
		if res.Error == "" {
			res.Error = "upstream response " + res.Status
		}
		return res, fmt.Errorf("%s", res.Error)
	}
	if len(res.Images) == 0 {
		if res.Status == "completed" {
			res.Status = "incomplete"
		}
		return res, ErrNoImageInResponse
	}
	return res, nil
}

func (r *ImageResult) syncLegacyImage() {
	if len(r.Images) == 0 {
		return
	}
	image := r.Images[0]
	r.ImageB64, r.URL, r.RevisedPrompt = image.ImageB64, image.URL, image.RevisedPrompt
}

func upstreamEventError(ev map[string]any) string {
	if message, _ := ev["error"].(string); message != "" {
		return message
	}
	if detail, ok := ev["error"].(map[string]any); ok {
		if message, _ := detail["message"].(string); message != "" {
			return message
		}
	}
	if detail, ok := ev["incomplete_details"].(map[string]any); ok {
		if reason, _ := detail["reason"].(string); reason != "" {
			return reason
		}
	}
	if message, _ := ev["message"].(string); message != "" {
		return message
	}
	return ""
}

func optionalIndex(value any) *int {
	if index, ok := numberFromAny(value); ok {
		return &index
	}
	return nil
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
