package client

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/gorilla/websocket"
)

// All request tests in this file use loopback httptest servers and dummy keys;
// no real account or externally routable image endpoint is contacted.
func TestImageResultsJSONReturnsEveryImageAndRequestMetadata(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Request-Id", "gateway-request-7")
		_, _ = io.WriteString(w, `{"response_id":"resp_json","usage":{"total_tokens":9},"data":[{"b64_json":"b25l","revised_prompt":"first","width":1024,"height":1024},{"b64_json":"dHdv","revised_prompt":"second"}]}`)
	}))
	defer srv.Close()
	res, err := RequestImagesAPI(context.Background(), Options{BaseURL: srv.URL, APIKey: "test-key", Prompt: "test"}, nil, nil)
	if err != nil || len(res.Images) != 2 || res.Status != "completed" || res.RequestID != "gateway-request-7" || res.ResponseID != "resp_json" || res.Usage["total_tokens"] != float64(9) {
		t.Fatalf("result %+v, error %v", res, err)
	}
}

func TestImageResultsSSEMultilineAndErrorState(t *testing.T) {
	for _, fail := range []bool{false, true} {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "text/event-stream")
			_, _ = io.WriteString(w, "event: image_edit.partial_image\r\ndata:{\"b64_json\":\"cHJldmlldw==\",\"partial_image_index\":0}\r\n\r\n")
			if fail {
				_, _ = io.WriteString(w, "event: error\r\ndata:{\"error\":{\"message\":\"upstream denied\"}}\r\n\r\n")
			} else {
				_, _ = io.WriteString(w, "event: image_edit.completed\r\ndata:{\"data\":[\r\ndata:{\"b64_json\":\"b25l\"},\r\ndata:{\"b64_json\":\"dHdv\"}],\"usage\":{\"total_tokens\":3}}\r\n\r\n")
			}
		}))
		partials := 0
		res, err := RequestImagesAPIWithPartial(context.Background(), Options{BaseURL: srv.URL, APIKey: "test-key", Prompt: "test"}, nil, nil, func(PartialImage) { partials++ })
		srv.Close()
		if partials != 1 {
			t.Fatalf("partial callbacks %d", partials)
		}
		if fail {
			if err == nil || err.Error() != "upstream denied" || res.Status != "failed" || len(res.Images) != 0 {
				t.Fatalf("result %+v, error %v", res, err)
			}
		} else if err != nil || len(res.Images) != 2 || res.Status != "completed" {
			t.Fatalf("result %+v, error %v", res, err)
		}
	}
}

func TestImageResultsResponsesRetainsRequestIDOnTerminalError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Request-Id", "request-failed")
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "event: response.failed\ndata:{\"response\":{\"id\":\"resp_error\",\"error\":{\"message\":\"denied\"}}}\n\n")
	}))
	defer srv.Close()
	res, err := RequestResponsesOnce(context.Background(), Options{BaseURL: srv.URL, APIKey: "test-key", Prompt: "test"}, nil, nil, nil)
	if err == nil || res.Status != "failed" || res.RequestID != "request-failed" || res.ResponseID != "resp_error" {
		t.Fatalf("result %+v, error %v", res, err)
	}
}

func TestImageResultsWebSocketWaitsForAllFinalsAndUsage(t *testing.T) {
	var creates atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u := websocket.Upgrader{}
		c, err := u.Upgrade(w, r, http.Header{"X-Request-Id": []string{"ws-request"}})
		if err != nil {
			return
		}
		defer c.Close()
		if _, _, err := c.ReadMessage(); err != nil {
			t.Error(err)
			return
		}
		creates.Add(1)
		for i, image := range []string{"b25l", "dHdv"} {
			err := c.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf(`{"type":"response.output_item.done","output_index":%d,"item":{"type":"image_generation_call","id":"img%d","result":"%s"}}`, i, i, image)))
			if err != nil {
				t.Error(err)
				return
			}
		}
		_ = c.WriteMessage(websocket.TextMessage, []byte("{\n\"type\":\"response.completed\",\n\"response\":{\"id\":\"resp_ws\",\"usage\":{\"total_tokens\":2}}}"))
	}))
	defer srv.Close()
	res, err := RequestResponsesOnce(context.Background(), Options{BaseURL: srv.URL, APIKey: "test-key", Prompt: "test", ResponsesTransport: ResponsesTransportWebSocket}, nil, nil, nil)
	if err != nil || len(res.Images) != 2 || res.Status != "completed" || res.ResponseID != "resp_ws" || res.Usage["total_tokens"] != float64(2) || res.RequestID != "ws-request" || creates.Load() != 1 {
		t.Fatalf("result %+v, error %v, submissions %d", res, err, creates.Load())
	}
}

func TestImageResultsWebSocketFinalDisconnectIsUncertainAndNotReplayed(t *testing.T) {
	var submits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u := websocket.Upgrader{}
		c, err := u.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer c.Close()
		if _, _, err := c.ReadMessage(); err != nil {
			return
		}
		submits.Add(1)
		_ = c.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.output_item.done","item":{"type":"image_generation_call","result":"b25l"}}`))
	}))
	defer srv.Close()
	res, err := RequestResponsesOnce(context.Background(), Options{BaseURL: srv.URL, APIKey: "test-key", Prompt: "test", ResponsesTransport: ResponsesTransportWebSocket}, nil, nil, nil)
	if err != nil || len(res.Images) != 1 || res.Status != "uncertain" || submits.Load() != 1 {
		t.Fatalf("result %+v, error %v, submissions %d", res, err, submits.Load())
	}
}

func TestImageResultsSizeRepairNeverReplaysAfterPreview(t *testing.T) {
	var submissions atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		submissions.Add(1)
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = io.WriteString(w, "data:{\"type\":\"image_generation.partial_image\",\"b64_json\":\"cHJldmlldw==\"}\n\n"+
			"data:{\"type\":\"error\",\"error\":{\"message\":\"Invalid size: 2048x2048\"}}\n\n")
	}))
	defer srv.Close()
	_, _, err := RequestAndExtractWithRetriesAndPartialInMemory(context.Background(), nil, Options{BaseURL: srv.URL, APIKey: "test-key", Prompt: "test", Size: "2048x2048", APIMode: APIModeImages}, nil, nil, nil)
	if err == nil || submissions.Load() != 1 {
		t.Fatalf("error %v; submissions %d", err, submissions.Load())
	}
}

func TestImageResultsJSONErrorPreservesTerminalStateAndUsage(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Request-Id", "json-error-request")
		_, _ = io.WriteString(w, `{"response_id":"response-error","usage":{"total_tokens":4},"error":{"message":"blocked"}}`)
	}))
	defer srv.Close()
	res, err := RequestImagesAPI(context.Background(), Options{BaseURL: srv.URL, APIKey: "test-key", Prompt: "test"}, nil, nil)
	if err == nil || res.Status != "failed" || res.ResponseID != "response-error" || res.RequestID != "json-error-request" || res.Usage["total_tokens"] != float64(4) {
		t.Fatalf("result %+v, error %v", res, err)
	}
}
