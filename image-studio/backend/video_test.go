package backend

import (
	"context"
	"fmt"
	"image-studio/backend/studio"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestServiceCreateAndPollVideo(t *testing.T) {
	for _, seconds := range []int{4, 5, 10} {
		t.Run(strconv.Itoa(seconds), func(t *testing.T) {
			endpoint := ""
			if seconds == 5 {
				endpoint = "/custom/videos"
			}
			var posts, polls atomic.Int32
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Authorization") != "Bearer test-key" {
					t.Error("missing saved credential")
				}
				if strings.HasSuffix(r.URL.Path, "/content") {
					_, _ = w.Write([]byte{0, 0, 0, 24, 'f', 't', 'y', 'p', 'm', 'p', '4', '2', 0, 0, 0, 0, 'm', 'p', '4', '2', 'i', 's', 'o', 'm'})
					return
				}
				w.Header().Set("Content-Type", "application/json")
				if r.Method == http.MethodPost {
					posts.Add(1)
					if err := r.ParseMultipartForm(1024 * 1024); err != nil {
						t.Error(err)
					}
					if r.FormValue("seconds") != strconv.Itoa(seconds) || r.FormValue("quality") != "high" || r.FormValue("size") != "1280x720" {
						t.Errorf("lost classic parameters: %v", r.Form)
					}
					if endpoint != "" && r.URL.Path != endpoint {
						t.Errorf("path=%s want %s", r.URL.Path, endpoint)
					}
					fmt.Fprint(w, `{"id":"vid_backend","status":"queued"}`)
					return
				}
				polls.Add(1)
				fmt.Fprint(w, `{"id":"vid_backend","status":"completed"}`)
			}))
			defer srv.Close()
			keys := &memoryAPIKeyStore{values: map[string]string{}}
			root := t.TempDir()
			e, err := studio.Open(root, studioSecrets{keys}, studio.Options{PollInterval: time.Millisecond})
			if err != nil {
				t.Fatal(err)
			}
			defer e.Close()
			if _, err = e.SaveProfile(studio.Profile{ID: "video", Name: "video", BaseURL: srv.URL, Protocol: "openai", VideoModel: "video-model", AllowLocal: true}, "test-key"); err != nil {
				t.Fatal(err)
			}
			svc := NewService()
			svc.ctx = context.Background()
			svc.studio = &StudioV2{engine: e, keys: keys}
			created, err := svc.CreateVideo(VideoOptions{ProfileID: "video", Prompt: "ocean", Seconds: seconds, Size: "1280x720", Quality: "high", EndpointPath: endpoint})
			if err != nil || created.ID == "" || created.ID == "vid_backend" {
				t.Fatalf("created=%+v err=%v", created, err)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			j, err := e.Wait(ctx, created.ID)
			if err != nil || j.State != "succeeded" {
				t.Fatalf("%+v %v", j, err)
			}
			result, err := svc.PollVideo(VideoPollOptions{VideoID: created.ID})
			if err != nil || result.Status != "completed" || !strings.HasPrefix(result.URL, "/studio-media/") || result.B64JSON != "" || posts.Load() != 1 || polls.Load() != 1 {
				t.Fatalf("%+v %v posts=%d polls=%d", result, err, posts.Load(), polls.Load())
			}
			e.Close()
			recovered, err := studio.Open(root, studioSecrets{keys}, studio.Options{})
			if err != nil {
				t.Fatal(err)
			}
			defer recovered.Close()
			svc.studio.engine = recovered
			restored, err := svc.PollVideo(VideoPollOptions{VideoID: created.ID})
			if err != nil || restored.URL != result.URL || posts.Load() != 1 {
				t.Fatalf("lost shared result: %+v %v", restored, err)
			}
		})
	}
}

func TestServiceVideoBindingRequiresSharedProfile(t *testing.T) {
	svc := NewService()
	svc.ctx = context.Background()
	svc.studio = openStudioV2(t, &memoryAPIKeyStore{values: map[string]string{}})
	if _, err := svc.CreateVideo(VideoOptions{Prompt: "x"}); err == nil {
		t.Fatal("expected validation error")
	}
	if err := svc.Cancel("unknown"); err != nil {
		t.Fatal(err)
	}
}

func TestServiceCancelVideoStopsSharedQuery(t *testing.T) {
	queryStarted := make(chan struct{})
	queryStopped := make(chan struct{})
	var polls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			fmt.Fprint(w, `{"id":"remote","status":"queued"}`)
			return
		}
		if polls.Add(1) != 1 {
			t.Error("query continued after cancellation")
			return
		}
		close(queryStarted)
		<-r.Context().Done()
		close(queryStopped)
	}))
	defer srv.Close()
	keys := &memoryAPIKeyStore{values: map[string]string{}}
	e, err := studio.Open(t.TempDir(), studioSecrets{keys}, studio.Options{PollInterval: time.Millisecond})
	if err != nil {
		t.Fatal(err)
	}
	defer e.Close()
	if _, err = e.SaveProfile(studio.Profile{ID: "video", Name: "video", BaseURL: srv.URL, Protocol: "openai", VideoModel: "video-model", AllowLocal: true}, "test-key"); err != nil {
		t.Fatal(err)
	}
	svc := NewService()
	svc.ctx = context.Background()
	svc.studio = &StudioV2{engine: e, keys: keys}
	created, err := svc.CreateVideo(VideoOptions{ProfileID: "video", Prompt: "ocean", Seconds: 4})
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-queryStarted:
	case <-time.After(3 * time.Second):
		t.Fatal("query did not start")
	}
	if err = svc.Cancel(created.ID); err != nil {
		t.Fatal(err)
	}
	select {
	case <-queryStopped:
	case <-time.After(3 * time.Second):
		t.Fatal("cancel did not abort upstream query")
	}
	e.Close()
	result, err := svc.PollVideo(VideoPollOptions{VideoID: created.ID})
	if err != nil || result.Status != "cancelled" || result.URL != "" || polls.Load() != 1 {
		t.Fatalf("result=%+v err=%v polls=%d", result, err, polls.Load())
	}
}
