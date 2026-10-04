package client

import (
	"context"
	"io"
	"net/http"
)

type websocketHTTPClientKey struct{}

// RequestResponsesOnce submits one generation. An unsupported WebSocket
// handshake may fall back to SSE before any generation message was sent.
func RequestResponsesOnce(ctx context.Context, opts Options, raw io.Writer, progress func(string, int, int64), partial func(PartialImage)) (ImageResult, error) {
	if normalizeResponsesTransport(opts.ResponsesTransport) == ResponsesTransportWebSocket {
		if opts.HTTPClient != nil {
			ctx = context.WithValue(ctx, websocketHTTPClientKey{}, opts.HTTPClient)
		}
		return requestResponsesWithWebSocketReplay(ctx, opts, raw, progress, partial, 1, nil)
	}
	return RequestAndExtractWithPartial(ctx, &NativeTransport{Client: opts.HTTPClient, Proxy: opts.Proxy, AllowInsecureConnection: opts.AllowInsecureConnection}, opts, raw, progress, partial)
}

func websocketHTTPClient(ctx context.Context) *http.Client {
	c, _ := ctx.Value(websocketHTTPClientKey{}).(*http.Client)
	return c
}
