package client

import (
	"net/http"
	"testing"
)

func TestNormalizeProxyConfigDefaultsToSystem(t *testing.T) {
	got, err := NormalizeProxyConfig("", "")
	if err != nil {
		t.Fatal(err)
	}
	if got.Mode != ProxyModeSystem || got.URL != "" {
		t.Fatalf("unexpected config: %#v", got)
	}
}

func TestNormalizeProxyConfigAcceptsCustomHTTPAndHTTPS(t *testing.T) {
	for _, raw := range []string{"http://127.0.0.1:7890", "https://proxy.example:8443"} {
		got, err := NormalizeProxyConfig(ProxyModeCustom, raw)
		if err != nil {
			t.Fatalf("NormalizeProxyConfig(%q) error: %v", raw, err)
		}
		if got.Mode != ProxyModeCustom || got.URL != raw {
			t.Fatalf("unexpected config: %#v", got)
		}
	}
}

func TestNormalizeProxyConfigRejectsInvalidCustomURL(t *testing.T) {
	for _, raw := range []string{"", "socks5://127.0.0.1:1080", "http://proxy.example:8080/path", "http://proxy.example:8080?q=1"} {
		if _, err := NormalizeProxyConfig(ProxyModeCustom, raw); err == nil {
			t.Fatalf("expected %q to be rejected", raw)
		}
	}
}

func TestNewHTTPTransportNoProxyClearsProxyFunc(t *testing.T) {
	transport, err := NewHTTPTransport(ProxyConfig{Mode: ProxyModeNone})
	if err != nil {
		t.Fatal(err)
	}
	if transport.Proxy != nil {
		t.Fatal("no-proxy transport should not have a proxy func")
	}
}

func TestNewHTTPTransportCustomProxy(t *testing.T) {
	transport, err := NewHTTPTransport(ProxyConfig{Mode: ProxyModeCustom, URL: "http://127.0.0.1:7890"})
	if err != nil {
		t.Fatal(err)
	}
	if transport.Proxy == nil {
		t.Fatal("custom proxy transport should have a proxy func")
	}
	req, err := http.NewRequest(http.MethodGet, "https://example.com/v1/models", nil)
	if err != nil {
		t.Fatal(err)
	}
	got, err := transport.Proxy(req)
	if err != nil {
		t.Fatal(err)
	}
	if got.String() != "http://127.0.0.1:7890" {
		t.Fatalf("proxy URL = %q", got.String())
	}
}

func TestParseSystemProxySelectorUsesGlobalProxy(t *testing.T) {
	selector, err := parseSystemProxySelector("127.0.0.1:7890", "")
	if err != nil {
		t.Fatal(err)
	}
	req, err := http.NewRequest(http.MethodGet, "https://example.com/v1/models", nil)
	if err != nil {
		t.Fatal(err)
	}
	got, decided := selector.resolve(req.URL)
	if !decided || got == nil {
		t.Fatalf("selector.resolve() = (%v, %v), want proxy decision", got, decided)
	}
	if got.String() != "http://127.0.0.1:7890" {
		t.Fatalf("proxy URL = %q", got.String())
	}
}

func TestParseSystemProxySelectorUsesPerSchemeProxy(t *testing.T) {
	selector, err := parseSystemProxySelector("http=127.0.0.1:7890; https=https://127.0.0.1:8443", "")
	if err != nil {
		t.Fatal(err)
	}
	httpReq, err := http.NewRequest(http.MethodGet, "http://example.com/ping", nil)
	if err != nil {
		t.Fatal(err)
	}
	gotHTTP, decided := selector.resolve(httpReq.URL)
	if !decided || gotHTTP == nil || gotHTTP.String() != "http://127.0.0.1:7890" {
		t.Fatalf("http proxy = (%v, %v), want http://127.0.0.1:7890", gotHTTP, decided)
	}
	httpsReq, err := http.NewRequest(http.MethodGet, "https://example.com/v1/models", nil)
	if err != nil {
		t.Fatal(err)
	}
	gotHTTPS, decided := selector.resolve(httpsReq.URL)
	if !decided || gotHTTPS == nil || gotHTTPS.String() != "https://127.0.0.1:8443" {
		t.Fatalf("https proxy = (%v, %v), want https://127.0.0.1:8443", gotHTTPS, decided)
	}
}

func TestParseSystemProxySelectorHonorsBypassRules(t *testing.T) {
	selector, err := parseSystemProxySelector("proxy.example:8080", "*.corp.example;<local>;localhost")
	if err != nil {
		t.Fatal(err)
	}
	tests := []string{
		"https://api.corp.example/v1/models",
		"https://intranet/v1/models",
		"https://localhost/v1/models",
	}
	for _, rawURL := range tests {
		req, err := http.NewRequest(http.MethodGet, rawURL, nil)
		if err != nil {
			t.Fatal(err)
		}
		got, decided := selector.resolve(req.URL)
		if !decided || got != nil {
			t.Fatalf("%s proxy = (%v, %v), want direct bypass", rawURL, got, decided)
		}
	}
	req, err := http.NewRequest(http.MethodGet, "https://example.com/v1/models", nil)
	if err != nil {
		t.Fatal(err)
	}
	got, decided := selector.resolve(req.URL)
	if !decided || got == nil || got.String() != "http://proxy.example:8080" {
		t.Fatalf("external proxy = (%v, %v), want http://proxy.example:8080", got, decided)
	}
}

func TestParseSystemProxySelectorTreatsMissingSchemeAsDirect(t *testing.T) {
	selector, err := parseSystemProxySelector("http=127.0.0.1:7890", "")
	if err != nil {
		t.Fatal(err)
	}
	req, err := http.NewRequest(http.MethodGet, "ws://example.com/socket", nil)
	if err != nil {
		t.Fatal(err)
	}
	got, decided := selector.resolve(req.URL)
	if !decided || got != nil {
		t.Fatalf("selector.resolve() = (%v, %v), want explicit direct", got, decided)
	}
}
