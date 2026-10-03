package studio

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// openAIUpstream is a mock image upstream mounted under /v1.
func openAIUpstream(t *testing.T, handle func(w http.ResponseWriter, r *http.Request, body []byte)) (*httptest.Server, *atomic.Int32) {
	t.Helper()
	var posts atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			posts.Add(1)
		}
		if r.Header.Get("Authorization") != "Bearer LOCAL-TEST-ONLY" && r.Method == http.MethodPost {
			t.Error("generation request without the configured key")
		}
		body, _ := io.ReadAll(r.Body)
		handle(w, r, body)
	}))
	t.Cleanup(server.Close)
	return server, &posts
}

func imageProfile(base string) Profile {
	return Profile{ID: "upstream", Name: "Mock", BaseURL: base + "/v1", Protocol: "openai", AllowLocal: true, ImageModel: "gpt-image-test"}
}

func generationEngine(t *testing.T, p Profile) (*Engine, Request) {
	t.Helper()
	e, err := Open(t.TempDir(), &memorySecrets{m: map[string]string{}}, Options{PollInterval: time.Millisecond})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(e.Close)
	if _, err = e.SaveProfile(p, "LOCAL-TEST-ONLY"); err != nil {
		t.Fatal(err)
	}
	if _, err = e.SaveProject(Project{ID: "project", Name: "画布", Viewport: Viewport{Zoom: 1}}); err != nil {
		t.Fatal(err)
	}
	return e, Request{ID: NewID(), ProfileID: p.ID, ProjectID: "project", Kind: "image", Prompt: "cat"}
}

func TestImagesAPIIsStreamedThroughTheSharedClient(t *testing.T) {
	final := base64.StdEncoding.EncodeToString(pixel())
	var request map[string]any
	server, posts := openAIUpstream(t, func(w http.ResponseWriter, r *http.Request, body []byte) {
		if r.URL.Path != "/v1/images/generations" {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		_ = json.Unmarshal(body, &request)
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprintf(w, "data: {\"type\":\"image_generation.partial_image\",\"partial_image_index\":0,\"b64_json\":%q}\n\n", final)
		w.(http.Flusher).Flush()
		fmt.Fprintf(w, "data: {\"type\":\"image_generation.completed\",\"b64_json\":%q}\n\n", final)
	})
	var progress atomic.Int32
	e, err := Open(t.TempDir(), &memorySecrets{m: map[string]string{}}, Options{OnProgress: func(_ string, p int) { progress.Store(int32(p)) }})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(e.Close)
	if _, err = e.SaveProfile(imageProfile(server.URL), "LOCAL-TEST-ONLY"); err != nil {
		t.Fatal(err)
	}
	if _, err = e.SaveProject(Project{ID: "project", Name: "画布", Viewport: Viewport{Zoom: 1}}); err != nil {
		t.Fatal(err)
	}
	r := Request{ID: NewID(), ProfileID: "upstream", ProjectID: "project", Kind: "image", Prompt: "cat"}
	if _, err = e.Submit(r); err != nil {
		t.Fatal(err)
	}
	await(t, e, r.ID, "succeeded")
	if posts.Load() != 1 || request["stream"] != true || request["model"] != "gpt-image-test" || request["size"] != "auto" {
		t.Fatalf("posts=%d request=%v", posts.Load(), request)
	}
	if progress.Load() != 60 {
		t.Fatalf("partial image did not report progress: %d", progress.Load())
	}
}

func TestResponsesAPIProfileUsesTheImageTool(t *testing.T) {
	final := base64.StdEncoding.EncodeToString(pixel())
	var request map[string]any
	server, posts := openAIUpstream(t, func(w http.ResponseWriter, r *http.Request, body []byte) {
		if r.URL.Path != "/v1/responses" {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		_ = json.Unmarshal(body, &request)
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"type\":\"response.created\"}\n\n")
		fmt.Fprintf(w, "data: {\"type\":\"response.output_item.done\",\"item\":{\"type\":\"image_generation_call\",\"result\":%q}}\n\n", final)
	})
	p := imageProfile(server.URL)
	p.ImageAPI, p.TextModel = "responses", "text-model"
	e, r := generationEngine(t, p)
	if _, err := e.Submit(r); err != nil {
		t.Fatal(err)
	}
	await(t, e, r.ID, "succeeded")
	if posts.Load() != 1 || request["model"] != "text-model" {
		t.Fatalf("posts=%d request model=%v", posts.Load(), request["model"])
	}
}

func TestResponsesAPIProfileNeedsAnExplicitTextModel(t *testing.T) {
	p := imageProfile("https://example.com")
	p.ImageAPI = "responses"
	e, r := generationEngine(t, p)
	if _, err := e.Submit(r); err == nil || !strings.Contains(err.Error(), "文本模型") {
		t.Fatalf("submitted without a text model: %v", err)
	}
}

func TestGenerationOutcomesAreClassifiedOnce(t *testing.T) {
	for _, tc := range []struct {
		name   string
		handle func(w http.ResponseWriter)
		state  string
		error  string
	}{
		{"rejected", func(w http.ResponseWriter) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			fmt.Fprint(w, `{"error":{"message":"invalid size"}}`)
		}, "failed", "invalid size"},
		{"gateway timeout", func(w http.ResponseWriter) {
			w.Header().Set("Content-Type", "text/html")
			w.WriteHeader(524)
			fmt.Fprint(w, "<html>timeout</html>")
		}, "uncertain", ""},
		{"blocked by moderation", func(w http.ResponseWriter) {
			w.Header().Set("Content-Type", "text/event-stream")
			fmt.Fprint(w, "data: {\"type\":\"error\",\"error\":{\"code\":\"moderation_blocked\",\"message\":\"blocked\"}}\n\n")
		}, "failed", "内容审核"},
		{"stream cut off", func(w http.ResponseWriter) {
			w.Header().Set("Content-Type", "text/event-stream")
			fmt.Fprint(w, "data: {\"type\":\"image_generation.partial_image\",\"b64_json\":\"AAAA\"}\n\n")
			w.(http.Flusher).Flush()
			conn, _, err := w.(http.Hijacker).Hijack()
			if err == nil {
				_ = conn.Close()
			}
		}, "uncertain", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server, posts := openAIUpstream(t, func(w http.ResponseWriter, _ *http.Request, _ []byte) { tc.handle(w) })
			e, r := generationEngine(t, imageProfile(server.URL))
			if _, err := e.Submit(r); err != nil {
				t.Fatal(err)
			}
			j := await(t, e, r.ID, tc.state)
			if posts.Load() != 1 || !strings.Contains(j.Error, tc.error) || strings.Contains(j.Error, "LOCAL-TEST-ONLY") {
				t.Fatalf("posts=%d error=%q", posts.Load(), j.Error)
			}
		})
	}
}

