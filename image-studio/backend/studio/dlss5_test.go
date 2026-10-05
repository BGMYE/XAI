package studio

import (
	"context"
	"errors"
	"image-studio/backend/dlss5"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type fakeDLSS5 struct {
	available bool
	process   func(context.Context, dlss5.WorkRequest, func(dlss5.Progress)) (dlss5.Result, error)
	probes    atomic.Int32
}

func (f *fakeDLSS5) Probe(context.Context, dlss5.Settings) (dlss5.Capabilities, error) {
	f.probes.Add(1)
	return dlss5.Capabilities{Available: f.available, Reason: "test local runtime unavailable", SupportsFlow: []string{"off"}, EngineVersion: "test-only"}, nil
}
func (f *fakeDLSS5) Process(ctx context.Context, _ dlss5.Settings, r dlss5.WorkRequest, p func(dlss5.Progress)) (dlss5.Result, error) {
	return f.process(ctx, r, p)
}
func dlssFixture(t *testing.T, local *fakeDLSS5) (*Engine, *atomic.Int32, Request) {
	t.Helper()
	cloud := &atomic.Int32{}
	e, err := Open(t.TempDir(), &memorySecrets{m: map[string]string{}}, Options{DLSS5Runner: local, Runner: runFunc(func(context.Context, Job, string, *Output, Checkpoint) (Output, error) {
		cloud.Add(1)
		return Output{Data: mp4()}, nil
	})})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(e.Close)
	if _, err = e.SaveProfile(Profile{ID: "upstream", Name: "fake only", BaseURL: "https://example.com/v1", Protocol: "xai", VideoModel: "mock-video"}, "test-memory-only"); err != nil {
		t.Fatal(err)
	}
	if _, err = e.SaveProject(Project{ID: "project", Name: "test", Viewport: Viewport{Zoom: 1}}); err != nil {
		t.Fatal(err)
	}
	options := dlss5.DefaultOptions()
	r := req("local-video")
	r.Kind = "video"
	r.Parameters.DLSS5 = &options
	return e, cloud, r
}
func awaitDLSS5(t *testing.T, e *Engine, id, state string) Job {
	t.Helper()
	until := time.Now().Add(4 * time.Second)
	for time.Now().Before(until) {
		j, ok := e.Job(id)
		if ok && j.DLSS5 != nil && j.DLSS5.State == state {
			return j
		}
		time.Sleep(time.Millisecond * 5)
	}
	j, _ := e.Job(id)
	t.Fatalf("DLSS5 wanted %s got %+v", state, j.DLSS5)
	return Job{}
}
func writeFakeVideo(r dlss5.WorkRequest, marker byte) (dlss5.Result, error) {
	if _, err := os.Stat(r.OutputPath); !errors.Is(err, os.ErrNotExist) {
		return dlss5.Result{}, errors.New("output already exists")
	}
	if err := os.WriteFile(r.OutputPath, append(mp4(), marker), 0600); err != nil {
		return dlss5.Result{}, err
	}
	if r.SourceOutputPath != "" {
		if err := os.WriteFile(r.SourceOutputPath, mp4(), 0600); err != nil {
			return dlss5.Result{}, err
		}
	}
	return dlss5.Result{Width: 1280, Height: 720, EngineVersion: "mock"}, nil
}
func TestDLSS5FailureRetryPreservesOriginalAndNeverRegenerates(t *testing.T) {
	var calls atomic.Int32
	local := &fakeDLSS5{available: true}
	local.process = func(_ context.Context, r dlss5.WorkRequest, p func(dlss5.Progress)) (dlss5.Result, error) {
		n := calls.Add(1)
		if n != 2 {
			return dlss5.Result{}, errors.New("mock local failure")
		}
		if p != nil {
			p(dlss5.Progress{Percent: 70, Stage: "render"})
		}
		return writeFakeVideo(r, 1)
	}
	e, cloud, r := dlssFixture(t, local)
	if _, err := e.Submit(r); err != nil {
		t.Fatal(err)
	}
	failed := awaitDLSS5(t, e, r.ID, "failed")
	if failed.State != "succeeded" || failed.ResultAssetID == "" || failed.DLSS5.SourceAssetID != failed.ResultAssetID {
		t.Fatal("cloud success/original lost")
	}
	original := failed.ResultAssetID
	if _, err := e.Submit(r); err != nil {
		t.Fatal(err)
	} // same request is idempotent, no second charge
	if err := e.RetryDLSS5(r.ID); err != nil {
		t.Fatal(err)
	}
	done := awaitDLSS5(t, e, r.ID, "succeeded")
	if cloud.Load() != 1 || calls.Load() != 2 || done.ResultAssetID != original || done.DLSS5.ResultAssetID == original {
		t.Fatalf("cloud=%d process=%d job=%+v", cloud.Load(), calls.Load(), done)
	}
	path, _ := e.AssetPath(original)
	if _, err := os.Stat(path); err != nil {
		t.Fatal("original removed", err)
	}
	// Parameters belong to each local export, not to the original paid request.
	adjusted := done.DLSS5.Options
	adjusted.Intensity = .2
	deadline := time.Now().Add(time.Second)
	for {
		err := e.ApplyDLSS5(r.ID, adjusted)
		if err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal(err)
		}
		time.Sleep(time.Millisecond)
	}
	failedAgain := awaitDLSS5(t, e, r.ID, "failed")
	if failedAgain.DLSS5.ResultAssetID != done.DLSS5.ResultAssetID || failedAgain.Request.Parameters.DLSS5.Intensity != 1 || cloud.Load() != 1 {
		t.Fatal("failed re-export lost previous asset or changed paid request")
	}
	if err := e.TrashAsset(original); err == nil {
		t.Fatal("original is not reference protected")
	}
	done.DLSS5.Options.Intensity = .4
	done.Request.Parameters.DLSS5.Intensity = .5
	fresh, _ := e.Job(r.ID)
	if fresh.Request.Parameters.DLSS5.Intensity != 1 || fresh.DLSS5.Options.Intensity != .2 {
		t.Fatal("returned metadata aliases persisted parameters")
	}
}
func TestDLSS5PreflightPreventsPaidSubmission(t *testing.T) {
	for _, flow := range []string{"off", "nvofa"} {
		local := &fakeDLSS5{available: flow != "off"}
		e, cloud, r := dlssFixture(t, local)
		r.Parameters.DLSS5.FlowBackend = flow
		if _, err := e.Submit(r); err == nil {
			t.Fatal("unavailable local processing submitted")
		}
		if cloud.Load() != 0 {
			t.Fatal("preflight failure charged cloud")
		}
		snapshot, _ := e.Snapshot()
		if len(snapshot.Jobs) != 0 {
			t.Fatal("invalid request queued")
		}
	}
}
func TestDLSS5CancelMustFinishBeforeRetryAndCannotOverwrite(t *testing.T) {
	entered, release := make(chan struct{}), make(chan struct{})
	local := &fakeDLSS5{available: true}
	local.process = func(ctx context.Context, r dlss5.WorkRequest, _ func(dlss5.Progress)) (dlss5.Result, error) {
		close(entered)
		<-ctx.Done()
		<-release
		return writeFakeVideo(r, 2)
	}
	e, cloud, r := dlssFixture(t, local)
	if _, err := e.Submit(r); err != nil {
		t.Fatal(err)
	}
	<-entered
	if err := e.DeleteJob(r.ID); err == nil {
		t.Fatal("running enhancement history was deleted")
	}
	if err := e.CancelDLSS5(r.ID); err != nil {
		t.Fatal(err)
	}
	if err := e.RetryDLSS5(r.ID); err == nil {
		t.Fatal("retry raced still-exiting worker")
	}
	if err := e.DeleteJob(r.ID); err == nil {
		t.Fatal("history deletion released source while cancelled worker still exits")
	}
	close(release)
	j := awaitDLSS5(t, e, r.ID, "cancelled")
	if j.State != "succeeded" || j.DLSS5.ResultAssetID != "" || cloud.Load() != 1 {
		t.Fatal("late cancelled result attached")
	}
}
func TestDLSS5PreviewUsesLocalBinaryRangeAndCleansUp(t *testing.T) {
	local := &fakeDLSS5{available: true, process: func(_ context.Context, r dlss5.WorkRequest, _ func(dlss5.Progress)) (dlss5.Result, error) {
		return writeFakeVideo(r, 3)
	}}
	e, cloud, r := dlssFixture(t, local)
	r.Parameters.DLSS5.Enabled = false
	if _, err := e.Submit(r); err != nil {
		t.Fatal(err)
	}
	j := await(t, e, r.ID, "succeeded")
	options := dlss5.DefaultOptions()
	preview, err := e.PreviewDLSS5(context.Background(), dlss5.PreviewRequest{ID: "preview-one", SourceAssetID: j.ResultAssetID, Options: options, DurationSeconds: 2})
	if err != nil {
		t.Fatal(err)
	}
	handler := e.DLSS5PreviewHandler(http.NotFoundHandler())
	request := httptest.NewRequest("GET", preview.URL, nil)
	request.Header.Set("Range", "bytes=0-7")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != 206 || response.Body.Len() != 8 || response.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatalf("range preview %d %s", response.Code, response.Body.String())
	}
	if err = e.CancelDLSS5Preview(preview.ID); err != nil {
		t.Fatal(err)
	}
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest("GET", preview.URL, nil))
	if response.Code != 404 {
		t.Fatal("cancelled preview still exposed")
	}
	files, _ := filepath.Glob(filepath.Join(e.repo.mediaDir(), ".dlss5-preview-*"))
	if len(files) != 0 || cloud.Load() != 1 {
		t.Fatal("preview left files or regenerated video")
	}
}
func TestDLSS5SettingsPersistOutsideGeneration(t *testing.T) {
	local := &fakeDLSS5{available: true}
	e, _, _ := dlssFixture(t, local)
	settings := dlss5.Settings{PythonPath: "C:/python/python.exe", ToolRoot: "C:/dlss5"}
	if _, err := e.SaveDLSS5Settings(settings); err != nil {
		t.Fatal(err)
	}
	e.Close()
	reopened, err := Open(e.repo.root, e.secrets, Options{DLSS5Runner: local})
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	if reopened.GetDLSS5Settings() != settings {
		t.Fatal("local paths were not preserved")
	}
	if _, err = reopened.SaveDLSS5Settings(dlss5.Settings{PythonPath: "bad\x00path"}); err == nil {
		t.Fatal("NUL path accepted")
	}
	raw, _ := os.ReadFile(filepath.Join(e.repo.root, "studio.json"))
	if strings.Contains(string(raw), "test-memory-only") {
		t.Fatal("runtime settings leaked credential")
	}
}

