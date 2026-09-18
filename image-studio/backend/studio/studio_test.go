package studio

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type memorySecrets struct {
	mu sync.Mutex
	m  map[string]string
}

func (s *memorySecrets) Get(id string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.m[id], nil
}
func (s *memorySecrets) Set(id, key string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.m[id] = key
	return nil
}
func (s *memorySecrets) Delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.m, id)
	return nil
}

type runFunc func(context.Context, Job, string, *Output, Checkpoint) (Output, error)

func (f runFunc) Run(c context.Context, j Job, k string, r *Output, p Checkpoint) (Output, error) {
	return f(c, j, k, r, p)
}
func pixel() []byte {
	b, _ := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5v8AAAAASUVORK5CYII=")
	return b
}
func mp4() []byte {
	return []byte{0, 0, 0, 24, 'f', 't', 'y', 'p', 'm', 'p', '4', '2', 0, 0, 0, 0, 'm', 'p', '4', '2', 'i', 's', 'o', 'm'}
}
func fixture(t *testing.T, runner Runner) (*Engine, Profile, Project) {
	t.Helper()
	e, err := Open(t.TempDir(), &memorySecrets{m: map[string]string{}}, Options{Runner: runner})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(e.Close)
	p, err := e.SaveProfile(Profile{ID: "upstream", Name: "Local test", BaseURL: "https://example.com/v1", Protocol: "xai", ImageModel: "explicit-image", VideoModel: "explicit-video"}, "TEST-SECRET-never-persist")
	if err != nil {
		t.Fatal(err)
	}
	project, err := e.SaveProject(Project{ID: "project", Name: "画布一", Viewport: Viewport{Zoom: 1}})
	if err != nil {
		t.Fatal(err)
	}
	return e, p, project
}
func req(id string) Request {
	return Request{ID: id, ProfileID: "upstream", ProjectID: "project", Kind: "image", Prompt: "测试图片", Parameters: Parameters{Seconds: 8}}
}
func await(t *testing.T, e *Engine, id, state string) Job {
	t.Helper()
	deadline := time.Now().Add(4 * time.Second)
	for time.Now().Before(deadline) {
		s, err := e.Snapshot()
		if err != nil {
			t.Fatal(err)
		}
		for _, j := range s.Jobs {
			if j.ID == id {
				if j.State == state {
					return j
				}
				if terminal(j.State) && j.State != state {
					t.Fatalf("job %s: wanted %s, got %s (%s)", id, state, j.State, j.Error)
				}
			}
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("job %s did not reach %s", id, state)
	return Job{}
}
func TestGraphValidation(t *testing.T) {
	p := Project{ID: "p", Name: "Graph", Viewport: Viewport{Zoom: 1}, Nodes: []Node{{ID: "a", Kind: "image"}, {ID: "b", Kind: "video"}}, Edges: []Edge{{"e", "a", "b"}}}
	if _, err := p.Order(); err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name  string
		alter func(*Project)
	}{
		{"cycle", func(p *Project) { p.Edges = append(p.Edges, Edge{"e2", "b", "a"}) }},
		{"dangling", func(p *Project) { p.Edges[0].To = "missing" }},
		{"duplicate edge", func(p *Project) { p.Edges = append(p.Edges, Edge{"e2", "a", "b"}) }},
		{"duplicate node", func(p *Project) { p.Nodes[1].ID = "a" }},
		{"nonfinite", func(p *Project) { p.Nodes[0].X = math.NaN() }},
		{"invalid zoom", func(p *Project) { p.Viewport.Zoom = 0 }},
		{"unknown node", func(p *Project) { p.Nodes[0].Kind = "script" }},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			b, _ := json.Marshal(p)
			var v Project
			_ = json.Unmarshal(b, &v)
			c.alter(&v)
			if _, err := v.Order(); err == nil {
				t.Fatal("invalid graph accepted")
			}
		})
	}
}
func TestAtomicRevisionAndCorruption(t *testing.T) {
	e, _, p := fixture(t, runFunc(func(context.Context, Job, string, *Output, Checkpoint) (Output, error) { return Output{}, nil }))
	old := p
	p.Name = "changed"
	saved, err := e.SaveProject(p)
	if err != nil || saved.Revision != 2 {
		t.Fatal(saved, err)
	}
	if _, err = e.SaveProject(old); !errors.Is(err, ErrConflict) {
		t.Fatalf("want conflict: %v", err)
	}
	// Failed disk write cannot publish a new in-memory revision.
	e.mu.Lock()
	root := e.repo.root
	e.repo.root = filepath.Join(root, "missing")
	e.mu.Unlock()
	saved.Name = "must not appear"
	if _, err = e.SaveProject(saved); err == nil {
		t.Fatal("write should fail")
	}
	e.mu.Lock()
	e.repo.root = root
	e.mu.Unlock()
	s, _ := e.Snapshot()
	if s.Projects[0].Name != "changed" {
		t.Fatal("uncommitted state leaked")
	}
	e.Close()
	path := filepath.Join(root, "studio.json")
	broken := []byte("{broken")
	_ = os.WriteFile(path, broken, 0600)
	if _, err = Open(root, e.secrets, Options{}); err == nil {
		t.Fatal("corrupt store accepted")
	}
	after, _ := os.ReadFile(path)
	if !bytes.Equal(after, broken) {
		t.Fatal("corrupt store overwritten")
	}
}
func TestConcurrentIdempotencyNoSecrets(t *testing.T) {
	var calls atomic.Int32
	e, _, _ := fixture(t, runFunc(func(context.Context, Job, string, *Output, Checkpoint) (Output, error) {
		calls.Add(1)
		return Output{Data: pixel()}, nil
	}))
	var wg sync.WaitGroup
	for i := 0; i < 24; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := e.Submit(req("same-request")); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	j := await(t, e, "same-request", "succeeded")
	if calls.Load() != 1 {
		t.Fatalf("%d submissions", calls.Load())
	}
	changed := req("same-request")
	changed.Prompt = "different"
	if _, err := e.Submit(changed); err == nil {
		t.Fatal("idempotency conflict accepted")
	}
	data, err := os.ReadFile(filepath.Join(e.repo.root, "studio.json"))
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(data, []byte("TEST-SECRET")) {
		t.Fatal("key leaked to disk")
	}
	snapshot, _ := e.Snapshot()
	if len(snapshot.Assets) != 1 || len(snapshot.Projects[0].Nodes) != 1 {
		t.Fatal("result not attached")
	}
	w := httptest.NewRecorder()
	r := httptest.NewRequest("GET", "/studio-media/"+j.ResultAssetID, nil)
	r.Header.Set("Range", "bytes=0-7")
	e.MediaHandler(http.NotFoundHandler()).ServeHTTP(w, r)
	if w.Code != 206 || !bytes.Equal(w.Body.Bytes(), pixel()[:8]) {
		t.Fatal("media range requests failed", w.Code)
	}
	for _, path := range []string{"/studio-media/../studio.json", "/studio-media/unknown", "/studio-media/%2e%2e%2fetc%2fpasswd"} {
		w := httptest.NewRecorder()
		e.MediaHandler(http.NotFoundHandler()).ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		if w.Code != 404 {
			t.Fatal("unsafe media path", w.Code)
		}
	}
}
func TestWorkerBoundAndCancellation(t *testing.T) {
	var active, peak atomic.Int32
	gate := make(chan struct{})
	e, _, _ := fixture(t, runFunc(func(ctx context.Context, _ Job, _ string, _ *Output, _ Checkpoint) (Output, error) {
		n := active.Add(1)
		defer active.Add(-1)
		for {
			p := peak.Load()
			if n <= p || peak.CompareAndSwap(p, n) {
				break
			}
		}
		select {
		case <-gate:
			return Output{Data: pixel()}, nil
		case <-ctx.Done():
			return Output{}, ctx.Err()
		}
	}))
	for i := 0; i < 6; i++ {
		if _, err := e.Submit(req(fmt.Sprintf("j%d", i))); err != nil {
			t.Fatal(err)
		}
	}
	await(t, e, "j0", "running")
	if err := e.Cancel("j0"); err != nil {
		t.Fatal(err)
	}
	close(gate)
	await(t, e, "j5", "succeeded")
	if peak.Load() > 2 {
		t.Fatal("worker bound exceeded")
	}
	await(t, e, "j0", "cancelled")
	s, _ := e.Snapshot()
	if len(s.Assets) != 5 {
		t.Fatalf("late cancelled output was committed: %d", len(s.Assets))
	}
}
func TestWorkflowDependencies(t *testing.T) {
	var orderMu sync.Mutex
	order := []string{}
	e, _, p := fixture(t, runFunc(func(_ context.Context, j Job, _ string, reference *Output, _ Checkpoint) (Output, error) {
		orderMu.Lock()
		order = append(order, j.Request.Kind)
		orderMu.Unlock()
		if j.Request.Kind == "video" {
			if reference == nil || !bytes.Equal(reference.Data, pixel()) {
				return Output{}, errors.New("missing dependency output")
			}
			return Output{Data: mp4()}, nil
		}
		return Output{Data: pixel()}, nil
	}))
	p.Nodes = []Node{{ID: "prompt", Kind: "prompt", Text: "a landscape"}, {ID: "image", Kind: "image", Text: "still"}, {ID: "video", Kind: "video", Text: "slow camera move", Parameters: Parameters{Seconds: 8}}}
	p.Edges = []Edge{{"e1", "prompt", "image"}, {"e2", "image", "video"}}
	if _, err := e.SaveProject(p); err != nil {
		t.Fatal(err)
	}
	jobs, err := e.RunWorkflow("project", "upstream", "run1")
	if err != nil || len(jobs) != 2 {
		t.Fatal(jobs, err)
	}
	await(t, e, "run1-video", "succeeded")
	orderMu.Lock()
	defer orderMu.Unlock()
	if strings.Join(order, ",") != "image,video" {
		t.Fatal(order)
	}
	// A repeated run ID reuses existing tasks, including the resolved reference.
	jobs, err = e.RunWorkflow("project", "upstream", "run1")
	if err != nil || len(jobs) != 2 {
		t.Fatal(err)
	}
}
func TestDependencyFailureStopsDownstream(t *testing.T) {
	var calls atomic.Int32
	e, _, p := fixture(t, runFunc(func(context.Context, Job, string, *Output, Checkpoint) (Output, error) {
		calls.Add(1)
		return Output{}, errors.New("TEST-SECRET-never-persist rejected")
	}))
	p.Nodes = []Node{{ID: "a", Kind: "image", Text: "fail"}, {ID: "b", Kind: "video", Text: "must not run", Parameters: Parameters{Seconds: 8}}}
	p.Edges = []Edge{{"edge", "a", "b"}}
	_, _ = e.SaveProject(p)
	if _, err := e.RunWorkflow("project", "upstream", "failrun"); err != nil {
		t.Fatal(err)
	}
	await(t, e, "failrun-b", "failed")
	if calls.Load() != 1 {
		t.Fatal("dependent job submitted")
	}
	data, _ := os.ReadFile(filepath.Join(e.repo.root, "studio.json"))
	if bytes.Contains(data, []byte("TEST-SECRET")) {
		t.Fatal("error leaked secret")
	}
}
func TestRecoveryDoesNotReplayPOST(t *testing.T) {
	root := t.TempDir()
	secrets := &memorySecrets{m: map[string]string{"p": "key"}}
	d := emptyDocument()
	d.Profiles["p"] = Profile{ID: "p", Name: "provider", BaseURL: "https://example.com/v1", Protocol: "xai", VideoModel: "v", HasKey: true}
	for _, id := range []string{"known", "unknown", "waiting"} {
		j := Job{ID: id, State: "running", Request: Request{ID: id, ProfileID: "p", Kind: "video"}}
		if id == "known" {
			j.RemoteID = "remote-123"
		}
		if id == "waiting" {
			j.State = "queued"
		}
		d.Jobs[id] = j
	}
	_ = os.MkdirAll(root, 0700)
	if err := (repository{root}).write(d); err != nil {
		t.Fatal(err)
	}
	var calls atomic.Int32
	e, err := Open(root, secrets, Options{Runner: runFunc(func(_ context.Context, j Job, _ string, _ *Output, _ Checkpoint) (Output, error) {
		calls.Add(1)
		if j.RemoteID != "remote-123" {
			return Output{}, errors.New("remote id lost")
		}
		return Output{Data: mp4()}, nil
	})})
	if err != nil {
		t.Fatal(err)
	}
	defer e.Close()
	s, _ := e.Snapshot()
	states := map[string]string{}
	for _, j := range s.Jobs {
		states[j.ID] = j.State
	}
	if states["known"] != "paused" || states["unknown"] != "uncertain" || states["waiting"] != "paused" {
		t.Fatal(states)
	}
	time.Sleep(20 * time.Millisecond)
	if calls.Load() != 0 {
		t.Fatal("replayed work on open")
	}
	if e.Resume("unknown") == nil {
		t.Fatal("uncertain POST was retried")
	}
	if err = e.Resume("known"); err != nil {
		t.Fatal(err)
	}
	await(t, e, "known", "succeeded")
}
func TestXAIProtocolAndUnauthenticatedMedia(t *testing.T) {
	var posts, polls atomic.Int32
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/media" {
			if r.Header.Get("Authorization") != "" {
				t.Error("bearer leaked to media")
			}
			w.Write(mp4())
			return
		}
		if r.Header.Get("Authorization") != "Bearer secret" {
			t.Error("missing auth")
		}
		switch r.URL.Path {
		case "/v1/videos/generations":
			posts.Add(1)
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			if body["model"] != "video-model" || body["duration"] != float64(8) || body["image"] == nil {
				t.Error(body)
			}
			fmt.Fprint(w, `{"request_id":"remote-job"}`)
		case "/v1/videos/remote-job":
			if polls.Add(1) == 1 {
				w.WriteHeader(429)
				return
			}
			fmt.Fprintf(w, `{"status":"done","video":{"url":%q,"respect_moderation":true}}`, server.URL+"/media")
		default:
			t.Error("unexpected path", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	j := Job{Profile: Profile{BaseURL: server.URL + "/v1", Protocol: "xai", VideoModel: "video-model", AllowLocal: true}, Request: Request{Kind: "video", Prompt: "animate", Parameters: Parameters{Seconds: 8, AspectRatio: "16:9"}}}
	checkpoints := []string{}
	out, err := (&HTTPProvider{PollInterval: time.Millisecond}).Run(context.Background(), j, "secret", &Output{Data: pixel(), MIME: "image/png"}, func(id string, _ int) error { checkpoints = append(checkpoints, id); return nil })
	if err != nil || !bytes.Equal(out.Data, mp4()) || posts.Load() != 1 || polls.Load() != 2 || len(checkpoints) < 2 {
		t.Fatal(err, posts.Load(), polls.Load(), checkpoints)
	}
	j.RemoteID = "remote-job"
	_, err = (&HTTPProvider{PollInterval: time.Millisecond}).Run(context.Background(), j, "secret", nil, func(string, int) error { return nil })
	if err != nil || posts.Load() != 1 {
		t.Fatal("resume submitted POST", err)
	}
}
func TestOpenAIMultipartAndContent(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/videos":
			if err := r.ParseMultipartForm(2 << 20); err != nil {
				t.Error(err)
			}
			if r.FormValue("seconds") != "8" || r.FormValue("model") != "explicit-video" {
				t.Error(r.Form)
			}
			f, _, err := r.FormFile("input_reference")
			if err != nil {
				t.Error(err)
			} else {
				defer f.Close()
				b, _ := io.ReadAll(f)
				if !bytes.Equal(b, pixel()) {
					t.Error("bad reference")
				}
			}
			fmt.Fprint(w, `{"id":"video-123","status":"queued"}`)
		case "/v1/videos/video-123":
			fmt.Fprint(w, `{"status":"completed","progress":100}`)
		case "/v1/videos/video-123/content":
			if r.Header.Get("Authorization") != "Bearer secret" {
				t.Error("content not authenticated")
			}
			w.Write(mp4())
		default:
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	j := Job{Profile: Profile{BaseURL: server.URL + "/v1", Protocol: "openai", VideoModel: "explicit-video", AllowLocal: true}, Request: Request{Kind: "video", Prompt: "animate", Parameters: Parameters{Seconds: 8, Size: "1280x720"}}}
	out, err := (&HTTPProvider{PollInterval: time.Millisecond}).Run(context.Background(), j, "secret", &Output{Data: pixel(), MIME: "image/png"}, func(string, int) error { return nil })
	if err != nil || !bytes.Equal(out.Data, mp4()) {
		t.Fatal(err)
	}
}
func TestAmbiguousCreationIsNotRetried(t *testing.T) {
	for _, status := range []int{200, 500} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			var calls atomic.Int32
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				w.WriteHeader(status)
				fmt.Fprint(w, "invalid JSON with secret")
			}))
			defer s.Close()
			j := Job{Profile: Profile{BaseURL: s.URL, Protocol: "xai", VideoModel: "v", AllowLocal: true}, Request: Request{Kind: "video"}}
			_, err := (&HTTPProvider{}).Run(context.Background(), j, "secret", nil, func(string, int) error { return nil })
			var uncertain *UncertainError
			if !errors.As(err, &uncertain) || calls.Load() != 1 || strings.Contains(err.Error(), "secret") {
				t.Fatal(err, calls.Load())
			}
		})
	}
}
func TestNetworkAndMediaGuards(t *testing.T) {
	for _, ip := range []string{"127.0.0.1", "10.0.0.1", "192.168.0.1", "169.254.169.254", "::1", "fc00::1", "::ffff:127.0.0.1"} {
		if allowedIP(net.ParseIP(ip), false) {
			t.Fatal("unsafe IP allowed", ip)
		}
	}
	if !allowedIP(net.ParseIP("127.0.0.1"), true) || allowedIP(net.ParseIP("169.254.169.254"), true) {
		t.Fatal("local option is not loopback-only")
	}
	for _, raw := range []string{"file:///etc/passwd", "http://example.com/video", "https://user:password@example.com/video"} {
		c := secureClient(false)
		_, err := fetchMedia(context.Background(), c, Profile{}, raw, 0)
		closeClient(c)
		if err == nil {
			t.Fatal("unsafe media URL accepted")
		}
	}
	e, _, _ := fixture(t, nil)
	if _, err := e.Import([]byte("<svg><script>alert(1)</script></svg>"), "bad.svg"); err == nil {
		t.Fatal("active content accepted")
	}
	p := Profile{ID: "p", Name: "name", BaseURL: "https://host/v1?key=SECRET", Protocol: "xai"}
	if p.Validate() == nil {
		t.Fatal("key in URL accepted")
	}
}

