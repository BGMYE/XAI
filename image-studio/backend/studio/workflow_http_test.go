package studio

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// Exercise the durable engine and real HTTP adapter together. No external
// endpoints, real credentials, or billed generation requests are used.
func TestHTTPWorkflowImageToVideo(t *testing.T) {
	for _, protocol := range []string{"xai", "openai"} {
		t.Run(protocol, func(t *testing.T) {
			var imagePosts, videoPosts, polls, downloads atomic.Int32
			const key = "LOCAL-INTEGRATION-TEST-ONLY"
			var server *httptest.Server
			server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/media/result.mp4" {
					downloads.Add(1)
					if r.Header.Get("Authorization") != "" {
						t.Error("media download received an API credential")
					}
					w.Header().Set("Content-Type", "video/mp4")
					_, _ = w.Write(mp4())
					return
				}
				if r.Header.Get("Authorization") != "Bearer "+key {
					t.Error("API request did not use the configured credential")
				}
				w.Header().Set("Content-Type", "application/json")
				switch {
				case r.Method == "POST" && r.URL.Path == "/images/generations":
					imagePosts.Add(1)
					var body map[string]any
					if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
						t.Error(err)
					}
					if body["model"] != "test-image" || body["prompt"] != "共享场景\n\n静态构图" {
						t.Errorf("wrong image payload: %#v", body)
					}
					_ = json.NewEncoder(w).Encode(map[string]any{"data": []mediaResult{{B64: base64.StdEncoding.EncodeToString(pixel())}}})
				case r.Method == "POST" && (r.URL.Path == "/videos/generations" || r.URL.Path == "/videos"):
					videoPosts.Add(1)
					if protocol == "xai" {
						var body struct {
							Model, Prompt string
							Duration      int
							Image         struct{ URL string }
						}
						if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
							t.Error(err)
						}
						wantImage := "data:image/png;base64," + base64.StdEncoding.EncodeToString(pixel())
						if r.URL.Path != "/videos/generations" || body.Model != "test-video" || body.Prompt != "镜头向前" || body.Duration != 8 || body.Image.URL != wantImage {
							t.Errorf("wrong xAI video payload: %#v", body)
						}
						_, _ = io.WriteString(w, `{"request_id":"remote-video"}`)
					} else {
						if err := r.ParseMultipartForm(1 << 20); err != nil {
							t.Error(err)
							http.Error(w, "bad multipart", 400)
							return
						}
						defer r.MultipartForm.RemoveAll()
						file, header, err := r.FormFile("input_reference")
						if err != nil {
							t.Error(err)
							http.Error(w, "missing reference", 400)
							return
						}
						defer file.Close()
						data, err := io.ReadAll(file)
						if err != nil || !bytes.Equal(data, pixel()) || header.Header.Get("Content-Type") != "image/png" {
							t.Error("image result was not passed to the video adapter intact")
						}
						if r.URL.Path != "/videos" || r.FormValue("model") != "test-video" || r.FormValue("seconds") != "8" || r.FormValue("prompt") != "镜头向前" {
							t.Error("wrong OpenAI-compatible video fields")
						}
						_, _ = io.WriteString(w, `{"id":"remote-video"}`)
					}
				case r.Method == "GET" && r.URL.Path == "/videos/remote-video":
					polls.Add(1)
					_ = json.NewEncoder(w).Encode(upstreamResult{Status: "completed", Video: mediaResult{URL: server.URL + "/media/result.mp4"}})
				default:
					t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
					http.NotFound(w, r)
				}
			}))
			defer server.Close()
			e, err := Open(t.TempDir(), &memorySecrets{m: map[string]string{}}, Options{Workers: 2, PollInterval: time.Millisecond})
			if err != nil {
				t.Fatal(err)
			}
			defer e.Close()
			profile, err := e.SaveProfile(Profile{ID: "p", Name: "Mock", BaseURL: server.URL, Protocol: protocol, AllowLocal: true, ImageModel: "test-image", VideoModel: "test-video"}, key)
			if err != nil {
				t.Fatal(err)
			}
			project, err := e.SaveProject(Project{ID: "canvas", Name: "HTTP 工作流", Viewport: Viewport{Zoom: 1}, Nodes: []Node{
				{ID: "prompt", Kind: "prompt", Text: "共享场景"},
				{ID: "image", Kind: "image", Text: "静态构图"},
				{ID: "video", Kind: "video", Text: "镜头向前", Parameters: Parameters{Seconds: 8}},
			}, Edges: []Edge{{"e1", "prompt", "image"}, {"e2", "image", "video"}}})
			if err != nil {
				t.Fatal(err)
			}
			jobs, err := e.RunWorkflow(project.ID, profile.ID, "run")
			if err != nil || len(jobs) != 2 {
				t.Fatalf("submit workflow: jobs=%d err=%v", len(jobs), err)
			}
			image := await(t, e, "run-image", "succeeded")
			video := await(t, e, "run-video", "succeeded")
			if video.Request.ReferenceAssetID != image.ResultAssetID || video.RemoteID != "remote-video" {
				t.Fatal("dependent job lost its persisted image reference or remote ID")
			}
			// Retrying the same workflow invocation cannot create another paid POST,
			// even after generated result nodes have been appended to the canvas.
			if _, err := e.RunWorkflow(project.ID, profile.ID, "run"); err != nil {
				t.Fatal(err)
			}
			if imagePosts.Load() != 1 || videoPosts.Load() != 1 || polls.Load() != 1 || downloads.Load() != 1 {
				t.Fatalf("unexpected request counts: image=%d video=%d poll=%d media=%d", imagePosts.Load(), videoPosts.Load(), polls.Load(), downloads.Load())
			}
			snapshot, err := e.Snapshot()
			if err != nil || len(snapshot.Assets) != 2 || len(snapshot.Projects[0].Nodes) != 5 {
				t.Fatalf("results did not reach the original canvas: %v", err)
			}
			for _, asset := range snapshot.Assets {
				data, err := os.ReadFile(filepath.Join(e.repo.root, "media", asset.FileName))
				if err != nil || len(data) != int(asset.Bytes) {
					t.Fatalf("result file missing or truncated: %v", err)
				}
			}
			data, err := os.ReadFile(filepath.Join(e.repo.root, "studio.json"))
			if err != nil || strings.Contains(string(data), key) {
				t.Fatal("metadata storage failed or contained a plaintext API key")
			}
		})
	}
}

