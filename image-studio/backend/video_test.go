package backend

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

const videoTestAPIKey = "test-key"

func TestServiceCreateAndPollVideo(t *testing.T) {
	polls := 0
	var serverURL string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/media/video.mp4" {
			_, _ = w.Write([]byte("backend-video"))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodPost {
			_, _ = w.Write([]byte("{\"id\":\"vid_backend\",\"status\":\"queued\"}"))
			return
		}
		polls++
		_, _ = w.Write([]byte("{\"id\":\"vid_backend\",\"status\":\"completed\",\"url\":\"" + serverURL + "/media/video.mp4\"}"))
	}))
	serverURL = srv.URL
	defer srv.Close()

	svc := NewService()
	StartDesktopService(svc, context.Background())
	created, err := svc.CreateVideo(VideoOptions{BaseURL: srv.URL, APIKey: videoTestAPIKey, VideoModelID: "video-model", Prompt: "ocean"})
	if err != nil || created.ID != "vid_backend" {
		t.Fatalf("created=%+v err=%v", created, err)
	}
	result, err := svc.PollVideo(VideoPollOptions{BaseURL: srv.URL, APIKey: videoTestAPIKey, VideoID: created.ID})
	if err != nil || result.URL != "" || result.B64JSON != "YmFja2VuZC12aWRlbw==" || polls != 1 {
		t.Fatalf("result=%+v polls=%d err=%v", result, polls, err)
	}
}

func TestServiceVideoBindingRequiresExplicitCredentials(t *testing.T) {
	svc := NewService()
	if _, err := svc.CreateVideo(VideoOptions{Prompt: "x"}); err == nil {
		t.Fatal("expected validation error")
	}
}
