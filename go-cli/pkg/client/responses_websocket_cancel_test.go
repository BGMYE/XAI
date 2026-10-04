package client

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// silentResponsesWebSocket accepts one response.create and then waits for the
// client to close. Every test uses loopback and a literal dummy credential.
func silentResponsesWebSocket(t *testing.T, firstMessage string) (string, <-chan struct{}, <-chan struct{}, *atomic.Int32, *atomic.Int32) {
	t.Helper()
	accepted, disconnected := make(chan struct{}), make(chan struct{})
	var acceptedOnce, disconnectedOnce sync.Once
	var requests, submissions atomic.Int32
	var sockets sync.Map
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		u := websocket.Upgrader{}
		conn, err := u.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		sockets.Store(conn, struct{}{})
		defer sockets.Delete(conn)
		defer conn.Close()
		defer disconnectedOnce.Do(func() { close(disconnected) })
		if _, _, err := conn.ReadMessage(); err != nil {
			return
		}
		submissions.Add(1)
		if firstMessage != "" {
			if err := conn.WriteMessage(websocket.TextMessage, []byte(firstMessage)); err != nil {
				return
			}
		}
		acceptedOnce.Do(func() { close(accepted) })
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
			submissions.Add(1)
		}
	}))
	t.Cleanup(func() {
		// Also clean up a failing regression without hanging httptest.Close.
		sockets.Range(func(key, _ any) bool { _ = key.(*websocket.Conn).Close(); return true })
		srv.Close()
	})
	return srv.URL, accepted, disconnected, &requests, &submissions
}

func TestResponsesWebSocketSilentCancellationAndDeadline(t *testing.T) {
	for _, probe := range []bool{false, true} {
		for _, deadline := range []bool{false, true} {
			name := "generation"
			if probe {
				name = "probe"
			}
			if deadline {
				name += "/deadline"
			} else {
				name += "/cancel"
			}
			t.Run(name, func(t *testing.T) {
				url, accepted, disconnected, requests, submissions := silentResponsesWebSocket(t, "")
				var ctx context.Context
				var cancel context.CancelFunc
				if deadline {
					ctx, cancel = context.WithTimeout(context.Background(), 200*time.Millisecond)
				} else {
					ctx, cancel = context.WithCancel(context.Background())
				}
				defer cancel()
				finished := make(chan error, 1)
				go func() {
					if probe {
						finished <- ProbeResponsesWebSocket(ctx, ProbeResponsesWebSocketOptions{BaseURL: url, APIKey: "test-key", Model: "test-model", Proxy: ProxyConfig{Mode: ProxyModeNone}})
						return
					}
					_, err := RequestResponsesOnce(ctx, Options{BaseURL: url, APIKey: "test-key", Prompt: "test", ResponsesTransport: ResponsesTransportWebSocket, Proxy: ProxyConfig{Mode: ProxyModeNone}}, io.Discard, nil, nil)
					finished <- err
				}()
				select {
				case <-accepted:
				case err := <-finished:
					t.Fatalf("request finished before accepted: %v", err)
				case <-time.After(2 * time.Second):
					t.Fatal("loopback server did not receive request")
				}
				if !deadline {
					cancel()
				}
				want := context.Canceled
				if deadline {
					want = context.DeadlineExceeded
				}
				select {
				case err := <-finished:
					if !errors.Is(err, want) {
						t.Fatalf("error %v, want %v", err, want)
					}
				case <-time.After(500 * time.Millisecond):
					t.Fatal("context did not interrupt silent ReadMessage promptly")
				}
				select {
				case <-disconnected:
				case <-time.After(500 * time.Millisecond):
					t.Fatal("client returned without closing the socket")
				}
				if requests.Load() != 1 || submissions.Load() != 1 {
					t.Fatalf("request was replayed: HTTP requests %d, response.create messages %d", requests.Load(), submissions.Load())
				}
			})
		}
	}
}

func TestResponsesWebSocketCancellationPreservesReceivedFinal(t *testing.T) {
	url, _, disconnected, requests, submissions := silentResponsesWebSocket(t, `{"type":"response.output_item.done","item":{"type":"image_generation_call","result":"b25l"}}`)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	finalReceived := make(chan struct{})
	var once sync.Once
	type outcome struct {
		result ImageResult
		err    error
	}
	finished := make(chan outcome, 1)
	go func() {
		res, err := RequestResponsesOnce(ctx, Options{BaseURL: url, APIKey: "test-key", Prompt: "test", ResponsesTransport: ResponsesTransportWebSocket, Proxy: ProxyConfig{Mode: ProxyModeNone}}, io.Discard,
			func(stage string, _ int, _ int64) {
				if stage == "接口事件:response.output_item.done" {
					once.Do(func() { close(finalReceived) })
				}
			}, nil)
		finished <- outcome{res, err}
	}()
	select {
	case <-finalReceived:
	case <-time.After(2 * time.Second):
		t.Fatal("did not receive first final image")
	}
	cancel()
	select {
	case got := <-finished:
		if !errors.Is(got.err, context.Canceled) || got.result.Status != "uncertain" || len(got.result.Images) != 1 {
			t.Fatalf("cancellation lost final or context state: result %+v, error %v", got.result, got.err)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("cancellation blocked after final image")
	}
	select {
	case <-disconnected:
	case <-time.After(500 * time.Millisecond):
		t.Fatal("socket was not closed")
	}
	if requests.Load() != 1 || submissions.Load() != 1 {
		t.Fatal("generation was replayed")
	}
}

func TestResponsesWebSocketReadDeadlineRespectsParent(t *testing.T) {
	parentDeadline := time.Now().Add(100 * time.Millisecond)
	ctx, cancel := context.WithDeadline(context.Background(), parentDeadline)
	defer cancel()
	if got := responsesWebSocketReadDeadline(ctx, responsesWebSocketProbeTimeout); !got.Equal(parentDeadline) {
		t.Fatalf("deadline %v, want shorter parent %v", got, parentDeadline)
	}
	before := time.Now()
	got := responsesWebSocketReadDeadline(context.Background(), responsesWebSocketProbeTimeout)
	if got.Before(before.Add(responsesWebSocketProbeTimeout)) || got.After(time.Now().Add(responsesWebSocketProbeTimeout)) {
		t.Fatalf("background probe has no bounded read deadline: %v", got)
	}
}