func TestDefaultDurationAndTemplateReferenceValidation(t *testing.T) {
	for _, protocol := range []string{"xai", "openai"} {
		p := Profile{ID: "upstream", Protocol: protocol, VideoModel: "video", HasKey: true}
		r := Request{ID: "request", ProjectID: "project", ProfileID: "upstream", Kind: "video", Prompt: "test"}
		if err := r.Validate(p); err != nil {
			t.Fatal(err)
		}
		_, contentType, reader, err := buildPayload(Job{Request: r, Profile: p}, nil)
		if err != nil {
			t.Fatal(err)
		}
		b, _ := io.ReadAll(reader)
		if protocol == "xai" && bytes.Contains(b, []byte("duration")) {
			t.Fatal("default duration must be omitted")
		}
		if protocol == "openai" && strings.Contains(string(b), "name=\"seconds\"") {
			t.Fatalf("default seconds must be omitted: %s", contentType)
		}
	}
}

func TestMissingTemplateAssetRejectsWholeRun(t *testing.T) {
	var calls atomic.Int32
	e, _, p := fixture(t, runFunc(func(context.Context, Job, string, *Output, Checkpoint) (Output, error) {
		calls.Add(1)
		return Output{Data: pixel()}, nil
	}))
	p.Nodes = []Node{{ID: "image", Kind: "image", Text: "test"}, {ID: "ref", Kind: "asset"}}
	p.Edges = []Edge{{"edge", "ref", "image"}}
	if _, err := e.SaveProject(p); err != nil {
		t.Fatal(err)
	}
	if _, err := e.RunWorkflow(p.ID, "upstream", "missing"); err == nil {
		t.Fatal("unbound asset accepted")
	}
	s, _ := e.Snapshot()
	if len(s.Jobs) != 0 || calls.Load() != 0 {
		t.Fatal("invalid graph submitted paid requests")
	}
}
func TestCredentialRotationIsTransactional(t *testing.T) {
	e, p, _ := fixture(t, nil)
	oldSlot := p.CredentialID
	if oldSlot == "" {
		t.Fatal("expected opaque credential slot")
	}
	e.mu.Lock()
	root := e.repo.root
	e.repo.root = filepath.Join(root, "missing")
	e.mu.Unlock()
	p.BaseURL = "https://different.example/v1"
	if _, err := e.SaveProfile(p, "NEW-SECRET"); err == nil {
		t.Fatal("disk failure was ignored")
	}
	e.mu.Lock()
	e.repo.root = root
	e.mu.Unlock()
	snapshot, _ := e.Snapshot()
	if snapshot.Profiles[0].CredentialID != oldSlot {
		t.Fatal("uncommitted key reference published")
	}
	key, _ := e.secrets.Get(oldSlot)
	if key != "TEST-SECRET-never-persist" {
		t.Fatal("existing endpoint now points at wrong key")
	}
}
