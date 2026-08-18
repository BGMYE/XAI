package client

import "strings"

func normalizeResponsesTransport(value ResponsesTransport) ResponsesTransport {
	switch strings.ToLower(strings.TrimSpace(string(value))) {
	case string(ResponsesTransportWebSocket):
		return ResponsesTransportWebSocket
	default:
		return ResponsesTransportSSE
	}
}
