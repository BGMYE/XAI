package client

import (
	"context"
	"io"
	"strings"
	"testing"
)

type endpointCapture struct{ url string }

func (c *endpointCapture) Stream(_ context.Context, r Request, w io.Writer, _ chan<- string) error {
	c.url = r.URL
	_, err := io.WriteString(w, `{"output":[]}`)
	return err
}

func TestResponsesEndpointPreservesAPIRoot(t *testing.T) {
	for _, base := range []string{"https://example.com", "https://example.com/v1", "https://example.com/api/v3", "https://example.com/v1beta", "https://example.com/openai", "https://example.com/openai/v1"} {
		t.Run(base, func(t *testing.T) {
			c := &endpointCapture{}
			_, _ = RequestAndExtract(context.Background(), c, Options{BaseURL: base, APIKey: "test", Prompt: "test"}, io.Discard, nil)
			want := OpenAIAPIEndpoint(base, "responses")
			if c.url != want {
				t.Fatalf("HTTP = %s, want %s", c.url, want)
			}
			ws, err := responsesWebSocketURL(base, false)
			if err != nil || ws != strings.Replace(want, "https://", "wss://", 1) {
				t.Fatalf("websocket = %s: %v", ws, err)
			}
		})
	}
}
