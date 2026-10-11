package studio

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type mediaRoundTrip func(*http.Request) (*http.Response, error)

func (f mediaRoundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestMediaProxyFallbackOnlyUsesConfiguredOrigin(t *testing.T) {
	old := lookupIPAddr
	defer func() { lookupIPAddr = old }()
	lookupIPAddr = func(context.Context, string) ([]net.IPAddr, error) { return nil, errors.New("direct DNS unavailable") }
	calls := 0
	proxy := &http.Client{Transport: mediaRoundTrip(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.Header.Get("Authorization") != "" {
			t.Error("credential sent to result URL")
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(string(pixel()))), Header: http.Header{}}, nil
	})}
	profile := Profile{BaseURL: "https://upstream.example/api/v3"}
	p := &HTTPProvider{}
	if _, err := p.fetchMedia(context.Background(), proxy, profile, "https://cdn.example/image.png", 0); err == nil || calls != 0 {
		t.Fatalf("external CDN used proxy: %d %v", calls, err)
	}
	if _, err := p.fetchMedia(context.Background(), proxy, profile, "https://upstream.example/image.png", 0); err != nil || calls != 1 {
		t.Fatalf("same origin fallback failed: %d %v", calls, err)
	}
	if _, err := p.fetchMedia(context.Background(), proxy, profile, "https://upstream.example:444/image.png", 0); err == nil || calls != 1 {
		t.Fatal("different port used proxy")
	}
	lookupIPAddr = func(context.Context, string) ([]net.IPAddr, error) {
		return []net.IPAddr{{IP: net.ParseIP("10.0.0.1")}}, nil
	}
	if _, err := p.fetchMedia(context.Background(), proxy, profile, "https://upstream.example/image.png", 0); err == nil || calls != 1 {
		t.Fatal("blocked address bypassed through proxy")
	}
}

func TestMediaRedirectRechecksOriginAndNeverUsesProxyForCDN(t *testing.T) {
	old := lookupIPAddr
	defer func() { lookupIPAddr = old }()
	lookupIPAddr = func(_ context.Context, host string) ([]net.IPAddr, error) {
		if ip := net.ParseIP(host); ip != nil {
			return []net.IPAddr{{IP: ip}}, nil
		}
		return nil, errors.New("offline CDN")
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "" {
			t.Error("credential leaked")
		}
		http.Redirect(w, r, "https://cdn.example/image.png", http.StatusFound)
	}))
	defer srv.Close()
	calls := 0
	proxy := &http.Client{Transport: mediaRoundTrip(func(*http.Request) (*http.Response, error) { calls++; return nil, errors.New("unexpected proxy") })}
	_, err := (&HTTPProvider{}).fetchMedia(context.Background(), proxy, Profile{BaseURL: srv.URL, AllowLocal: true}, srv.URL+"/result", 0)
	if err == nil || calls != 0 {
		t.Fatalf("redirect bypassed policy: %v %d", err, calls)
	}
}
