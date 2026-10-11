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