func TestEditUploadsTheReferenceAndCleansUp(t *testing.T) {
	final := base64.StdEncoding.EncodeToString(pixel())
	server, _ := openAIUpstream(t, func(w http.ResponseWriter, r *http.Request, body []byte) {
		if r.URL.Path != "/v1/images/edits" || !strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/form-data") {
			t.Errorf("edit sent to %s as %s", r.URL.Path, r.Header.Get("Content-Type"))
		}
		if !strings.Contains(string(body), `name="image"`) || !strings.Contains(string(body), string(pixel())) {
			t.Error("reference image missing from the upload")
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"data":[{"b64_json":%q}]}`, final)
	})
	e, r := generationEngine(t, imageProfile(server.URL))
	a, err := e.Import(pixel(), "reference.png")
	if err != nil {
		t.Fatal(err)
	}
	r.ReferenceAssetID = a.ID
	if _, err = e.Submit(r); err != nil {
		t.Fatal(err)
	}
	await(t, e, r.ID, "succeeded")
	leftovers, _ := filepath.Glob(filepath.Join(e.repo.mediaDir(), ".incoming-*"))
	if len(leftovers) != 0 {
		t.Fatalf("temporary files left behind: %v", leftovers)
	}
}

// proxyServer is a minimal forward proxy for plain HTTP requests.
func proxyServer(t *testing.T) (*httptest.Server, *atomic.Int32) {
	t.Helper()
	var seen atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !r.URL.IsAbs() {
			http.Error(w, "not a proxy request", http.StatusBadRequest)
			return
		}
		seen.Add(1)
		out, err := http.NewRequest(r.Method, r.URL.String(), r.Body)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		out.Header = r.Header.Clone()
		resp, err := http.DefaultTransport.RoundTrip(out)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		defer resp.Body.Close()
		for k, v := range resp.Header {
			w.Header()[k] = v
		}
		w.WriteHeader(resp.StatusCode)
		_, _ = io.Copy(w, resp.Body)
	}))
	t.Cleanup(server.Close)
	return server, &seen
}

func TestGenerationFollowsTheProxySetting(t *testing.T) {
	final := base64.StdEncoding.EncodeToString(pixel())
	server, posts := openAIUpstream(t, func(w http.ResponseWriter, _ *http.Request, _ []byte) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"data":[{"b64_json":%q}]}`, final)
	})
	proxy, proxied := proxyServer(t)
	e, r := generationEngine(t, imageProfile(server.URL))
	if _, err := e.SetNetwork(NetworkSettings{ProxyMode: "custom", ProxyURL: proxy.URL}); err != nil {
		t.Fatal(err)
	}
	if _, err := e.Submit(r); err != nil {
		t.Fatal(err)
	}
	await(t, e, r.ID, "succeeded")
	if posts.Load() != 1 || proxied.Load() != 1 {
		t.Fatalf("posts=%d proxied=%d", posts.Load(), proxied.Load())
	}
}

