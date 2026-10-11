package studio

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// imageServer returns an image generation endpoint whose result is a link that
// fails with failStatus until healthy is set.
func imageServer(t *testing.T, failStatus int, healthy *atomic.Bool, posts, downloads *atomic.Int32) *httptest.Server {
	t.Helper()
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/images/generations", "/v1/images/edits":
			posts.Add(1)
			fmt.Fprintf(w, `{"data":[{"url":%q}]}`, server.URL+"/result.png")
		case "/result.png":
			downloads.Add(1)
			if r.Header.Get("Authorization") != "" {
				t.Error("credential sent to result link")
			}
			if !healthy.Load() {
				http.Error(w, "storage hiccup", failStatus)
				return
			}
			_, _ = w.Write(pixel())
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)
	return server
}

func httpFixture(t *testing.T, baseURL string) (*Engine, Request) {
	t.Helper()
	e, err := Open(t.TempDir(), &memorySecrets{m: map[string]string{}}, Options{PollInterval: time.Millisecond})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(e.Close)
	if _, err = e.SaveProfile(Profile{ID: "upstream", Name: "Mock", BaseURL: baseURL + "/v1", Protocol: "openai", AllowLocal: true, ImageModel: "img"}, "LOCAL-TEST-ONLY"); err != nil {
		t.Fatal(err)
	}
	if _, err = e.SaveProject(Project{ID: "project", Name: "画布", Viewport: Viewport{Zoom: 1}}); err != nil {
		t.Fatal(err)
	}
	return e, Request{ID: NewID(), ProfileID: "upstream", ProjectID: "project", Kind: "image", Prompt: "cat"}
}

func TestImageDownloadFailureResumesWithoutRegenerating(t *testing.T) {
	var healthy atomic.Bool
	var posts, downloads atomic.Int32
	server := imageServer(t, http.StatusBadGateway, &healthy, &posts, &downloads)
	e, r := httpFixture(t, server.URL)
	if _, err := e.Submit(r); err != nil {
		t.Fatal(err)
	}
	paused := await(t, e, r.ID, "paused")
	if paused.ResultURL != server.URL+"/result.png" || posts.Load() != 1 {
		t.Fatalf("result link not kept for recovery: %+v posts=%d", paused, posts.Load())
	}
	healthy.Store(true)
	if err := e.Resume(r.ID); err != nil {
		t.Fatal(err)
	}
	done := await(t, e, r.ID, "succeeded")
	if posts.Load() != 1 || downloads.Load() != 2 || done.ResultAssetID == "" {
		t.Fatalf("resume must only download again: posts=%d downloads=%d", posts.Load(), downloads.Load())
	}
}

// failingSecrets is a keychain a test can make unreadable.
type failingSecrets struct {
	memorySecrets
	broken atomic.Bool
}

func (s *failingSecrets) Get(id string) (string, error) {
	if s.broken.Load() {
		return "", errors.New("keychain locked")
	}
	return s.memorySecrets.Get(id)
}

