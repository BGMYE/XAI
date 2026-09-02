package client

import (
	"context"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
)

const videoTestKey = "test-key"

func TestCreateVideoUsesExplicitEndpointAndBearerKey(t *testing.T) {
	var gotPath, gotAuth, gotModel, gotPrompt, gotSeconds string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath, gotAuth = r.URL.Path, r.Header.Get("Authorization")
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			t.Errorf("parse multipart: %v", err)
		}
		gotModel = r.FormValue("model")
		gotPrompt = r.FormValue("prompt")
		gotSeconds = r.FormValue("seconds")
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		_, _ = w.Write([]byte(`{"id":"vid_123","status":"queued"}`))
	}))
	defer srv.Close()

	result, err := CreateVideo(context.Background(), VideoOptions{
		BaseURL: srv.URL, APIKey: "sk-test", VideoModelID: "video-model",
		EndpointPath: "/custom/videos", Prompt: "a cat running", Seconds: 4,
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.ID != "vid_123" || result.Status != VideoStatusQueued {
		t.Fatalf("result=%+v", result)
	}
	if gotPath != "/custom/videos" || gotAuth != "Bearer sk-test" {
		t.Fatalf("path=%q auth=%q", gotPath, gotAuth)
	}
	if gotModel != "video-model" || gotPrompt != "a cat running" || gotSeconds != "4" {
		t.Fatalf("model=%q prompt=%q seconds=%q", gotModel, gotPrompt, gotSeconds)
	}
}

func TestPollVideoParsesB64JSONAndRejectsOversizedBody(t *testing.T) {
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"vid_123","status":"completed","data":[{"b64_json":"AAAA"}]}`))
	}))
	defer srv.Close()

	result, err := PollVideo(context.Background(), VideoPollOptions{BaseURL: srv.URL, APIKey: "sk-test", VideoID: "vid_123"})
	if err != nil {
		t.Fatal(err)
	}
	if calls != 1 || result.Status != VideoStatusCompleted || result.B64JSON != "AAAA" {
		t.Fatalf("calls=%d result=%+v", calls, result)
	}
}

func TestPollVideoDownloadsCompletedMediaToLocalPayload(t *testing.T) {
	var serverURL string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/media/video.mp4" {
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = w.Write([]byte("video-bytes"))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"vid_123","status":"completed","url":"` + serverURL + `/media/video.mp4"}`))
	}))
	serverURL = srv.URL
	defer srv.Close()

	result, err := PollVideo(context.Background(), VideoPollOptions{BaseURL: srv.URL, APIKey: videoTestKey, VideoID: "vid_123"})
	if err != nil {
		t.Fatal(err)
	}
	if result.URL != "" || result.B64JSON != "dmlkZW8tYnl0ZXM=" {
		t.Fatalf("completed result must contain only a local payload: %+v", result)
	}
}

func TestVideoURLsAreValidatedAndModelIsRequired(t *testing.T) {
	insecure := VideoOptions{BaseURL: "http://relay.example", VideoModelID: "m"}
	insecure.APIKey = videoTestKey
	if _, err := CreateVideo(context.Background(), insecure); err == nil {
		t.Fatal("expected insecure URL rejection")
	}
	missingModel := VideoOptions{BaseURL: "https://relay.example"}
	missingModel.APIKey = videoTestKey
	if _, err := CreateVideo(context.Background(), missingModel); err == nil {
		t.Fatal("expected missing model rejection")
	}
}

func TestVideoEndpointPathRejectsCredentialReroutingSyntax(t *testing.T) {
	for _, endpoint := range []string{"https://evil.example/videos", "//evil.example/videos", "/v1/videos?next=/admin", "/v1/../admin", "/v1/%2e%2e/admin", "/v1/videos#fragment"} {
		opts := VideoOptions{BaseURL: "https://relay.example", VideoModelID: "m", Prompt: "p", EndpointPath: endpoint}
		opts.APIKey = videoTestKey
		if _, err := CreateVideo(context.Background(), opts); err == nil {
			t.Fatalf("endpoint %q should be rejected", endpoint)
		}
	}
}

