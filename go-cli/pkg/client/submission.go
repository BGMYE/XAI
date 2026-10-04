package client

import (
	"errors"
	"net/http"
	"net/http/httptrace"
	"sync/atomic"
)

// NotSentError is evidence that a generation never acquired a connection.
// Unknown transports must not manufacture this classification from error text.
type NotSentError struct{ Err error }

func (e *NotSentError) Error() string { return "请求未发出：" + e.Err.Error() }
func (e *NotSentError) Unwrap() error { return e.Err }

func SafeToRetry(err error) bool {
	var unsent *NotSentError
	return errors.As(err, &unsent)
}

type UncertainSubmissionError struct{ Err error }

func (e *UncertainSubmissionError) Error() string {
	return "结果未知，请先核对上游；未自动重发：" + e.Err.Error()
}
func (e *UncertainSubmissionError) Unwrap() error { return e.Err }

func submissionError(err error) error {
	if err == nil || SafeToRetry(err) {
		return err
	}
	var status *HTTPStatusError
	if errors.As(err, &status) && status.StatusCode >= 400 && status.StatusCode < 500 {
		return err
	}
	var uncertain *UncertainSubmissionError
	if errors.As(err, &uncertain) {
		return err
	}
	return &UncertainSubmissionError{Err: err}
}

func doGeneration(c *http.Client, req *http.Request) (*http.Response, error) {
	var connected atomic.Bool
	ctx := httptrace.WithClientTrace(req.Context(), &httptrace.ClientTrace{GotConn: func(httptrace.GotConnInfo) { connected.Store(true) }})
	response, err := c.Do(req.WithContext(ctx))
	_, native := c.Transport.(*http.Transport)
	if err != nil && !connected.Load() && (c.Transport == nil || native) {
		return response, &NotSentError{Err: err}
	}
	return response, err
}
