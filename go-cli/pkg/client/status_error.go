package client

import "fmt"

// HTTPStatusError reports that the upstream answered with a non-2xx status.
// Error() returns the same text callers saw before this type existed;
// StatusCode lets callers tell a rejected request (4xx) from a gateway or
// server failure (5xx), which may still have been processed and billed.
type HTTPStatusError struct {
	StatusCode int
	Message    string
}

func (e *HTTPStatusError) Error() string { return e.Message }

func statusError(code int, format string, args ...any) error {
	return &HTTPStatusError{StatusCode: code, Message: fmt.Sprintf(format, args...)}
}
