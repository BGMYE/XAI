package client

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/gorilla/websocket"
)

const echoedTestCredential = "synthetic-private-upstream-credential"

func TestCredentialWriterRedactsEveryChunkBoundaryWithoutDelayingOrdinaryEvents(t *testing.T) {
	input := "prefix " + echoedTestCredential + " middle " + echoedTestCredential + " suffix"
	for split := 0; split <= len(input); split++ {
		var output bytes.Buffer
		writer := newCredentialWriter(&output, echoedTestCredential)
		for _, chunk := range []string{input[:split], input[split:]} {
			if n, err := writer.Write([]byte(chunk)); err != nil || n != len(chunk) {
				t.Fatal("write failed")
			}
		}
		if err := writer.Flush(); err != nil {
			t.Fatal(err)
		}
		if output.String() != "prefix [redacted] middle [redacted] suffix" {
			t.Fatalf("split %d was not redacted", split)
		}
	}
	var output bytes.Buffer
	writer := newCredentialWriter(&output, echoedTestCredential)
	_, _ = writer.Write([]byte("data: {\"type\":\"response.created\"}\n"))
	if output.String() != "data: {\"type\":\"response.created\"}\n" {
		t.Fatal("ordinary SSE event was delayed")
	}
}

type credentialEchoTransport struct{ failure bool }

func (t credentialEchoTransport) Stream(_ context.Context, req Request, sink io.Writer, _ chan<- string) error {
	var data string
	if t.failure {
		data = `{"error":{"message":"invalid ` + req.APIKey + `"}}`
	} else {
		data = `data: {"type":"response.image_generation_call.partial_image","partial_image_b64":"cG5n","revised_prompt":"` + req.APIKey + `"}` + "\n" +
			`data: {"type":"response.output_item.done","item":{"type":"image_generation_call","result":"cG5n","revised_prompt":"` + req.APIKey + `"}}` + "\n"
	}
	// Exercise writes shorter than a credential, as network framing may split anywhere.
	for _, character := range []byte(data) {
		if _, err := sink.Write([]byte{character}); err != nil {
			return err
		}
	}
	return nil
}

func TestResponsesCredentialEchoNeverReachesRawFileErrorOrPreview(t *testing.T) {
	for _, failure := range []bool{false, true} {
		t.Run(fmt.Sprint(failure), func(t *testing.T) {
			retry := false
			var preview PartialImage
			var logs []string
			result, path, err := RequestAndExtractWithRetriesAndPartial(context.Background(), credentialEchoTransport{failure}, Options{
				APIKey: echoedTestCredential, Prompt: "safe prompt", BaseURL: "https://example.invalid", AutoRetryEnabled: &retry,
			}, t.TempDir(), "echo", func(message string) { logs = append(logs, message) }, nil, func(partial PartialImage) { preview = partial })
			data, readErr := os.ReadFile(path)
			if readErr != nil {
				t.Fatal(readErr)
			}
			if strings.Contains(string(data), echoedTestCredential) || strings.Contains(strings.Join(logs, " "), echoedTestCredential) || strings.Contains(preview.RevisedPrompt, echoedTestCredential) || strings.Contains(result.RevisedPrompt, echoedTestCredential) {
				t.Fatal("credential escaped response boundary")
			}
			if failure {
				if err == nil || strings.Contains(err.Error(), echoedTestCredential) {
					t.Fatal("upstream failure was not redacted")
				}
			} else if err != nil || result.ImageB64 != "cG5n" || preview.ImageB64 != "cG5n" {
				t.Fatal("redaction changed image payload")
			}
		})
	}
}

func TestImagesCredentialEchoNeverReachesRawFileOrTruncatedError(t *testing.T) {
	for _, format := range []string{"json", "html", "sse"} {
		t.Run(format, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Authorization") != "Bearer "+echoedTestCredential {
					t.Error("request authentication changed")
				}
				switch format {
				case "json":
					w.Header().Set("Content-Type", "application/json")
					fmt.Fprintf(w, `{"data":[{"b64_json":"cG5n","revised_prompt":"%s"}]}`, echoedTestCredential)
				case "html":
					w.WriteHeader(http.StatusUnauthorized)
					_, _ = io.WriteString(w, strings.Repeat("x", 395)+echoedTestCredential)
				case "sse":
					w.Header().Set("Content-Type", "text/event-stream")
					fmt.Fprintf(w, "data: {\"type\":\"image_generation.completed\",\"b64_json\":\"cG5n\",\"revised_prompt\":\"%s\"}\n", echoedTestCredential)
				}
			}))
			defer server.Close()
			retry := false
			result, path, err := RequestAndExtractWithRetries(context.Background(), nil, Options{APIKey: echoedTestCredential, Prompt: "safe prompt", BaseURL: server.URL, APIMode: APIModeImages, AutoRetryEnabled: &retry}, t.TempDir(), "echo", nil, nil)
			data, readErr := os.ReadFile(path)
			if readErr != nil {
				t.Fatal(readErr)
			}
			if strings.Contains(string(data), echoedTestCredential) || strings.Contains(result.RevisedPrompt, echoedTestCredential) {
				t.Fatal("image response leaked credential")
			}
			if format == "html" {
				if err == nil || strings.Contains(err.Error(), "synthetic") {
					t.Fatal("truncated error exposed a credential prefix")
				}
			} else if err != nil || result.ImageB64 != "cG5n" {
				t.Fatal("image result did not survive redaction")
			}
		})
	}
}

func TestWebSocketCredentialEchoIsRedactedBeforePersistence(t *testing.T) {
	upgrade := websocket.Upgrader{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrade.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		if _, _, err = conn.ReadMessage(); err != nil {
			return
		}
		_ = conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.output_item.done","item":{"type":"image_generation_call","result":"cG5n","revised_prompt":"`+echoedTestCredential+`"}}`))
	}))
	defer server.Close()
	retry := false
	result, path, err := RequestAndExtractWithRetries(context.Background(), nil, Options{APIKey: echoedTestCredential, Prompt: "safe prompt", BaseURL: server.URL, ResponsesTransport: ResponsesTransportWebSocket, AutoRetryEnabled: &retry}, t.TempDir(), "echo", nil, nil)
	if err != nil || result.ImageB64 != "cG5n" {
		t.Fatal("websocket result failed")
	}
	data, err := os.ReadFile(path)
	if err != nil || strings.Contains(string(data), echoedTestCredential) || strings.Contains(result.RevisedPrompt, echoedTestCredential) {
		t.Fatal("websocket response leaked credential")
	}
}

func TestCredentialRedactionPreservesErrorIdentity(t *testing.T) {
	cause := errors.New("transport echoed " + echoedTestCredential)
	err := redactCredentialError(cause, echoedTestCredential)
	if !errors.Is(err, cause) || strings.Contains(err.Error(), echoedTestCredential) {
		t.Fatal("error identity or redaction failed")
	}
}

func TestWebSocketHandshakeRedactsCredentialBeforeTruncating(t *testing.T) {
	response := &http.Response{StatusCode: http.StatusForbidden, Body: io.NopCloser(strings.NewReader(`{"error":{"message":"` + strings.Repeat("x", 155) + echoedTestCredential + `"}}`))}
	err := describeWebSocketDialError(errors.New("bad handshake"), response, echoedTestCredential)
	if err == nil || strings.Contains(err.Error(), "synth") {
		t.Fatal("handshake error exposed a credential prefix")
	}
}
