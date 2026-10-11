package client

import (
	"encoding/base64"
	"errors"
	"testing"
)

func TestResponseCollectorExtractsFinalAndPartial(t *testing.T) {
	t.Parallel()

	pngB64 := base64.StdEncoding.EncodeToString([]byte("\x89PNG\r\n\x1a\nfake"))

	t.Run("final", func(t *testing.T) {
		c := newResponseCollector(nil)
		_, err := c.Write([]byte("data: {\"type\":\"response.created\"}\n"))
		if err != nil {
			t.Fatal(err)
		}
		_, err = c.Write([]byte("data: {\"type\":\"response.output_item.done\",\"item\":{\"type\":\"image_generation_call\",\"result\":\"" + pngB64 + "\"}}\n"))
		if err != nil {
			t.Fatal(err)
		}
		got, err := c.result()
		if err != nil {
			t.Fatalf("collector result: %v", err)
		}
		if got.ImageB64 != pngB64 || got.SourceEvent != "final" {
			t.Fatalf("unexpected final result: %+v", got)
		}
	})

	t.Run("partial only is not a success result", func(t *testing.T) {
		c := newResponseCollector(nil)
		_, err := c.Write([]byte("data: {\"type\":\"response.image_generation_call.partial_image\",\"partial_image_b64\":\"" + pngB64 + "\"}\n"))
		if err != nil {
			t.Fatal(err)
		}
		_, err = c.result()
		if !errors.Is(err, ErrNoImageInResponse) {
			t.Fatalf("collector result err = %v, want ErrNoImageInResponse", err)
		}
	})

	t.Run("partial callback", func(t *testing.T) {
		var seen []PartialImage
		c := newResponseCollectorWithPartial(nil, func(partial PartialImage) {
			seen = append(seen, partial)
		})
		_, err := c.Write([]byte("data: {\"type\":\"response.image_generation_call.partial_image\",\"partial_image_index\":2,\"partial_image_b64\":\"" + pngB64 + "\",\"revised_prompt\":\"rev\"}\n"))
		if err != nil {
			t.Fatal(err)
		}
		if len(seen) != 1 {
			t.Fatalf("partial callbacks = %d, want 1", len(seen))
		}
		if seen[0].ImageB64 != pngB64 {
			t.Fatalf("partial ImageB64 = %q, want %q", seen[0].ImageB64, pngB64)
		}
		if seen[0].RevisedPrompt != "rev" {
			t.Fatalf("partial RevisedPrompt = %q, want rev", seen[0].RevisedPrompt)
		}
		if seen[0].PartialImageIndex != 2 {
			t.Fatalf("partial PartialImageIndex = %d, want 2", seen[0].PartialImageIndex)
		}
	})
}

// Frame boundaries and network chunk boundaries are independent. The completed
// event is deliberately the only place carrying these two final images.
func TestCollectorCompletedOnlyMultilineAcrossArbitraryChunks(t *testing.T) {
	raw := ": heartbeat\r\nevent: response.created\r\ndata:{\"response\":{\"id\":\"response-multi\"}}\r\n\r\n" +
		"event: response.completed\r\ndata:{\"response\":{\"id\":\"response-multi\",\r\ndata:\"usage\":{\"total_tokens\":42},\"output\":[\r\n" +
		"data:{\"type\":\"image_generation_call\",\"id\":\"one\",\"result\":\"aW1hZ2Ux\",\"revised_prompt\":\"revised\",\"size\":\"1024x1536\",\"output_format\":\"png\"},\r\n" +
		"data:{\"type\":\"image_generation_call\",\"id\":\"two\",\"result\":\"aW1hZ2Uy\"}]}}\r\n\r\n"
	for _, chunkSize := range []int{1, 2, 7, 31, len(raw)} {
		c := newResponseCollector(nil)
		for start := 0; start < len(raw); start += chunkSize {
			end := start + chunkSize
			if end > len(raw) {
				end = len(raw)
			}
			if _, err := c.Write([]byte(raw[start:end])); err != nil {
				t.Fatal(err)
			}
		}
		res, err := c.result()
		if err != nil || res.Status != "completed" || res.ResponseID != "response-multi" || len(res.Images) != 2 {
			t.Fatalf("chunk %d: result %+v, error %v", chunkSize, res, err)
		}
		if res.ImageB64 != "aW1hZ2Ux" || res.RevisedPrompt != "revised" || res.Images[0].Width != 1024 || res.Images[0].Height != 1536 || res.Images[0].Format != "png" || res.Usage["total_tokens"] != float64(42) {
			t.Fatalf("metadata lost: %+v", res)
		}
	}
}

func TestCollectorDeduplicatesFinalEventsAndPreservesLatestMetadata(t *testing.T) {
	raw := "data:{\"type\":\"response.output_item.done\",\"output_index\":0,\"item\":{\"type\":\"image_generation_call\",\"id\":\"one\",\"result\":\"aW1hZ2Ux\"}}\n\n" +
		"data:{\"type\":\"response.completed\",\"response\":{\"output\":[{\"type\":\"image_generation_call\",\"id\":\"one\",\"result\":\"aW1hZ2Ux\",\"revised_prompt\":\"latest\"},{\"type\":\"image_generation_call\",\"id\":\"two\",\"result\":\"aW1hZ2Uy\"}]}}\n\n"
	res, err := ExtractImageResult(raw)
	if err != nil || len(res.Images) != 2 || res.RevisedPrompt != "latest" {
		t.Fatalf("result %+v, err %v", res, err)
	}
}

func TestCollectorPartialThenEmptyDoneNeverBecomesFinal(t *testing.T) {
	raw := "data:{\"type\":\"response.image_generation_call.partial_image\",\"partial_image_b64\":\"cHJldmlldw==\"}\n\n" +
		"data:{\"type\":\"response.output_item.done\",\"item\":{\"type\":\"image_generation_call\",\"status\":\"completed\"}}\n\n"
	res, err := ExtractImageResult(raw)
	if !errors.Is(err, ErrNoImageInResponse) || len(res.Images) != 0 || res.ImageB64 != "" || res.Status != "uncertain" {
		t.Fatalf("preview promoted to final: %+v, err %v", res, err)
	}
}

func TestCollectorPreservesFinalWithoutClaimingTerminalSuccess(t *testing.T) {
	res, err := ExtractImageResult("data:{\"type\":\"response.output_item.done\",\"item\":{\"type\":\"image_generation_call\",\"result\":\"aW1hZ2U=\"}}\n\n")
	if err != nil || len(res.Images) != 1 || res.Status != "uncertain" {
		t.Fatalf("result %+v, err %v", res, err)
	}
}

func TestCollectorTerminalFailuresPreserveImagesAndMetadata(t *testing.T) {
	for _, status := range []string{"failed", "incomplete"} {
		raw := "data:{\"type\":\"response." + status + "\",\"response\":{\"id\":\"resp_failed\",\"error\":{\"message\":\"quota reached\"},\"usage\":{\"total_tokens\":1},\"output\":[{\"type\":\"image_generation_call\",\"result\":\"aW1hZ2U=\"}]}}\n\n"
		res, err := ExtractImageResult(raw)
		if err == nil || err.Error() != "quota reached" || res.Status != status || res.ResponseID != "resp_failed" || len(res.Images) != 1 {
			t.Fatalf("terminal %s: result %+v, err %v", status, res, err)
		}
	}
}