func TestHTTPVideoResumeAfterDownloadFailureDoesNotRepost(t *testing.T) {
	var creates, downloads atomic.Int32
	var available atomic.Bool
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/videos/generations":
			creates.Add(1)
			_, _ = io.WriteString(w, `{"request_id":"recoverable"}`)
		case "/videos/recoverable":
			_ = json.NewEncoder(w).Encode(upstreamResult{Status: "done", Video: mediaResult{URL: server.URL + "/media.mp4"}})
		case "/media.mp4":
			downloads.Add(1)
			if !available.Load() {
				http.Error(w, "temporary storage failure", 503)
				return
			}
			_, _ = w.Write(mp4())
		default:
			t.Errorf("unexpected request: %s", r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	e, _, _ := fixture(t, &HTTPProvider{PollInterval: time.Millisecond})
	if _, err := e.SaveProfile(Profile{ID: "upstream", Name: "Mock", BaseURL: server.URL, Protocol: "xai", AllowLocal: true, VideoModel: "test-video"}, "LOCAL-TEST-ONLY"); err != nil {
		t.Fatal(err)
	}
	r := req("resume-download")
	r.Kind = "video"
	if _, err := e.Submit(r); err != nil {
		t.Fatal(err)
	}
	paused := await(t, e, r.ID, "paused")
	if paused.RemoteID != "recoverable" || creates.Load() != 1 {
		t.Fatal("interrupted download lost the recoverable remote task")
	}
	available.Store(true)
	if err := e.Resume(r.ID); err != nil {
		t.Fatal(err)
	}
	await(t, e, r.ID, "succeeded")
	if creates.Load() != 1 || downloads.Load() != 2 {
		t.Fatalf("resume must retry only retrieval, not creation: creates=%d downloads=%d", creates.Load(), downloads.Load())
	}
}
