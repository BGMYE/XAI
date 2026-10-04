package studio

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestVideoUsesInlineCreateResultAndRejectsModeratedOutput(t *testing.T) {
	for _, polled := range []bool{false, true} {
		for _, envelope := range []string{"video", "data"} {
			for _, asURL := range []bool{false, true} {
				for _, moderated := range []bool{false, true} {
					t.Run(fmt.Sprintf("poll=%v/%s/url=%v/moderated=%v", polled, envelope, asURL, moderated), func(t *testing.T) {
						var posts, polls, downloads atomic.Int32
						var base string
						srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							if r.URL.Path == "/result.mp4" {
								downloads.Add(1)
								w.Header().Set("Content-Type", "video/mp4")
								_, _ = w.Write(mp4())
								return
							}
							if r.Method == "POST" {
								posts.Add(1)
								if polled {
									fmt.Fprint(w, `{"id":"inline","status":"queued"}`)
									return
								}
							} else {
								polls.Add(1)
								if !polled {
									w.WriteHeader(404)
									return
								}
							}
							media := map[string]any{"respect_moderation": !moderated}
							if asURL {
								media["url"] = base + "/result.mp4"
							} else {
								media["b64_json"] = base64.StdEncoding.EncodeToString(mp4())
							}
							result := map[string]any{"id": "inline", "status": "completed", envelope: media}
							if envelope == "data" {
								result[envelope] = []any{media}
							}
							_ = json.NewEncoder(w).Encode(result)
						}))
						defer srv.Close()
						base = srv.URL
						e, p, _ := fixture(t, nil)
						e.provider.PollInterval = time.Millisecond
						p.BaseURL = base
						p.AllowLocal = true
						if _, err := e.SaveProfile(p, "test"); err != nil {
							t.Fatal(err)
						}
						r := req("inline")
						r.Kind = "video"
						if _, err := e.Submit(r); err != nil {
							t.Fatal(err)
						}
						want := "succeeded"
						if moderated {
							want = "failed"
						}
						await(t, e, r.ID, want)
						wantPolls := int32(0)
						if polled {
							wantPolls = 1
						}
						if posts.Load() != 1 || polls.Load() != wantPolls {
							t.Fatalf("requests: posts=%d polls=%d", posts.Load(), polls.Load())
						}
						wantDownloads := int32(0)
						if asURL && !moderated {
							wantDownloads = 1
						}
						if downloads.Load() != wantDownloads {
							t.Fatalf("downloads=%d want %d", downloads.Load(), wantDownloads)
						}
						snapshot, err := e.Snapshot()
						if err != nil {
							t.Fatal(err)
						}
						if moderated && len(snapshot.Assets) != 0 {
							t.Fatal("published rejected output")
						}
					})
				}
			}
		}
	}
}