func TestProxiedRequestsStillRefusePrivateAddresses(t *testing.T) {
	proxy, proxied := proxyServer(t)
	p := Profile{ID: "upstream", Name: "LAN", BaseURL: "http://10.0.0.7:3000/v1", Protocol: "openai", AllowInsecure: true, ImageModel: "img"}
	e, r := generationEngine(t, p)
	if _, err := e.SetNetwork(NetworkSettings{ProxyMode: "custom", ProxyURL: proxy.URL}); err != nil {
		t.Fatal(err)
	}
	if _, err := e.Submit(r); err != nil {
		t.Fatal(err)
	}
	j := await(t, e, r.ID, "failed")
	if proxied.Load() != 0 || !strings.HasPrefix(j.Error, "请求未发出") {
		t.Fatalf("proxied=%d error=%q", proxied.Load(), j.Error)
	}
}

func TestInvalidProxySettingsAreRejected(t *testing.T) {
	e, _, _ := fixture(t, nil)
	for _, n := range []NetworkSettings{{ProxyMode: "custom"}, {ProxyMode: "custom", ProxyURL: "socks5://127.0.0.1:1080"}, {ProxyMode: "sometimes"}} {
		if _, err := e.SetNetwork(n); err == nil {
			t.Fatalf("accepted %+v", n)
		}
	}
	if got := e.Network(); got.ProxyMode != "system" {
		t.Fatalf("default network = %+v", got)
	}
}

func TestNetworkSettingsSurviveRestart(t *testing.T) {
	root := t.TempDir()
	secrets := &memorySecrets{m: map[string]string{}}
	e, err := Open(root, secrets, Options{})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = e.SetNetwork(NetworkSettings{ProxyMode: "custom", ProxyURL: "http://127.0.0.1:7890/"}); err != nil {
		t.Fatal(err)
	}
	e.Close()
	e, err = Open(root, secrets, Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer e.Close()
	if got := e.Network(); got.ProxyMode != "custom" || got.ProxyURL != "http://127.0.0.1:7890" {
		t.Fatalf("network = %+v", got)
	}
}

func TestTailBufferKeepsTheEnd(t *testing.T) {
	b := &tailBuffer{limit: 8}
	for i := 0; i < 100; i++ {
		_, _ = b.Write([]byte{byte('a' + i%26)})
	}
	_, _ = b.Write([]byte(strings.Repeat("x", 30) + "END"))
	if got := b.String(); got != "xxxxxEND" {
		t.Fatalf("tail = %q", got)
	}
}

func TestFakeIPProxyRangeIsReachable(t *testing.T) {
	// Proxy tools in fake-IP mode answer DNS with 198.18.0.0/15 addresses.
	if !allowedIP(net.ParseIP("198.18.0.21"), false) {
		t.Fatal("fake-IP address refused")
	}
	for _, host := range []string{"10.0.0.1", "localhost", "api.localhost", "[::1]"} {
		if allowedName(strings.Trim(host, "[]"), false) {
			t.Fatalf("%s allowed through a proxy", host)
		}
	}
	if !allowedName("relay.example.com", false) || !allowedName("127.0.0.1", true) {
		t.Fatal("ordinary or explicitly allowed host refused")
	}
}
