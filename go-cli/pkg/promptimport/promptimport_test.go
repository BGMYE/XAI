package promptimport

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestParseTokenFromURL(t *testing.T) {
	token, err := ParseTokenFromURL("image-studio://import?token=k7Bx2QzR")
	if err != nil {
		t.Fatalf("ParseTokenFromURL returned error: %v", err)
	}
	if token != "k7Bx2QzR" {
		t.Fatalf("token = %q", token)
	}
}

func TestParseTokenFromURLRejectsInvalidToken(t *testing.T) {
	if _, err := ParseTokenFromURL("image-studio://import?token=abc"); ErrorCode(err) != TokenInvalid {
		t.Fatalf("error code = %q", ErrorCode(err))
	}
}

func TestExtractFirstTokenFromArgs(t *testing.T) {
	args := []string{"--flag", "image-studio://import?token=AB12cd34", "image-studio://import?token=zzzzzzzz"}
	if got := ExtractFirstTokenFromArgs(args); got != "AB12cd34" {
		t.Fatalf("ExtractFirstTokenFromArgs() = %q", got)
	}
}

func TestResolvedSizeForAspectRatio(t *testing.T) {
	cases := map[string]string{
		"auto": "auto",
		"1:1":  "1024x1024",
		"3:2":  "1536x1024",
		"2:3":  "1024x1536",
		"16:9": "1536x864",
		"9:16": "864x1536",
		"4:3":  "1360x1024",
		"3:4":  "1024x1360",
		"21:9": "1792x768",
		"9:21": "768x1792",
		"5:4":  "auto",
	}
	for input, want := range cases {
		if got := ResolvedSizeForAspectRatio(input); got != want {
			t.Fatalf("ResolvedSizeForAspectRatio(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestFetchSuccess(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("User-Agent"); got != "Image-Studio/test" {
			t.Fatalf("user-agent = %q", got)
		}
		if r.URL.Path != "/api/import-tokens/TESTTEST" {
			t.Fatalf("path = %q", r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"prompt": map[string]string{
				"zh": "森林里的猫",
				"en": "a cat in the forest",
			},
			"negative_prompt": map[string]string{
				"zh": "模糊",
			},
			"aspect_ratio": "3:2",
		})
	}))
	defer server.Close()

	payload, err := Fetch(context.Background(), "TESTTEST", FetchOptions{
		BaseURL:   server.URL,
		UserAgent: "Image-Studio/test",
		Client:    server.Client(),
	})
	if err != nil {
		t.Fatalf("Fetch returned error: %v", err)
	}
	if payload.ResolvedSize != "1536x1024" {
		t.Fatalf("ResolvedSize = %q", payload.ResolvedSize)
	}
	if payload.Prompt.Zh != "森林里的猫" {
		t.Fatalf("prompt.zh = %q", payload.Prompt.Zh)
	}
	if payload.NegativePrompt == nil || payload.NegativePrompt.Zh != "模糊" {
		t.Fatalf("negativePrompt = %#v", payload.NegativePrompt)
	}
}

func TestFetchMaps404And410(t *testing.T) {
	tests := []struct {
		name     string
		status   int
		body     map[string]string
		expected ImportErrorCode
	}{
		{name: "not-found", status: http.StatusNotFound, body: map[string]string{"error": "token_not_found"}, expected: TokenNotFound},
		{name: "used", status: http.StatusGone, body: map[string]string{"error": "token_used"}, expected: TokenUsed},
		{name: "expired", status: http.StatusGone, body: map[string]string{"error": "token_expired"}, expected: TokenExpired},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(tt.status)
				_ = json.NewEncoder(w).Encode(tt.body)
			}))
			defer server.Close()
			_, err := Fetch(context.Background(), "TESTTEST", FetchOptions{
				BaseURL: server.URL,
				Client:  server.Client(),
			})
			if ErrorCode(err) != tt.expected {
				t.Fatalf("ErrorCode(err) = %q, want %q", ErrorCode(err), tt.expected)
			}
		})
	}
}

func TestFetchRetriesUnavailable(t *testing.T) {
	attempts := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempts++
		w.WriteHeader(http.StatusBadGateway)
	}))
	defer server.Close()

	start := time.Now()
	_, err := Fetch(context.Background(), "TESTTEST", FetchOptions{
		BaseURL: server.URL,
		Client:  server.Client(),
	})
	if ErrorCode(err) != TokenUnavailable {
		t.Fatalf("ErrorCode(err) = %q", ErrorCode(err))
	}
	if attempts != 4 {
		t.Fatalf("attempts = %d, want 4", attempts)
	}
	if time.Since(start) < retryBackoffs[0] {
		t.Fatal("expected retry backoff to run")
	}
}

func TestFetchRejectsInvalidToken(t *testing.T) {
	_, err := Fetch(context.Background(), "bad", FetchOptions{})
	if ErrorCode(err) != TokenInvalid {
		t.Fatalf("ErrorCode(err) = %q", ErrorCode(err))
	}
}

func TestPreferChinese(t *testing.T) {
	text := &BilingualText{Zh: "", En: "fallback"}
	if got := PreferChinese(text); got != "fallback" {
		t.Fatalf("PreferChinese() = %q", got)
	}
}

func TestSleepWithContextCancelled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := sleepWithContext(ctx, time.Second); !errors.Is(err, context.Canceled) {
		t.Fatalf("sleepWithContext error = %v", err)
	}
}