func TestVideoProviderMediaURLRejectsActiveAndInsecureSchemes(t *testing.T) {
	for _, mediaURL := range []string{"javascript:alert(1)", "file:///tmp/video.mp4", "http://public.example/video.mp4", "https://user:pass@cdn.example/video.mp4"} {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id":"vid_123","status":"completed","url":"` + mediaURL + `"}`))
		}))
		opts := VideoPollOptions{BaseURL: srv.URL, VideoID: "vid_123"}
		opts.APIKey = videoTestKey
		_, err := PollVideo(context.Background(), opts)
		srv.Close()
		if err == nil {
			t.Fatalf("media URL %q should be rejected", mediaURL)
		}
	}
}

func TestDecodeVideoResponseAppliesTheSubmittingUpstreamMediaPolicy(t *testing.T) {
	body := `{"id":"vid_123","status":"completed","url":"http://127.0.0.1:9000/video.mp4"}`
	response := func() *http.Response {
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(body))}
	}
	if _, err := decodeVideoResponseForBase(response(), "https://provider.example"); err == nil {
		t.Fatal("public upstream must not route returned media to loopback")
	}
	result, err := decodeVideoResponseForBase(response(), "http://127.0.0.1:8080")
	if err != nil {
		t.Fatalf("loopback upstream should be allowed to return loopback media: %v", err)
	}
	if result.URL != "http://127.0.0.1:9000/video.mp4" {
		t.Fatalf("unexpected media URL %q", result.URL)
	}
}

func TestDecodeVideoResponseAllowsLocalhostMediaForLoopbackUpstream(t *testing.T) {
	body := `{"id":"vid_123","status":"completed","url":"http://localhost:9000/video.mp4"}`
	resp := &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(body))}
	result, err := decodeVideoResponseForBase(resp, "http://localhost:8080")
	if err != nil {
		t.Fatalf("loopback upstream should allow localhost media: %v", err)
	}
	if result.URL != "http://localhost:9000/video.mp4" {
		t.Fatalf("unexpected media URL %q", result.URL)
	}
}

func TestDecodeVideoResponseRejectsLocalhostHostnameForPublicUpstream(t *testing.T) {
	body := `{"id":"vid_123","status":"completed","url":"https://localhost/video.mp4"}`
	resp := &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(body))}
	if _, err := decodeVideoResponseForBase(resp, "https://provider.example"); err == nil {
		t.Fatal("public upstream must not route returned media to localhost")
	}
}

func TestVideoCompletedResponseRequiresMediaPayload(t *testing.T) {
	resp := &http.Response{
		StatusCode: http.StatusOK,
		Body:       io.NopCloser(strings.NewReader(`{"id":"vid_123","status":"completed"}`)),
	}
	if _, err := decodeVideoResponseForBase(resp, "https://provider.example"); err == nil || !strings.Contains(err.Error(), "missing URL or b64_json") {
		t.Fatalf("expected missing completed payload error, got %v", err)
	}
}

func TestVideoMediaURLRejectsUnspecifiedAddresses(t *testing.T) {
	for _, mediaURL := range []string{"https://0.0.0.0/video.mp4", "https://[::]/video.mp4"} {
		if _, err := validateVideoMediaURLForBase(mediaURL, "http://localhost:8080"); err == nil {
			t.Fatalf("media URL %q should reject an unspecified address", mediaURL)
		}
	}
}

func TestResolvedVideoMediaRejectsCarrierGradeNAT(t *testing.T) {
	if err := validateResolvedVideoIP(net.ParseIP("100.64.0.1"), false); err == nil {
		t.Fatal("public provider media must not resolve to carrier-grade NAT")
	}
}

func TestLoopbackUpstreamDoesNotPermitLANOrMetadataMedia(t *testing.T) {
	for _, mediaURL := range []string{
		"http://192.168.1.10/video.mp4",
		"http://169.254.169.254/latest/meta-data",
	} {
		if _, err := validateVideoMediaURLForBase(mediaURL, "http://localhost:8080"); err == nil {
			t.Fatalf("loopback upstream must not permit non-loopback media %q", mediaURL)
		}
	}
}

func TestResolvedVideoMediaRejectsSpecialUseAddressRanges(t *testing.T) {
	for _, address := range []string{
		"192.0.0.1",
		"192.0.2.1",
		"198.18.0.1",
		"198.51.100.1",
		"203.0.113.1",
		"240.0.0.1",
		"100::1",
		"64:ff9b::1",
		"64:ff9b:1::1",
		"2001:db8::1",
		"3fff::1",
		"5f00::1",
	} {
		if err := validateResolvedVideoIP(net.ParseIP(address), false); err == nil {
			t.Fatalf("special-use address %s must be rejected", address)
		}
	}
}

