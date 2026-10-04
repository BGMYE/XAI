package client

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestVideoQueryDistinguishesBackoffFromInvalidProtocol(t *testing.T) {
	for _, status := range []int{429, 200} {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Retry-After", "37")
			w.WriteHeader(status)
			_, _ = w.Write([]byte("invalid json"))
		}))
		_, err := (VideoRunner{Options: VideoOptions{BaseURL: srv.URL, APIKey: "key"}}).Query(context.Background(), "id")
		srv.Close()
		if status == 429 {
			var httpErr *HTTPStatusError
			if !errors.As(err, &httpErr) || httpErr.RetryAfter != "37" {
				t.Fatalf("lost backoff: %v", err)
			}
		} else {
			var protocol *VideoProtocolError
			if !errors.As(err, &protocol) {
				t.Fatalf("invalid response became a network retry: %v", err)
			}
		}
	}
}

func TestVideoRunnerSeparatesCreationQueryAndContent(t *testing.T) {
	for _, protocol := range []string{"openai", "xai"} {
		t.Run(protocol, func(t *testing.T) {
			posts, downloads := 0, 0
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Authorization") != "Bearer key" {
					t.Error("missing auth")
				}
				switch {
				case r.Method == "POST":
					posts++
					if protocol == "xai" {
						var body map[string]any
						_ = json.NewDecoder(r.Body).Decode(&body)
						if body["duration"] != float64(4) || r.URL.Path != "/api/v3/videos/generations" {
							t.Errorf("request %s %+v", r.URL.Path, body)
						}
						_, _ = w.Write([]byte(`{"request_id":"video-1"}`))
					} else {
						if r.URL.Path != "/api/v3/videos" {
							t.Error(r.URL.Path)
						}
						_, _ = w.Write([]byte(`{"id":"video-1","status":"queued"}`))
					}
				case r.URL.Path == "/api/v3/videos/video-1":
					_, _ = w.Write([]byte(`{"status":"completed","progress":100}`))
				case r.URL.Path == "/api/v3/videos/video-1/content":
					downloads++
					_, _ = w.Write([]byte("media"))
				default:
					t.Error(r.URL.Path)
				}
			}))
			defer srv.Close()
			runner := VideoRunner{Options: VideoOptions{BaseURL: srv.URL + "/api/v3", APIKey: "key", Protocol: protocol, VideoModelID: "explicit", Prompt: "test", Seconds: 4}}
			created, err := runner.Create(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			result, err := runner.Query(context.Background(), created.ID)
			if err != nil || result.Status != VideoStatusCompleted {
				t.Fatalf("%+v %v", result, err)
			}
			if posts != 1 || downloads != 0 {
				t.Fatal("query submitted or downloaded")
			}
			resp, err := runner.Download(context.Background(), created.ID)
			if err != nil {
				t.Fatal(err)
			}
			resp.Body.Close()
			if downloads != 1 {
				t.Fatal("missing download")
			}
		})
	}
}