func TestDLSS5CloseWaitsForWorkerAndRecoveryDoesNotReplayCloud(t *testing.T) {
	entered, release := make(chan struct{}), make(chan struct{})
	local := &fakeDLSS5{available: true, process: func(ctx context.Context, _ dlss5.WorkRequest, _ func(dlss5.Progress)) (dlss5.Result, error) {
		close(entered)
		<-ctx.Done()
		<-release
		return dlss5.Result{}, ctx.Err()
	}}
	e, cloud, r := dlssFixture(t, local)
	if _, err := e.Submit(r); err != nil {
		t.Fatal(err)
	}
	<-entered
	closed := make(chan struct{})
	go func() { e.Close(); close(closed) }()
	select {
	case <-closed:
		t.Fatal("Close returned while local worker was still running")
	case <-time.After(20 * time.Millisecond):
	}
	close(release)
	select {
	case <-closed:
	case <-time.After(time.Second):
		t.Fatal("Close did not cancel and join local worker")
	}
	j, _ := e.Job(r.ID)
	if j.State != "succeeded" || j.DLSS5.State != "cancelled" || cloud.Load() != 1 {
		t.Fatalf("shutdown lost original: %+v", j)
	}
	// Persist the state left by abrupt process termination, independently of a
	// graceful Close, then prove recovery never queues either paid or local work.
	d := e.cur.Load().doc
	j.DLSS5.State = "running"
	d.Jobs[j.ID] = j
	if err := e.repo.write(d); err != nil {
		t.Fatal(err)
	}
	var replay atomic.Int32
	reopened, err := Open(e.repo.root, e.secrets, Options{DLSS5Runner: local, Runner: runFunc(func(context.Context, Job, string, *Output, Checkpoint) (Output, error) {
		replay.Add(1)
		return Output{}, errors.New("must not replay paid request")
	})})
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	recovered, _ := reopened.Job(j.ID)
	if recovered.State != "succeeded" || recovered.DLSS5.State != "failed" || recovered.ResultAssetID != j.ResultAssetID || replay.Load() != 0 {
		t.Fatalf("unsafe recovery: %+v", recovered)
	}
	path, err := reopened.AssetPath(recovered.ResultAssetID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(path); err != nil {
		t.Fatal("source file missing after recovery", err)
	}
}

func TestDLSS5PreflightCacheUsesSavedSettingsAndExpires(t *testing.T) {
	local := &fakeDLSS5{available: true}
	e, _, _ := dlssFixture(t, local)
	options := dlss5.DefaultOptions()
	for range 2 {
		if err := e.preflightDLSS5(options); err != nil {
			t.Fatal(err)
		}
	}
	if local.probes.Load() != 1 {
		t.Fatal("unchanged settings repeatedly initialized GPU")
	}
	if _, err := e.SaveDLSS5Settings(dlss5.Settings{PythonPath: "C:/python.exe", ToolRoot: "C:/changed"}); err != nil {
		t.Fatal(err)
	}
	if err := e.preflightDLSS5(options); err != nil {
		t.Fatal(err)
	}
	if local.probes.Load() != 2 {
		t.Fatal("settings change reused stale capability result")
	}
	e.writeMu.Lock()
	e.dlss.cachedAt = time.Now().Add(-6 * time.Minute)
	e.writeMu.Unlock()
	if err := e.preflightDLSS5(options); err != nil {
		t.Fatal(err)
	}
	if local.probes.Load() != 3 {
		t.Fatal("expired capability result reused")
	}
	if _, err := e.ProbeDLSS5(context.Background()); err != nil {
		t.Fatal(err)
	}
	if local.probes.Load() != 4 {
		t.Fatal("explicit detection did not reprobe")
	}
}

type versionedDLSS5 struct {
	fakeDLSS5
	version       atomic.Int32
	broken        atomic.Bool
	invalidations atomic.Int32
}

func (v *versionedDLSS5) RuntimeIdentity(context.Context) (string, error) {
	if v.broken.Load() {
		return "", errors.New("test runtime integrity check failed")
	}
	return strconv.Itoa(int(v.version.Load())), nil
}
func (v *versionedDLSS5) InvalidateRuntime() { v.invalidations.Add(1) }

func TestDLSS5BundleChangeInvalidatesGPUCapabilitiesBeforePaidSubmission(t *testing.T) {
	base := &fakeDLSS5{available: true}
	e, cloud, r := dlssFixture(t, base)
	local := &versionedDLSS5{fakeDLSS5: fakeDLSS5{available: true}}
	e.dlss.runner = local
	options := dlss5.DefaultOptions()
	if err := e.preflightDLSS5(options); err != nil {
		t.Fatal(err)
	}
	if err := e.preflightDLSS5(options); err != nil {
		t.Fatal(err)
	}
	if local.probes.Load() != 1 || local.invalidations.Load() != 0 {
		t.Fatal("unchanged installation did not reuse capability verification")
	}
	local.version.Add(1)
	if err := e.preflightDLSS5(options); err != nil {
		t.Fatal(err)
	}
	if local.probes.Load() != 2 {
		t.Fatal("changed bundle reused GPU capabilities from old engine")
	}
	if _, err := e.ProbeDLSS5(context.Background()); err != nil {
		t.Fatal(err)
	}
	if local.invalidations.Load() != 1 || local.probes.Load() != 3 {
		t.Fatal("explicit detection skipped fresh file/runtime verification")
	}
	local.broken.Store(true)
	if _, err := e.Submit(r); err == nil || cloud.Load() != 0 {
		t.Fatal("corrupted bundle reused cached GPU success and submitted paid job")
	}
}