// Downloading a saved result link needs neither the key nor the reference
// image, so neither being unavailable can cost an already paid result.
func TestSavedResultLinksNeedNeitherKeyNorReference(t *testing.T) {
	var healthy atomic.Bool
	var posts, downloads atomic.Int32
	server := imageServer(t, http.StatusBadGateway, &healthy, &posts, &downloads)
	secrets := &failingSecrets{memorySecrets: memorySecrets{m: map[string]string{}}}
	e, err := Open(t.TempDir(), secrets, Options{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(e.Close)
	if _, err = e.SaveProfile(Profile{ID: "upstream", Name: "Mock", BaseURL: server.URL + "/v1", Protocol: "openai", AllowLocal: true, ImageModel: "img"}, "LOCAL-TEST-ONLY"); err != nil {
		t.Fatal(err)
	}
	if _, err = e.SaveProject(Project{ID: "project", Name: "画布", Viewport: Viewport{Zoom: 1}}); err != nil {
		t.Fatal(err)
	}
	ref, err := e.Import(pixel(), "reference.png")
	if err != nil {
		t.Fatal(err)
	}
	r := Request{ID: NewID(), ProfileID: "upstream", ProjectID: "project", Kind: "image", Prompt: "cat", ReferenceAssetID: ref.ID}
	if _, err = e.Submit(r); err != nil {
		t.Fatal(err)
	}
	await(t, e, r.ID, "paused")
	secrets.broken.Store(true)
	if err = os.Remove(filepath.Join(e.repo.mediaDir(), ref.FileName)); err != nil {
		t.Fatal(err)
	}
	healthy.Store(true)
	if err = e.Resume(r.ID); err != nil {
		t.Fatal(err)
	}
	await(t, e, r.ID, "succeeded")
	if posts.Load() != 1 || downloads.Load() != 2 {
		t.Fatalf("posts=%d downloads=%d", posts.Load(), downloads.Load())
	}
}

// A submitted job keeps its remote handle when a local step fails on resume:
// it pauses again instead of failing, and resumes once the cause is gone.
func TestSubmittedJobsSurviveLocalFailuresOnResume(t *testing.T) {
	secrets := &failingSecrets{memorySecrets: memorySecrets{m: map[string]string{}}}
	var runs atomic.Int32
	runner := runFunc(func(_ context.Context, j Job, key string, _ *Output, checkpoint Checkpoint) (Output, error) {
		if runs.Add(1) == 1 {
			if err := checkpoint(Progress{RemoteID: "remote-1"}); err != nil {
				return Output{}, err
			}
			return Output{}, &ResumeError{}
		}
		if j.RemoteID != "remote-1" || key != "KEY" {
			t.Errorf("resumed with remote %q and key %q", j.RemoteID, key)
		}
		return Output{Data: mp4()}, nil
	})
	e, err := Open(t.TempDir(), secrets, Options{Runner: runner})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(e.Close)
	if _, err = e.SaveProfile(Profile{ID: "upstream", Name: "Video", BaseURL: "https://example.com/v1", Protocol: "xai", VideoModel: "video"}, "KEY"); err != nil {
		t.Fatal(err)
	}
	if _, err = e.SaveProject(Project{ID: "project", Name: "画布", Viewport: Viewport{Zoom: 1}}); err != nil {
		t.Fatal(err)
	}
	r := Request{ID: NewID(), ProfileID: "upstream", ProjectID: "project", Kind: "video", Prompt: "waves"}
	if _, err = e.Submit(r); err != nil {
		t.Fatal(err)
	}
	await(t, e, r.ID, "paused")
	secrets.broken.Store(true)
	if err = e.Resume(r.ID); err != nil {
		t.Fatal(err)
	}
	// The runner is not reached; wait for the job to settle again.
	deadline := time.Now().Add(4 * time.Second)
	var j Job
	for time.Now().Before(deadline) {
		j = e.cur.Load().doc.Jobs[r.ID]
		if j.State != "queued" && j.State != "running" {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	if j.State != "paused" || j.RemoteID != "remote-1" || !strings.Contains(j.Error, "不重新提交") {
		t.Fatalf("local failure after submission: %s %q (%q)", j.State, j.RemoteID, j.Error)
	}
	secrets.broken.Store(false)
	if err = e.Resume(r.ID); err != nil {
		t.Fatal(err)
	}
	await(t, e, r.ID, "succeeded")
	if runs.Load() != 2 {
		t.Fatalf("runner calls = %d", runs.Load())
	}
}

func TestExpiredImageLinkFailsInsteadOfLoopingResume(t *testing.T) {
	var healthy atomic.Bool
	var posts, downloads atomic.Int32
	server := imageServer(t, http.StatusNotFound, &healthy, &posts, &downloads)
	e, r := httpFixture(t, server.URL)
	if _, err := e.Submit(r); err != nil {
		t.Fatal(err)
	}
	j := await(t, e, r.ID, "failed")
	if !strings.Contains(j.Error, "结果链接已失效") || posts.Load() != 1 {
		t.Fatalf("unexpected failure: %q posts=%d", j.Error, posts.Load())
	}
}

func TestRequestThatNeverLeftIsAPlainFailure(t *testing.T) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := l.Addr().String()
	l.Close()
	e, r := httpFixture(t, "http://"+addr)
	if _, err := e.Submit(r); err != nil {
		t.Fatal(err)
	}
	j := await(t, e, r.ID, "failed")
	if !strings.HasPrefix(j.Error, "请求未发出") {
		t.Fatalf("connection refusal must not be reported as possibly billed: %q", j.Error)
	}
}

func TestReadsNeverWaitForTheWriteLock(t *testing.T) {
	e, _, _ := fixture(t, nil)
	a, err := e.Import(pixel(), "ref.png")
	if err != nil {
		t.Fatal(err)
	}
	e.writeMu.Lock() // simulate a slow durable write in progress
	defer e.writeMu.Unlock()
	done := make(chan struct{})
	go func() {
		defer close(done)
		if _, err := e.Snapshot(); err != nil {
			t.Error(err)
		}
		if _, err := e.Changes("", 0); err != nil {
			t.Error(err)
		}
		w := httptest.NewRecorder()
		e.MediaHandler(http.NotFoundHandler()).ServeHTTP(w, httptest.NewRequest("GET", "/studio-media/"+a.ID, nil))
		if w.Code != 200 || !bytes.Equal(w.Body.Bytes(), pixel()) {
			t.Error("media lookup failed", w.Code)
		}
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("a read blocked on the write lock")
	}
}

func TestChangesReturnOnlyWhatChanged(t *testing.T) {
	e, _, p := fixture(t, nil)
	full, err := e.Changes("", 0)
	if err != nil || !full.Full || len(full.Projects) != 1 || len(full.Profiles) != 1 {
		t.Fatalf("first call must be full: %+v %v", full, err)
	}
	same, _ := e.Changes(full.Epoch, full.Revision)
	if same.Full || len(same.Projects)+len(same.Profiles)+len(same.Jobs) != 0 {
		t.Fatalf("unchanged state returned data: %+v", same)
	}
	p.Name = "改名"
	if _, err = e.SaveProject(p); err != nil {
		t.Fatal(err)
	}
	card, err := e.SavePromptCard(samplePrompt())
	if err != nil {
		t.Fatal(err)
	}
	delta, _ := e.Changes(full.Epoch, full.Revision)
	if delta.Full || len(delta.Projects) != 1 || delta.Projects[0].Name != "改名" || len(delta.PromptCards) != 1 || len(delta.Profiles) != 0 {
		t.Fatalf("delta must contain exactly the edited project and new card: %+v", delta)
	}
	if err = e.DeletePromptCard(card.ID, card.Revision); err != nil {
		t.Fatal(err)
	}
	removed, _ := e.Changes(delta.Epoch, delta.Revision)
	if len(removed.Removed.PromptCards) != 1 || removed.Removed.PromptCards[0] != card.ID || len(removed.PromptCards) != 0 {
		t.Fatalf("deletion missing from delta: %+v", removed)
	}
	other, _ := e.Changes("another-epoch", removed.Revision)
	if !other.Full {
		t.Fatal("a client from a previous run must get a full snapshot")
	}
	delta.Projects[0].Nodes = append(delta.Projects[0].Nodes, Node{ID: "x", Kind: "note"})
	if s, _ := e.Snapshot(); len(s.Projects[0].Nodes) != 0 {
		t.Fatal("delta aliased the database")
	}
}

func TestProgressStaysInMemoryAndIsReported(t *testing.T) {
	gate := make(chan struct{})
	var reported atomic.Int32
	e, err := Open(t.TempDir(), &memorySecrets{m: map[string]string{}}, Options{
		OnProgress: func(string, int) { reported.Add(1) },
		Runner: runFunc(func(ctx context.Context, _ Job, _ string, _ *Output, cp Checkpoint) (Output, error) {
			if err := cp(Progress{RemoteID: "remote"}); err != nil {
				return Output{}, err
			}
			for i := 1; i <= 5; i++ {
				if err := cp(Progress{RemoteID: "remote", Percent: i * 10}); err != nil {
					return Output{}, err
				}
			}
			<-gate
			return Output{Data: mp4()}, nil
		}),
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(e.Close)
	if _, err = e.SaveProfile(Profile{ID: "upstream", Name: "p", BaseURL: "https://example.com/v1", Protocol: "xai", VideoModel: "v"}, "k"); err != nil {
		t.Fatal(err)
	}
	if _, err = e.SaveProject(Project{ID: "project", Name: "c", Viewport: Viewport{Zoom: 1}}); err != nil {
		t.Fatal(err)
	}
	r := req("video")
	r.Kind = "video"
	if _, err = e.Submit(r); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(4 * time.Second)
	var cs ChangeSet
	for time.Now().Before(deadline) {
		cs, _ = e.Changes("", 0)
		if cs.Progress[r.ID] == 50 {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	if cs.Progress[r.ID] != 50 || reported.Load() < 5 {
		t.Fatalf("progress not reported: %v (%d callbacks)", cs.Progress, reported.Load())
	}
	data, _ := os.ReadFile(filepath.Join(e.repo.root, "studio.json"))
	if !bytes.Contains(data, []byte(`"remoteId":"remote"`)) || bytes.Contains(data, []byte(`"progress":50`)) {
		t.Fatal("remote ID must be durable while volatile progress is not written")
	}
	close(gate)
	if j := await(t, e, r.ID, "succeeded"); j.Progress != 100 {
		t.Fatal("final progress not recorded")
	}
}

func TestPollingDoesNotHoldASubmissionSlot(t *testing.T) {
	gate := make(chan struct{})
	defer close(gate)
	e, err := Open(t.TempDir(), &memorySecrets{m: map[string]string{}}, Options{Workers: 1,
		Runner: runFunc(func(ctx context.Context, j Job, _ string, _ *Output, cp Checkpoint) (Output, error) {
			if j.Request.Kind == "image" {
				return Output{Data: pixel()}, nil
			}
			if err := cp(Progress{RemoteID: "long-video"}); err != nil {
				return Output{}, err
			}
			select { // a long upstream render being polled
			case <-gate:
			case <-ctx.Done():
				return Output{}, ctx.Err()
			}
			return Output{Data: mp4()}, nil
		}),
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(e.Close)
	if _, err = e.SaveProfile(Profile{ID: "upstream", Name: "p", BaseURL: "https://example.com/v1", Protocol: "xai", ImageModel: "i", VideoModel: "v"}, "k"); err != nil {
		t.Fatal(err)
	}
	if _, err = e.SaveProject(Project{ID: "project", Name: "c", Viewport: Viewport{Zoom: 1}}); err != nil {
		t.Fatal(err)
	}
	video := req("video")
	video.Kind = "video"
	if _, err = e.Submit(video); err != nil {
		t.Fatal(err)
	}
	await(t, e, "video", "running")
	if _, err = e.Submit(req("image")); err != nil {
		t.Fatal(err)
	}
	await(t, e, "image", "succeeded")
}

func TestChangeNotificationsAreDelivered(t *testing.T) {
	got := make(chan uint64, 16)
	e, err := Open(t.TempDir(), &memorySecrets{m: map[string]string{}}, Options{OnChange: func(rev uint64) { got <- rev }})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(e.Close)
	if _, err = e.SaveProject(Project{ID: "project", Name: "c", Viewport: Viewport{Zoom: 1}}); err != nil {
		t.Fatal(err)
	}
	select {
	case rev := <-got:
		if rev < 2 {
			t.Fatal("revision did not advance", rev)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("no change notification")
	}
}

func TestDecodedResultsAreStreamedToDisk(t *testing.T) {
	dir := t.TempDir()
	p := &HTTPProvider{MediaDir: dir}
	out, err := p.decodeBase64(base64.StdEncoding.EncodeToString(pixel()))
	if err != nil || out.Path == "" || out.Data != nil {
		t.Fatalf("expected a temporary file: %+v %v", out, err)
	}
	data, err := os.ReadFile(out.Path)
	if err != nil || !bytes.Equal(data, pixel()) || filepath.Dir(out.Path) != dir {
		t.Fatal("temporary result is not the decoded image in the media directory")
	}
}