type fixedVideoResolver []net.IPAddr

func (r fixedVideoResolver) LookupIPAddr(context.Context, string) ([]net.IPAddr, error) {
	return []net.IPAddr(r), nil
}

func TestResolvePinnedVideoIPRejectsMixedPublicPrivateDNS(t *testing.T) {
	resolver := fixedVideoResolver{
		{IP: net.ParseIP("93.184.216.34")},
		{IP: net.ParseIP("127.0.0.1")},
	}
	if _, err := resolvePinnedVideoIP(context.Background(), resolver, "cdn.example", false); err == nil || !strings.Contains(err.Error(), "private") {
		t.Fatalf("expected mixed DNS answer rejection, got %v", err)
	}
}

func TestFetchVideoMediaRevalidatesRedirectTargets(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "http://0.0.0.0/private.mp4", http.StatusFound)
	}))
	defer srv.Close()

	_, err := fetchVideoMedia(context.Background(), srv.URL, srv.URL, net.DefaultResolver, &net.Dialer{})
	if err == nil || !strings.Contains(err.Error(), "unspecified") {
		t.Fatalf("expected unsafe redirect rejection, got %v", err)
	}
}

func TestFetchVideoMediaRejectsOversizedContentLengthBeforeReading(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", strconv.FormatInt(MaxVideoMediaBytes+1, 10))
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	_, err := fetchVideoMedia(context.Background(), srv.URL, srv.URL, net.DefaultResolver, &net.Dialer{})
	if err == nil || !strings.Contains(err.Error(), "body limit") {
		t.Fatalf("expected media body limit error, got %v", err)
	}
}

func TestVideoMediaLimitKeepsBase64IPCWithinDesktopMemoryBudget(t *testing.T) {
	const maxSafeVideoMediaBytes = 32 * 1024 * 1024
	if MaxVideoMediaBytes > maxSafeVideoMediaBytes {
		t.Fatalf("media limit %d permits excessive byte/base64/JSON copies; maximum is %d", MaxVideoMediaBytes, maxSafeVideoMediaBytes)
	}
}

func TestVideoResponseBodyLimitIsEnforced(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"vid_123","status":"completed","b64_json":"`))
		_, _ = w.Write([]byte(strings.Repeat("A", MaxVideoResponseBytes)))
		_, _ = w.Write([]byte(`"}`))
	}))
	defer srv.Close()

	_, err := PollVideo(context.Background(), VideoPollOptions{BaseURL: srv.URL, APIKey: videoTestKey, VideoID: "vid_123"})
	if err == nil || !strings.Contains(err.Error(), "body limit") {
		t.Fatalf("expected body limit error, got %v", err)
	}
}

func TestVideoFailedStateReturnsProviderError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"vid_123","status":"failed","error":{"message":"provider rejected prompt"}}`))
	}))
	defer srv.Close()

	result, err := PollVideo(context.Background(), VideoPollOptions{BaseURL: srv.URL, APIKey: videoTestKey, VideoID: "vid_123"})
	if err == nil || result.Status != VideoStatusFailed || !strings.Contains(err.Error(), "provider rejected prompt") {
		t.Fatalf("result=%+v err=%v", result, err)
	}
}

func TestVideoFailedStatePreservesProviderErrorWhenURLIsMalformed(t *testing.T) {
	body := `{"id":"vid_123","status":"failed","url":"javascript:alert(1)","error":{"message":"provider rejected prompt"}}`
	resp := &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(body))}
	result, err := decodeVideoResponseForBase(resp, "https://provider.example")
	if err == nil || result.Status != VideoStatusFailed || !strings.Contains(err.Error(), "provider rejected prompt") {
		t.Fatalf("result=%+v err=%v", result, err)
	}
}

func TestVideoRedirectIsNotFollowedAndStatusIsPreserved(t *testing.T) {
	called := false
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { called = true }))
	defer target.Close()
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, target.URL, http.StatusFound) }))
	defer source.Close()
	_, err := PollVideo(context.Background(), VideoPollOptions{BaseURL: source.URL, APIKey: videoTestKey, VideoID: "v"})
	if err == nil || !strings.Contains(err.Error(), "HTTP 302") || called {
		t.Fatalf("err=%v targetCalled=%v", err, called)
	}
}
