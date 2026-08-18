package client

import (
	"bufio"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func sseLine(t *testing.T, ev map[string]any) string {
	t.Helper()
	b, err := json.Marshal(ev)
	if err != nil {
		t.Fatal(err)
	}
	return "data: " + string(b)
}

func TestExtractFinalImageResult(t *testing.T) {
	pngB64 := base64.StdEncoding.EncodeToString([]byte("\x89PNG\r\n\x1a\nfake"))
	raw := strings.Join([]string{
		sseLine(t, map[string]any{"type": "response.created", "sequence_number": 0}),
		sseLine(t, map[string]any{
			"type":              "response.image_generation_call.partial_image",
			"partial_image_b64": "ignored",
		}),
		sseLine(t, map[string]any{
			"type": "response.output_item.done",
			"item": map[string]any{
				"type":           "image_generation_call",
				"status":         "completed",
				"result":         pngB64,
				"revised_prompt": "poster prompt",
			},
		}),
	}, "\n")
	res, err := ExtractImageResult(raw)
	if err != nil {
		t.Fatal(err)
	}
	if res.ImageB64 != pngB64 {
		t.Errorf("image b64 mismatch")
	}
	if res.RevisedPrompt != "poster prompt" {
		t.Errorf("revised_prompt = %q", res.RevisedPrompt)
	}
	if res.SourceEvent != "final" {
		t.Errorf("source_event = %q, want final", res.SourceEvent)
	}
}

func TestExtractPartialOnlyReturnsSentinelError(t *testing.T) {
	pngB64 := base64.StdEncoding.EncodeToString([]byte("\x89PNG\r\n\x1a\nfake"))
	raw := strings.Join([]string{
		sseLine(t, map[string]any{"type": "response.created", "sequence_number": 0}),
		sseLine(t, map[string]any{
			"type":              "response.image_generation_call.partial_image",
			"partial_image_b64": pngB64,
		}),
		sseLine(t, map[string]any{"type": "response.completed", "response": map[string]any{"status": "completed"}}),
	}, "\n")
	_, err := ExtractImageResult(raw)
	if !errors.Is(err, ErrNoImageInResponse) {
		t.Fatalf("err = %v, want ErrNoImageInResponse", err)
	}
}

func TestExtractNoImageReturnsSentinelError(t *testing.T) {
	raw := `data: {"type":"response.completed","response":{"status":"completed"}}`
	_, err := ExtractImageResult(raw)
	if !errors.Is(err, ErrNoImageInResponse) {
		t.Errorf("err = %v, want ErrNoImageInResponse", err)
	}
}

func TestExtractFromPlainJSONBody(t *testing.T) {
	pngB64 := base64.StdEncoding.EncodeToString([]byte("\x89PNG\r\n\x1a\nfake"))
	raw, _ := json.Marshal(map[string]any{
		"output": []map[string]any{
			{
				"type":           "image_generation_call",
				"result":         pngB64,
				"revised_prompt": "p",
			},
		},
	})
	res, err := ExtractImageResult(string(raw))
	if err != nil {
		t.Fatal(err)
	}
	if res.ImageB64 != pngB64 {
		t.Errorf("image b64 mismatch")
	}
	if res.SourceEvent != "json" {
		t.Errorf("source_event = %q, want json", res.SourceEvent)
	}
}

func TestSummarizeSSELine(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{`: keep-alive`, "收到接口保活信号"},
		{`data: {"type":"response.created"}`, "请求已创建"},
		{`data: {"type":"response.in_progress"}`, "模型处理中"},
		{`data: {"type":"response.image_generation_call.in_progress"}`, "图片工具已启动"},
		{`data: {"type":"response.image_generation_call.generating"}`, "图片正在生成"},
		{`data: {"type":"response.image_generation_call.partial_image","partial_image_b64":"x"}`, "已收到图片数据片段"},
		{`data: {"type":"response.completed"}`, "接口已完成"},
		{`data: {"type":"response.output_item.done","item":{"type":"image_generation_call","result":"x"}}`, "图片生成完成,正在保存"},
		{`data: {"type":"response.output_item.done","item":{"type":"image_generation_call","status":"completed"}}`, "图片工具状态:completed"},
	}
	for _, c := range cases {
		if got := SummarizeSSELine(c.in); got != c.want {
			t.Errorf("SummarizeSSELine(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestNewSSEScannerHandlesLargePartialImageLine(t *testing.T) {
	largeB64 := strings.Repeat("A", 12<<20)
	line := `data: {"type":"response.image_generation_call.partial_image","partial_image_b64":"` + largeB64 + `"}` + "\n"
	scanner := NewSSEScanner(strings.NewReader(line))
	if !scanner.Scan() {
		t.Fatalf("scanner failed to read large line: %v", scanner.Err())
	}
	if got := scanner.Text(); len(got) != len(strings.TrimSuffix(line, "\n")) {
		t.Fatalf("scanner truncated line: got %d want %d", len(got), len(strings.TrimSuffix(line, "\n")))
	}
	if scanner.Err() != nil && scanner.Err() != bufio.ErrTooLong {
		t.Fatalf("unexpected scanner err: %v", scanner.Err())
	}
}
