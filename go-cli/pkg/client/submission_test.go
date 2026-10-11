package client

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
)

type opaqueTransport struct{ calls int }

func (t *opaqueTransport) RoundTrip(*http.Request) (*http.Response, error) {
	t.calls++
	return nil, errors.New("outcome unknown")
}

func TestUnknownTransportCannotClaimRequestWasNotSent(t *testing.T) {
	tr := &opaqueTransport{}
	req, _ := http.NewRequest(http.MethodPost, "https://example.com", nil)
	_, err := doGeneration(&http.Client{Transport: tr}, req)
	if err == nil || SafeToRetry(err) || tr.calls != 1 {
		t.Fatalf("unsafe classification: %v", err)
	}
}

func TestAmbiguousSubmissionNeverReplays(t *testing.T) {
	original := RetryBackoffSeconds
	RetryBackoffSeconds = 0
	t.Cleanup(func() { RetryBackoffSeconds = original })
	for _, mode := range []APIMode{APIModeImages, APIModeResponses} {
		for _, disk := range []bool{false, true} {
			t.Run(fmt.Sprint(mode, disk), func(t *testing.T) {
				hits := 0
				srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					hits++
					w.WriteHeader(524)
					fmt.Fprint(w, "upstream timeout")
				}))
				defer srv.Close()
				opts := Options{BaseURL: srv.URL, APIKey: "test", Prompt: "test", APIMode: mode, AutoRetryCount: 3}
				var err error
				if disk {
					_, _, err = RequestAndExtractWithRetries(context.Background(), &NativeTransport{}, opts, t.TempDir(), "test", nil, nil)
				} else {
					_, _, err = RequestAndExtractWithRetriesAndPartialInMemory(context.Background(), &NativeTransport{}, opts, nil, nil, nil)
				}
				if err == nil || hits != 1 {
					t.Fatalf("hits=%d err=%v", hits, err)
				}
			})
		}
	}
}

func TestOnlyUnconnectedRequestsRetry(t *testing.T) {
	original := RetryBackoffSeconds
	RetryBackoffSeconds = 0
	t.Cleanup(func() { RetryBackoffSeconds = original })
	for _, mode := range []APIMode{APIModeImages, APIModeResponses} {
		t.Run(string(mode), func(t *testing.T) {
			hits := 0
			tr := &http.Transport{DialContext: func(context.Context, string, string) (net.Conn, error) { hits++; return nil, errors.New("dial failed") }}
			defer tr.CloseIdleConnections()
			c := &http.Client{Transport: tr}
			opts := Options{BaseURL: "https://example.com", APIKey: "test", Prompt: "test", APIMode: mode, HTTPClient: c, AutoRetryCount: 2}
			_, _, err := RequestAndExtractWithRetriesAndPartialInMemory(context.Background(), &NativeTransport{Client: c}, opts, nil, nil, nil)
			if err == nil || hits != 3 {
				t.Fatalf("hits=%d err=%v", hits, err)
			}
		})
	}
}
