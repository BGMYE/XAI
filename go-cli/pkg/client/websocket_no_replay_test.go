package client

import (
	"context"
	"github.com/gorilla/websocket"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestWebSocketPostSendHandshakeTextNeverFallsBack(t *testing.T) {
	for _, closeReason := range []bool{false, true} {
		var posts atomic.Int32
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
				posts.Add(1)
				w.WriteHeader(500)
				return
			}
			u := websocket.Upgrader{}
			c, err := u.Upgrade(w, r, nil)
			if err != nil {
				return
			}
			defer c.Close()
			if _, _, err = c.ReadMessage(); err != nil {
				t.Error(err)
				return
			}
			if closeReason {
				_ = c.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseInternalServerErr, "websocket handshake failed on upstream"))
			} else {
				_ = c.WriteJSON(map[string]any{"type": "error", "error": map[string]string{"message": "websocket handshake failed on upstream"}})
			}
		}))
		_, err := RequestResponsesOnce(context.Background(), Options{BaseURL: srv.URL, APIKey: "key", Prompt: "test", ResponsesTransport: ResponsesTransportWebSocket}, io.Discard, nil, nil)
		srv.Close()
		if err == nil || posts.Load() != 0 {
			t.Fatalf("replayed after generation: %v posts=%d", err, posts.Load())
		}
	}
}
