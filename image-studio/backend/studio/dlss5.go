package studio

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"image-studio/backend/dlss5"
)

type DLSS5Job struct {
	State          string        `json:"state"`
	Progress       int           `json:"progress"`
	Stage          string        `json:"stage,omitempty"`
	Error          string        `json:"error,omitempty"`
	SourceAssetID  string        `json:"sourceAssetId,omitempty"`
	ResultAssetID  string        `json:"resultAssetId,omitempty"`
	ResultAssetIDs []string      `json:"resultAssetIds,omitempty"`
	Options        dlss5.Options `json:"options"`
	EngineVersion  string        `json:"engineVersion,omitempty"`
}
type dlss5Preview struct {
	sourceAssetID string
	cancel        context.CancelFunc
	directory     string
	result        dlss5.PreviewResult
	expires       time.Time
	ready         bool
}
type dlss5Runtime struct {
	runner             dlss5.Runner
	slot               chan struct{}
	wake               chan struct{}
	runs               map[string]context.CancelFunc // writeMu
	previews           map[string]*dlss5Preview      // writeMu
	cachedSettings     dlss5.Settings
	cachedIdentity     string
	cachedCapabilities dlss5.Capabilities
	cachedAt           time.Time
}

func (e *Engine) GetDLSS5Settings() dlss5.Settings { return e.cur.Load().doc.DLSS5Settings }
func (e *Engine) SaveDLSS5Settings(s dlss5.Settings) (dlss5.Settings, error) {
	if err := s.Validate(); err != nil {
		return dlss5.Settings{}, err
	}
	err := e.update(func(t *tx) error {
		t.doc.DLSS5Settings = s
		t.touch(colSettings, "dlss5", false)
		e.dlss.cachedAt = time.Time{}
		return nil
	})
	return s, err
}
func (e *Engine) ProbeDLSS5(ctx context.Context) (dlss5.Capabilities, error) {
	return e.probeDLSS5(ctx, true)
}
func (e *Engine) probeDLSS5(ctx context.Context, fresh bool) (dlss5.Capabilities, error) {
	e.writeMu.Lock()
	if err := e.ready(); err != nil {
		e.writeMu.Unlock()
		return dlss5.Capabilities{}, err
	}
	e.wg.Add(1)
	e.writeMu.Unlock()
	defer e.wg.Done()
	ctx, cancel := context.WithTimeout(ctx, 180*time.Second)
	defer cancel()
	stop := context.AfterFunc(e.ctx, cancel)
	defer stop()
	select {
	case e.dlss.slot <- struct{}{}:
	case <-ctx.Done():
		return dlss5.Capabilities{}, ctx.Err()
	}
	defer func() { <-e.dlss.slot }()
	if fresh {
		if runtime, ok := e.dlss.runner.(interface{ InvalidateRuntime() }); ok {
			runtime.InvalidateRuntime()
		}
	}
	settings := e.GetDLSS5Settings()
	identity, identityErr := e.dlss5RuntimeIdentity(ctx)
	c, err := e.dlss.runner.Probe(ctx, settings)
	if err != nil {
		return dlss5.Capabilities{Status: "error", Available: false, Reason: err.Error()}, nil
	}
	if c.Status == "" {
		c.Status = "error"
		if c.Available {
			c.Status = "ready"
		}
	}
	latestIdentity, latestErr := e.dlss5RuntimeIdentity(ctx)
	e.writeMu.Lock()
	if identityErr == nil && latestErr == nil && identity == latestIdentity && e.GetDLSS5Settings() == settings {
		e.dlss.cachedSettings = settings
		e.dlss.cachedIdentity = identity
		e.dlss.cachedCapabilities = c
		e.dlss.cachedCapabilities.SupportsFlow = slices.Clone(c.SupportsFlow)
		e.dlss.cachedAt = time.Now()
	}
	e.writeMu.Unlock()
	return c, nil
}
func (e *Engine) dlss5RuntimeIdentity(ctx context.Context) (string, error) {
	if runtime, ok := e.dlss.runner.(interface {
		RuntimeIdentity(context.Context) (string, error)
	}); ok {
		return runtime.RuntimeIdentity(ctx)
	}
	return "", nil
}
func (e *Engine) preflightDLSS5(options dlss5.Options) error {
	if !options.Enabled {
		return nil
	}
	if err := options.Validate(); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(e.ctx, 180*time.Second)
	defer cancel()
	identity, err := e.dlss5RuntimeIdentity(ctx)
	if err != nil {
		return fmt.Errorf("DLSS5 本地处理预检失败，尚未提交视频生成：%w", err)
	}
	e.writeMu.Lock()
	c, valid := e.dlss.cachedCapabilities, e.dlss.cachedIdentity == identity && e.dlss.cachedSettings == e.GetDLSS5Settings() && time.Since(e.dlss.cachedAt) < 5*time.Minute
	e.writeMu.Unlock()
	if !valid {
		var err error
		c, err = e.probeDLSS5(e.ctx, false)
		if err != nil {
			return err
		}
	}
	if err := c.Check(options); err != nil {
		return fmt.Errorf("DLSS5 本地处理预检失败，尚未提交视频生成：%w", err)
	}
	return nil
}
func (e *Engine) preflightGeneration(r Request) error {
	if r.Parameters.DLSS5 == nil || !r.Parameters.DLSS5.Enabled {
		return nil
	}
	if r.Kind != "video" {
		return errors.New("DLSS5 仅支持视频任务")
	}
	if old, ok := e.Job(r.ID); ok && old.Fingerprint == fingerprint(r, nil) {
		return nil
	}
	return e.preflightDLSS5(*r.Parameters.DLSS5)
}
func (e *Engine) wakeDLSS5() {
	if e.dlss != nil {
		select {
		case e.dlss.wake <- struct{}{}:
		default:
		}
	}
}
func activeDLSS5(j Job) bool {
	return j.DLSS5 != nil && (j.DLSS5.State == "queued" || j.DLSS5.State == "running")
}
func cloneDLSS5(s *DLSS5Job) *DLSS5Job {
	if s == nil {
		return nil
	}
	c := *s
	c.ResultAssetIDs = slices.Clone(c.ResultAssetIDs)
	return &c
}
func (e *Engine) RetryDLSS5(id string) error {
	j, ok := e.Job(id)
	if !ok || j.DLSS5 == nil {
		return errors.New("本地增强任务不存在")
	}
	return e.ApplyDLSS5(id, j.DLSS5.Options)
}
func (e *Engine) ApplyDLSS5(id string, options dlss5.Options) error {
	if !options.Enabled {
		return errors.New("请先启用 DLSS5 本地处理")
	}
	if err := options.Validate(); err != nil {
		return err
	}
	before, ok := e.Job(id)
	if !ok || before.Request.Kind != "video" || before.State != "succeeded" {
		return errors.New("请等待原始视频生成完成")
	}
	if activeDLSS5(before) {
		return errors.New("该视频已有本地增强任务，请先等待或取消")
	}
	if err := e.preflightDLSS5(options); err != nil {
		return err
	}
	return e.update(func(t *tx) error {
		j, ok := t.doc.Jobs[id]
		if !ok || j.State != "succeeded" || j.Request.Kind != "video" {
			return errors.New("原始视频任务不存在或尚未完成")
		}
		if activeDLSS5(j) {
			return errors.New("该视频已有本地增强任务")
		}
		if e.dlss.runs[id] != nil {
			return errors.New("上一次本地处理正在退出，请稍后再试")
		}
		state := cloneDLSS5(j.DLSS5)
		if state == nil {
			state = &DLSS5Job{SourceAssetID: j.ResultAssetID}
		}
		if state.SourceAssetID == "" {
			state.SourceAssetID = j.ResultAssetID
		}
		a, ok := t.doc.Assets[state.SourceAssetID]
		if !ok || a.Kind != "video" || a.DeletedAt != "" {
			return errors.New("原始视频素材不可用")
		}
		state.Options = options
		state.State = "queued"
		state.Progress = 0
		state.Error = ""
		state.Stage = "queued"
		j.DLSS5 = state
		j.UpdatedAt = now()
		t.putJob(j)
		return nil
	})
}
func (e *Engine) CancelDLSS5(id string) error {
	e.writeMu.Lock()
	defer e.writeMu.Unlock()
	if err := e.ready(); err != nil {
		return err
	}
	_, err := e.updateLocked(func(t *tx) error {
		j, ok := t.doc.Jobs[id]
		if !ok || j.DLSS5 == nil {
			return errors.New("本地增强任务不存在")
		}
		if !activeDLSS5(j) {
			return nil
		}
		j.DLSS5 = cloneDLSS5(j.DLSS5)
		j.DLSS5.State = "cancelled"
		j.DLSS5.Error = "已取消本地增强；原始视频保留"
		j.UpdatedAt = now()
		t.putJob(j)
		return nil
	})
	if err == nil {
		if cancel := e.dlss.runs[id]; cancel != nil {
			cancel()
		}
	}
	return err
}
func (e *Engine) dispatchDLSS5() {
	defer e.wg.Done()
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		if e.ctx.Err() != nil {
			return
		}
		var next string
		e.writeMu.Lock()
		if e.ready() == nil {
			for id, j := range e.cur.Load().doc.Jobs {
				if j.DLSS5 != nil && j.DLSS5.State == "queued" {
					if next == "" || j.CreatedAt < e.cur.Load().doc.Jobs[next].CreatedAt {
						next = id
					}
				}
			}
		}
		e.writeMu.Unlock()
		if next != "" {
			e.executeDLSS5(next)
			continue
		}
		select {
		case <-e.ctx.Done():
			return
		case <-e.dlss.wake:
		case <-ticker.C:
			e.expireDLSS5Previews()
		}
	}
}
func (e *Engine) executeDLSS5(id string) {
	ctx, cancel := context.WithCancel(e.ctx)
	defer cancel()
	e.writeMu.Lock()
	current, ok := e.cur.Load().doc.Jobs[id]
	if !ok || current.DLSS5 == nil || current.DLSS5.State != "queued" {
		e.writeMu.Unlock()
		return
	}
	e.dlss.runs[id] = cancel
	e.writeMu.Unlock()
	defer func() { e.writeMu.Lock(); delete(e.dlss.runs, id); e.writeMu.Unlock() }()
	select {
	case e.dlss.slot <- struct{}{}:
	case <-ctx.Done():
		e.finishDLSS5(id, Output{}, dlss5.Result{}, ctx.Err())
		return
	}
	defer func() { <-e.dlss.slot }()
	var job Job
	err := e.update(func(t *tx) error {
		j, ok := t.doc.Jobs[id]
		if !ok || j.DLSS5 == nil || j.DLSS5.State != "queued" {
			return context.Canceled
		}
		j.DLSS5 = cloneDLSS5(j.DLSS5)
		j.DLSS5.State = "running"
		j.DLSS5.Stage = "process"
		j.UpdatedAt = now()
		t.putJob(j)
		job = j
		return nil
	})
	if err != nil {
		return
	}
	source, err := e.AssetPath(job.DLSS5.SourceAssetID)
	if err != nil {
		e.finishDLSS5(id, Output{}, dlss5.Result{}, err)
		return
	}
	dir, err := os.MkdirTemp(e.repo.mediaDir(), ".dlss5-export-")
	if err != nil {
		e.finishDLSS5(id, Output{}, dlss5.Result{}, err)
		return
	}
	defer os.RemoveAll(dir)
	path := filepath.Join(dir, "enhanced.mp4")
	lastProgress := -1
	lastAt := time.Time{}
	result, runErr := e.dlss.runner.Process(ctx, e.GetDLSS5Settings(), dlss5.WorkRequest{ID: id, Operation: "export", InputPath: source, OutputPath: path, Options: job.DLSS5.Options, Resolution: job.DLSS5.Options.ExportResolution}, func(p dlss5.Progress) {
		percent := max(0, min(99, p.Percent))
		if percent == lastProgress || time.Since(lastAt) < 300*time.Millisecond {
			return
		}
		lastProgress = percent
		lastAt = time.Now()
		_ = e.update(func(t *tx) error {
			j, ok := t.doc.Jobs[id]
			if !ok || j.DLSS5 == nil || j.DLSS5.State != "running" {
				return nil
			}
			j.DLSS5 = cloneDLSS5(j.DLSS5)
			j.DLSS5.Progress = percent
			j.DLSS5.Stage = p.Stage
			t.putJob(j)
			return nil
		})
	})
	out := Output{}
	if runErr == nil {
		out = Output{Path: path, Width: result.Width, Height: result.Height}
	}
	e.finishDLSS5(id, out, result, runErr)
}
func (e *Engine) finishDLSS5(id string, out Output, result dlss5.Result, runErr error) {
	e.mediaMu.Lock()
	defer e.mediaMu.Unlock()
	defer discardOutput(out)
	var a Asset
	var err error
	if runErr == nil {
		a, err = e.storeAsset(out, "DLSS5 增强视频", "video")
		if err != nil {
			runErr = err
		}
	}
	e.writeMu.Lock()
	defer e.writeMu.Unlock()
	j, ok := e.cur.Load().doc.Jobs[id]
	if !ok || !activeDLSS5(j) {
		if a.ID != "" {
			e.removeAssetFile(a)
		}
		return
	}
	_, err = e.updateLocked(func(t *tx) error {
		j.DLSS5 = cloneDLSS5(j.DLSS5)
		j.UpdatedAt = now()
		if runErr != nil {
			j.DLSS5.State = "failed"
			j.DLSS5.Error = runErr.Error()
			if errors.Is(runErr, context.Canceled) || e.closed.Load() {
				j.DLSS5.State = "cancelled"
				j.DLSS5.Error = "本地增强已中断；原视频保留，可仅重试增强"
			}
			t.putJob(j)
			return nil
		}
		j.DLSS5.State = "succeeded"
		j.DLSS5.Progress = 100
		j.DLSS5.Stage = "completed"
		j.DLSS5.Error = ""
		j.DLSS5.EngineVersion = result.EngineVersion
		j.DLSS5.ResultAssetID = a.ID
		if !slices.Contains(j.DLSS5.ResultAssetIDs, a.ID) {
			j.DLSS5.ResultAssetIDs = append(j.DLSS5.ResultAssetIDs, a.ID)
		}
		if source, ok := t.doc.Assets[j.DLSS5.SourceAssetID]; ok {
			a.OriginalWidth, a.OriginalHeight = source.Width, source.Height
			if result.SourceWidth > 0 && result.SourceHeight > 0 {
				source.Width, source.Height = result.SourceWidth, result.SourceHeight
				source.OriginalWidth, source.OriginalHeight = result.SourceWidth, result.SourceHeight
				t.putAsset(source)
				a.OriginalWidth, a.OriginalHeight = result.SourceWidth, result.SourceHeight
			}
		}
		a.Width, a.Height = result.Width, result.Height
		attachResultAsset(t, j, a)
		t.putJob(j)
		return nil
	})
	if err != nil {
		e.removeAssetFile(a)
		e.fail(err)
	}
}
func (e *Engine) PreviewDLSS5(ctx context.Context, r dlss5.PreviewRequest) (dlss5.PreviewResult, error) {
	e.expireDLSS5Previews()
	if err := r.Validate(); err != nil {
		return dlss5.PreviewResult{}, err
	}
	if err := checkID(r.ID); err != nil {
		return dlss5.PreviewResult{}, err
	}
	a, ok := e.Asset(r.SourceAssetID)
	if !ok || a.Kind != "video" || a.DeletedAt != "" {
		return dlss5.PreviewResult{}, errors.New("请选择已生成的原始视频进行预览")
	}
	source, err := e.AssetPath(a.ID)
	if err != nil {
		return dlss5.PreviewResult{}, err
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	stop := context.AfterFunc(e.ctx, cancel)
	defer stop()
	e.writeMu.Lock()
	if err := e.ready(); err != nil {
		e.writeMu.Unlock()
		return dlss5.PreviewResult{}, err
	}
	if current, exists := e.cur.Load().doc.Assets[r.SourceAssetID]; !exists || current.Kind != "video" || current.DeletedAt != "" {
		e.writeMu.Unlock()
		return dlss5.PreviewResult{}, errors.New("原始视频素材已不可用")
	}
	if _, exists := e.dlss.previews[r.ID]; exists {
		e.writeMu.Unlock()
		return dlss5.PreviewResult{}, errors.New("预览请求 ID 已使用")
	}
	if len(e.dlss.previews) >= 8 {
		e.writeMu.Unlock()
		return dlss5.PreviewResult{}, errors.New("预览会话已达上限，请关闭旧预览后重试")
	}
	entry := &dlss5Preview{sourceAssetID: r.SourceAssetID, cancel: cancel, expires: time.Now().Add(20 * time.Minute)}
	e.dlss.previews[r.ID] = entry
	e.wg.Add(1)
	e.writeMu.Unlock()
	defer e.wg.Done()
	completed := false
	defer func() {
		if !completed {
			e.writeMu.Lock()
			delete(e.dlss.previews, r.ID)
			e.writeMu.Unlock()
			if entry.directory != "" {
				os.RemoveAll(entry.directory)
			}
		}
	}()
	select {
	case e.dlss.slot <- struct{}{}:
	case <-ctx.Done():
		return dlss5.PreviewResult{}, ctx.Err()
	}
	defer func() { <-e.dlss.slot }()
	dir, err := os.MkdirTemp(e.repo.mediaDir(), ".dlss5-preview-")
	if err != nil {
		return dlss5.PreviewResult{}, err
	}
	entry.directory = dir
	path, original := filepath.Join(dir, "enhanced.mp4"), filepath.Join(dir, "source.mp4")
	result, err := e.dlss.runner.Process(ctx, e.GetDLSS5Settings(), dlss5.WorkRequest{ID: r.ID, Operation: "preview", InputPath: source, OutputPath: path, SourceOutputPath: original, Options: r.Options, Resolution: r.Options.PreviewResolution, PositionSeconds: r.PositionSeconds, DurationSeconds: r.DurationSeconds}, nil)
	if err != nil {
		return dlss5.PreviewResult{}, err
	}
	if ctx.Err() != nil {
		return dlss5.PreviewResult{}, ctx.Err()
	}
	for _, file := range []string{path, original} {
		f, err := openRegularAssetFile(file)
		if err != nil {
			return dlss5.PreviewResult{}, err
		}
		stat, err := f.Stat()
		f.Close()
		if err != nil || stat.Size() == 0 || stat.Size() > maxVideoBytes {
			return dlss5.PreviewResult{}, errors.New("预览视频无效或超过大小限制")
		}
	}
	output := dlss5.PreviewResult{ID: r.ID, URL: "/studio-dlss5-preview/" + r.ID + "/enhanced", SourceURL: "/studio-dlss5-preview/" + r.ID + "/source", Width: result.Width, Height: result.Height}
	e.writeMu.Lock()
	if ctx.Err() != nil {
		e.writeMu.Unlock()
		return dlss5.PreviewResult{}, ctx.Err()
	}
	entry.result = output
	entry.ready = true
	entry.cancel = nil
	entry.expires = time.Now().Add(20 * time.Minute)
	e.writeMu.Unlock()
	completed = true
	return output, nil
}
func (e *Engine) CancelDLSS5Preview(id string) error {
	e.writeMu.Lock()
	entry := e.dlss.previews[id]
	if entry == nil {
		e.writeMu.Unlock()
		return nil
	}
	if entry.cancel != nil {
		entry.cancel()
		e.writeMu.Unlock()
		return nil
	}
	delete(e.dlss.previews, id)
	e.writeMu.Unlock()
	if entry.directory != "" {
		return os.RemoveAll(entry.directory)
	}
	return nil
}
func (e *Engine) expireDLSS5Previews() {
	ids := []string{}
	e.writeMu.Lock()
	for id, p := range e.dlss.previews {
		if p.ready && time.Now().After(p.expires) {
			ids = append(ids, id)
		}
	}
	e.writeMu.Unlock()
	for _, id := range ids {
		_ = e.CancelDLSS5Preview(id)
	}
}

func (e *Engine) collectDLSS5Previews() {
	defer e.wg.Done()
	timer := time.NewTicker(time.Minute)
	defer timer.Stop()
	for {
		select {
		case <-e.ctx.Done():
			return
		case <-timer.C:
			e.expireDLSS5Previews()
		}
	}
}

func (e *Engine) cleanDLSS5PreviewFiles() {
	e.writeMu.Lock()
	dirs := []string{}
	for id, p := range e.dlss.previews {
		if p.directory != "" {
			dirs = append(dirs, p.directory)
		}
		delete(e.dlss.previews, id)
	}
	e.writeMu.Unlock()
	for _, dir := range dirs {
		_ = os.RemoveAll(dir)
	}
}
func (e *Engine) DLSS5PreviewHandler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		const prefix = "/studio-dlss5-preview/"
		if !strings.HasPrefix(r.URL.Path, prefix) {
			next.ServeHTTP(w, r)
			return
		}
		if r.Method != "GET" && r.Method != "HEAD" {
			w.Header().Set("Allow", "GET, HEAD")
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		parts := strings.Split(strings.TrimPrefix(r.URL.Path, prefix), "/")
		if len(parts) != 2 || checkID(parts[0]) != nil || (parts[1] != "enhanced" && parts[1] != "source") {
			http.NotFound(w, r)
			return
		}
		e.writeMu.Lock()
		p := e.dlss.previews[parts[0]]
		dir := ""
		if p != nil && p.ready && time.Now().Before(p.expires) {
			dir = p.directory
		}
		e.writeMu.Unlock()
		if dir == "" {
			http.NotFound(w, r)
			return
		}
		f, err := openRegularAssetFile(filepath.Join(dir, parts[1]+".mp4"))
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer f.Close()
		stat, err := f.Stat()
		if err != nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "video/mp4")
		w.Header().Set("Cache-Control", "private, no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		http.ServeContent(w, r, parts[1]+".mp4", stat.ModTime(), f)
	})
}
