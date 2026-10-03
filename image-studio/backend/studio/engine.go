package studio

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

type SecretStore interface {
	Get(string) (string, error)
	Set(string, string) error
	Delete(string) error
}

// Output is a generation result. Runners that know the media directory stream
// large results into a temporary file there (Path), which the engine moves into
// place; otherwise the bytes are held in Data. MIME is only a hint: the stored
// type is always sniffed from the content.
type Output struct {
	Data []byte
	MIME string
	Path string
}

// Progress is reported by a Runner while a job runs. RemoteID and ResultURL are
// recovery handles: the engine persists them before the call returns, so a
// crash or interruption can resume retrieval without re-submitting a paid
// request. Percent is volatile and never written to disk on its own.
type Progress struct {
	RemoteID  string
	ResultURL string
	Percent   int
}

type Checkpoint func(Progress) error

type Runner interface {
	Run(ctx context.Context, job Job, key string, reference *Output, checkpoint Checkpoint) (Output, error)
}

type Options struct {
	// Workers bounds concurrent submissions. A job holds its slot until the
	// upstream has accepted it (a remote ID or result URL is recorded) or it
	// finishes; polling and downloads do not hold a slot.
	Workers      int
	Runner       Runner
	PollInterval time.Duration
	// OnChange receives the revision after each durable change. It is called
	// from a dedicated goroutine; rapid changes are coalesced.
	OnChange func(revision uint64)
	// OnProgress is called when a running job reports new volatile progress.
	OnProgress func(jobID string, percent int)
}

// jobTimeout bounds one execution of a job. A job that already has a recovery
// handle is paused, not failed, when it expires.
const jobTimeout = 20 * time.Minute

type jobRun struct {
	ctx    context.Context
	cancel context.CancelFunc
}

type Engine struct {
	// writeMu serializes state transitions and their disk writes. Readers never
	// take it: they load the published state from cur.
	writeMu sync.Mutex
	cur     atomic.Pointer[state]
	repo    repository
	secrets SecretStore
	runner  Runner
	epoch   string

	ctx    context.Context
	stop   context.CancelFunc
	wg     sync.WaitGroup
	slots  chan struct{}
	wake   chan struct{}
	closed atomic.Bool
	fatal  atomic.Pointer[errFatal]
	runs   map[string]*jobRun // guarded by writeMu

	progress   progressTracker
	onChange   func(uint64)
	onProgress func(string, int)
	notify     chan struct{}
	pendingRev atomic.Uint64
}

func Open(root string, secrets SecretStore, opts Options) (*Engine, error) {
	if secrets == nil {
		return nil, errors.New("缺少安全凭据存储")
	}
	n := opts.Workers
	if n == 0 {
		n = 2
	}
	if n < 1 || n > 8 {
		return nil, errors.New("worker 数必须为 1–8")
	}
	repo := repository{root}
	d, err := repo.read()
	if err != nil {
		return nil, err
	}
	// A crash must NEVER cause an automatic replay of a possibly charged POST.
	recovered := false
	for id, j := range d.Jobs {
		switch j.State {
		case "running":
			switch {
			case j.RemoteID != "":
				j.State = "paused"
				j.Error = "应用中断；可恢复轮询，不重新提交"
			case j.ResultURL != "":
				j.State = "paused"
				j.Error = "应用中断；结果已生成，可恢复下载，不重新提交"
			default:
				j.State = "uncertain"
				j.Error = "提交结果未知；请在上游核对，系统不会自动重发收费请求"
			}
		case "queued":
			j.State = "paused"
			j.Error = "待执行任务已暂停，请手动恢复"
		default:
			continue
		}
		j.UpdatedAt = now()
		d.Jobs[id] = j
		recovered = true
	}
	if recovered {
		if err = repo.write(d); err != nil {
			return nil, err
		}
	}
	repo.removeStaleTemporaries()
	ctx, cancel := context.WithCancel(context.Background())
	e := &Engine{
		repo: repo, secrets: secrets, runner: opts.Runner, epoch: NewID(),
		ctx: ctx, stop: cancel, slots: make(chan struct{}, n), wake: make(chan struct{}, 1),
		runs: map[string]*jobRun{}, onChange: opts.OnChange, onProgress: opts.OnProgress,
		notify: make(chan struct{}, 1),
	}
	if e.runner == nil {
		e.runner = &HTTPProvider{PollInterval: opts.PollInterval, MediaDir: repo.mediaDir()}
	}
	e.cur.Store(&state{doc: d, rev: 1, logStart: 1})
	e.wg.Add(1)
	go e.dispatch()
	if e.onChange != nil {
		e.wg.Add(1)
		go e.deliverChanges()
	}
	return e, nil
}

// Close stops dispatching, cancels running jobs and waits until each has
// recorded its final state. It is safe to call more than once.
func (e *Engine) Close() {
	if !e.closed.Swap(true) {
		e.stop()
		e.wakeDispatcher()
	}
	e.wg.Wait()
}

// Epoch identifies this process's revision sequence for change feeds.
func (e *Engine) Epoch() string { return e.epoch }

func (e *Engine) changed(rev uint64) {
	e.wakeDispatcher()
	if e.onChange != nil {
		e.pendingRev.Store(rev)
		select {
		case e.notify <- struct{}{}:
		default:
		}
	}
}

func (e *Engine) deliverChanges() {
	defer e.wg.Done()
	for {
		select {
		case <-e.notify:
			e.onChange(e.pendingRev.Load())
		case <-e.ctx.Done():
			return
		}
	}
}

func (e *Engine) wakeDispatcher() {
	select {
	case e.wake <- struct{}{}:
	default:
	}
}

func (e *Engine) SaveProject(p Project) (Project, error) {
	if _, err := p.Order(); err != nil {
		return Project{}, err
	}
	err := e.update(func(t *tx) error {
		old, exists := t.doc.Projects[p.ID]
		if (exists && old.Revision != p.Revision) || (!exists && p.Revision != 0) {
			return ErrConflict
		}
		for _, n := range p.Nodes {
			if n.AssetID != "" {
				if _, ok := t.doc.Assets[n.AssetID]; !ok {
					return errors.New("引用的素材不存在，请先导入素材")
				}
			}
		}
		if !exists && len(t.doc.Projects) >= 1000 {
			return errors.New("画布数量达到 1000，请先归档")
		}
		p.Revision++
		p.UpdatedAt = now()
		if p.Nodes == nil {
			p.Nodes = []Node{}
		}
		if p.Edges == nil {
			p.Edges = []Edge{}
		}
		t.putProject(p)
		return nil
	})
	if err != nil {
		return Project{}, err
	}
	return p, nil
}

func fingerprint(r Request, deps []string) string {
	b, _ := json.Marshal(struct {
		R Request
		D []string
	}{r, deps})
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func buildJob(t *tx, r Request, deps []string) (Job, error) {
	if old, ok := t.doc.Jobs[r.ID]; ok {
		if old.Fingerprint != fingerprint(r, deps) {
			return Job{}, errors.New("幂等标识已用于不同的请求")
		}
		return old, nil
	}
	p, ok := t.doc.Profiles[r.ProfileID]
	if !ok {
		return Job{}, errors.New("上游不存在")
	}
	if err := r.Validate(p); err != nil {
		return Job{}, err
	}
	project, ok := t.doc.Projects[r.ProjectID]
	if !ok {
		return Job{}, errors.New("请先保存目标画布")
	}
	if len(project.Nodes) >= 2000 {
		return Job{}, errors.New("画布接近容量上限，请新建画布")
	}
	if r.NodeID != "" {
		found := false
		for _, n := range project.Nodes {
			if n.ID == r.NodeID {
				found = true
				if n.Kind != r.Kind {
					return Job{}, errors.New("目标节点类型不匹配")
				}
			}
		}
		if !found {
			return Job{}, errors.New("目标节点不存在")
		}
	}
	if r.ReferenceAssetID != "" {
		a, ok := t.doc.Assets[r.ReferenceAssetID]
		if !ok || a.Kind != "image" {
			return Job{}, errors.New("参考素材必须是已导入的图片")
		}
		if a.Bytes > maxReferenceBytes {
			return Job{}, errors.New("参考图片最大 20 MB")
		}
	}
	if len(deps) > 1 {
		return Job{}, errors.New("当前生成适配器只接受一个上游图片结果")
	}
	for _, id := range deps {
		j, ok := t.doc.Jobs[id]
		if !ok || j.Request.Kind != "image" {
			return Job{}, errors.New("仅支持从图片生成节点继续生成；视频不能作为参考图片")
		}
	}
	if len(deps) > 0 && r.ReferenceAssetID != "" {
		return Job{}, errors.New("当前仅支持一张参考图，请移除额外图片连线")
	}
	active := 0
	for _, j := range t.doc.Jobs {
		if !terminal(j.State) {
			active++
		}
	}
	if active >= 128 {
		return Job{}, errors.New("待处理任务达到 128 个，请稍后提交")
	}
	if len(t.doc.Jobs) >= 10000 {
		return Job{}, errors.New("任务历史达到上限，请归档数据库后继续")
	}
	j := Job{ID: r.ID, Request: r, Profile: p, Fingerprint: fingerprint(r, deps), State: "queued",
		DependsOn: append([]string{}, deps...), CreatedAt: now(), UpdatedAt: now()}
	t.putJob(j)
	return j, nil
}

func (e *Engine) Submit(r Request) (Job, error) {
	var j Job
	err := e.update(func(t *tx) error {
		var err error
		j, err = buildJob(t, r, nil)
		return err
	})
	return j, err
}

// RunWorkflow expands a canvas transactionally. Invalid nodes cannot partly
// submit a paid workflow. Output-asset provenance edges are not executable
// input commands.
func (e *Engine) RunWorkflow(projectID, profileID, runID string) ([]Job, error) {
	if err := checkID(runID); err != nil {
		return nil, err
	}
	var jobs []Job
	err := e.update(func(t *tx) error {
		p, ok := t.doc.Projects[projectID]
		if !ok {
			return errors.New("画布不存在")
		}
		order, err := p.Order()
		if err != nil {
			return err
		}
		nodes := map[string]Node{}
		for _, n := range p.Nodes {
			nodes[n.ID] = n
		}
		ids := map[string]string{}
		jobs = []Job{}
		for _, id := range order {
			n := nodes[id]
			if n.Kind != "image" && n.Kind != "video" {
				continue
			}
			r := Request{ID: runID + "-" + id, ProfileID: profileID, ProjectID: projectID, NodeID: id, Kind: n.Kind, Parameters: n.Parameters}
			texts := []string{}
			deps := []string{}
			for _, edge := range p.Edges {
				if edge.To != id {
					continue
				}
				source := nodes[edge.From]
				switch source.Kind {
				case "prompt", "note":
					if strings.TrimSpace(source.Text) != "" {
						texts = append(texts, source.Text)
					}
				case "asset":
					if source.AssetID == "" {
						return errors.New("素材节点尚未选择文件，请先绑定本地图片")
					}
					if r.ReferenceAssetID != "" {
						return errors.New("一个节点仅支持一张参考图片")
					}
					r.ReferenceAssetID = source.AssetID
				case "image", "video":
					deps = append(deps, ids[source.ID])
				}
			}
			if strings.TrimSpace(n.Text) != "" {
				texts = append(texts, n.Text)
			}
			r.Prompt = strings.Join(texts, "\n\n")
			j, err := buildJob(t, r, deps)
			if err != nil {
				return fmt.Errorf("节点 %s：%w", n.Title, err)
			}
			ids[id] = j.ID
			jobs = append(jobs, j)
		}
		if len(jobs) == 0 {
			return errors.New("画布没有可执行的图片或视频生成节点")
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return jobs, nil
}

// Cancel stops local work. A request that already reached the upstream may
// still run and be billed there; the message says so only when that is possible.
func (e *Engine) Cancel(id string) error {
	e.writeMu.Lock()
	defer e.writeMu.Unlock()
	if err := e.ready(); err != nil {
		return err
	}
	j, ok := e.cur.Load().doc.Jobs[id]
	if !ok {
		return errors.New("任务不存在")
	}
	if terminal(j.State) {
		return nil
	}
	submitted := j.RemoteID != "" || j.ResultURL != ""
	message := "已取消，尚未发出请求"
	switch {
	case submitted:
		message = "已停止本地任务；上游可能仍执行和计费"
	case j.State == "running":
		message = "已停止本地任务；若请求已发出，上游可能仍执行和计费"
	}
	if p, ok := e.progress.take(id); ok {
		j.Progress = p
	}
	_, err := e.updateLocked(func(t *tx) error {
		j.State = "cancelled"
		j.Error = message
		j.UpdatedAt = now()
		t.putJob(j)
		return nil
	})
	if err == nil {
		if run := e.runs[id]; run != nil {
			run.cancel()
		}
	}
	return err
}

func (e *Engine) Resume(id string) error {
	return e.update(func(t *tx) error {
		j, ok := t.doc.Jobs[id]
		if !ok {
			return errors.New("任务不存在")
		}
		if j.State != "paused" {
			return errors.New("只能恢复已暂停任务；结果未知的提交不会自动重发")
		}
		j.State = "queued"
		j.Error = ""
		j.UpdatedAt = now()
		t.putJob(j)
		return nil
	})
}

// dispatch reserves a submission slot, then claims the oldest runnable job.
func (e *Engine) dispatch() {
	defer e.wg.Done()
	for {
		select {
		case e.slots <- struct{}{}:
		case <-e.ctx.Done():
			return
		}
		job, run, ok := e.claim()
		if !ok {
			<-e.slots
			select {
			case <-e.wake:
			case <-e.ctx.Done():
				return
			}
			continue
		}
		e.wg.Add(1)
		go e.execute(job, run)
	}
}

// claim makes the durable queued→running transition and registers the job's
// cancel function in the same critical section, so Cancel cannot slip between
// them and concurrent dispatch cannot double-submit a task.
func (e *Engine) claim() (Job, *jobRun, bool) {
	e.writeMu.Lock()
	defer e.writeMu.Unlock()
	if e.ready() != nil {
		return Job{}, nil, false
	}
	var claimed Job
	found := false
	_, err := e.updateLocked(func(t *tx) error {
		ids := []string{}
		for id, j := range t.doc.Jobs {
			if j.State == "queued" {
				ids = append(ids, id)
			}
		}
		sort.Slice(ids, func(a, b int) bool {
			x, y := t.doc.Jobs[ids[a]], t.doc.Jobs[ids[b]]
			if x.CreatedAt != y.CreatedAt {
				return x.CreatedAt < y.CreatedAt
			}
			return ids[a] < ids[b]
		})
		for _, id := range ids {
			j := t.doc.Jobs[id]
			ready, blocked := true, false
			for _, dep := range j.DependsOn {
				p, exists := t.doc.Jobs[dep]
				if !exists || (terminal(p.State) && p.State != "succeeded") {
					blocked = true
				}
				if p.State != "succeeded" {
					ready = false
				}
			}
			if blocked {
				j.State = "failed"
				j.Error = "上游依赖未成功，未发出本节点请求"
				j.UpdatedAt = now()
				t.putJob(j)
				continue
			}
			if !ready || found {
				continue
			}
			for _, dep := range j.DependsOn {
				j.Request.ReferenceAssetID = t.doc.Jobs[dep].ResultAssetID
			}
			j.State = "running"
			j.UpdatedAt = now()
			t.putJob(j)
			claimed, found = j, true
		}
		return nil
	})
	if err != nil {
		e.fail(err)
		return Job{}, nil, false
	}
	if !found {
		return Job{}, nil, false
	}
	ctx, cancel := context.WithTimeout(e.ctx, jobTimeout)
	run := &jobRun{ctx: ctx, cancel: cancel}
	e.runs[claimed.ID] = run
	return claimed, run, true
}

func (e *Engine) execute(job Job, run *jobRun) {
	defer e.wg.Done()
	var once sync.Once
	release := func() { once.Do(func() { <-e.slots }) }
	defer release()
	if job.RemoteID != "" || job.ResultURL != "" {
		// Only retrieval remains; it does not count against submissions.
		release()
	}
	output, err := e.run(run.ctx, job, release)
	run.cancel()
	e.complete(job, output, err)
}

func (e *Engine) run(ctx context.Context, j Job, release func()) (out Output, runErr error) {
	defer func() {
		if recover() != nil {
			out = Output{}
			runErr = &UncertainError{}
		}
	}()
	slot := j.Profile.secretSlot()
	if slot == "" {
		slot = j.Request.ProfileID
	}
	key, err := e.secrets.Get(slot)
	if err != nil || key == "" {
		return Output{}, &NotSentError{Reason: "无法从系统凭据存储读取 API Key，请重新保存"}
	}
	var ref *Output
	if j.Request.ReferenceAssetID != "" {
		a, ok := e.Asset(j.Request.ReferenceAssetID)
		if !ok || a.Kind != "image" {
			return Output{}, &NotSentError{Reason: "参考图片不存在"}
		}
		if a.Bytes > maxReferenceBytes {
			return Output{}, &NotSentError{Reason: "参考图片最大 20 MB"}
		}
		b, err := os.ReadFile(filepath.Join(e.repo.mediaDir(), a.FileName))
		if err != nil {
			return Output{}, &NotSentError{Reason: "参考图片文件不可读"}
		}
		ref = &Output{Data: b, MIME: a.MIME}
	}
	result, err := e.runner.Run(ctx, j, key, ref, func(p Progress) error { return e.checkpoint(j.ID, p, release) })
	if err != nil {
		return Output{}, redactError(err, key)
	}
	return result, nil
}

// redactError keeps typed control-flow errors and strips the key from any
// free-form message before it can reach the database or the UI.
func redactError(err error, key string) error {
	var uncertain *UncertainError
	var resumable *ResumeError
	var notSent *NotSentError
	switch {
	case errors.As(err, &uncertain), errors.As(err, &resumable),
		errors.Is(err, context.Canceled), errors.Is(err, context.DeadlineExceeded):
		return err
	case errors.As(err, &notSent):
		return &NotSentError{Reason: strings.ReplaceAll(notSent.Reason, key, "[REDACTED]")}
	}
	return errors.New(strings.ReplaceAll(err.Error(), key, "[REDACTED]"))
}

// checkpoint persists recovery handles before the runner continues and records
// volatile progress in memory only.
func (e *Engine) checkpoint(id string, p Progress, release func()) error {
	if p.RemoteID != "" && !validRemoteID(p.RemoteID) {
		return errors.New("上游返回无效任务 ID")
	}
	if p.ResultURL != "" && !validResultURL(p.ResultURL) {
		return errors.New("上游返回无效结果地址")
	}
	percent := max(0, min(p.Percent, 99))
	current, ok := e.cur.Load().doc.Jobs[id]
	if !ok || current.State != "running" {
		return context.Canceled
	}
	if (p.RemoteID != "" && p.RemoteID != current.RemoteID) || (p.ResultURL != "" && p.ResultURL != current.ResultURL) {
		e.writeMu.Lock()
		current, ok = e.cur.Load().doc.Jobs[id]
		if !ok || current.State != "running" {
			e.writeMu.Unlock()
			return context.Canceled
		}
		_, err := e.updateLocked(func(t *tx) error {
			if p.RemoteID != "" {
				current.RemoteID = p.RemoteID
			}
			if p.ResultURL != "" {
				current.ResultURL = p.ResultURL
			}
			current.Progress = percent
			current.UpdatedAt = now()
			t.putJob(current)
			return nil
		})
		e.writeMu.Unlock()
		if err != nil {
			return err
		}
		// The paid submission is accepted; free the slot for the next one.
		release()
	}
	if e.progress.set(id, percent) && e.onProgress != nil {
		e.onProgress(id, percent)
	}
	return nil
}

// complete stores a result file outside the write lock, then records the final
// state. A job cancelled while running never gets its late output attached.
func (e *Engine) complete(job Job, output Output, runErr error) {
	defer discardOutput(output)
	var asset Asset
	var assetErr error
	if runErr == nil && e.stillRunning(job.ID) {
		asset, assetErr = e.storeAsset(output, resultName(job.Request.Kind), job.Request.Kind)
	}
	e.writeMu.Lock()
	defer e.writeMu.Unlock()
	delete(e.runs, job.ID)
	progress, hasProgress := e.progress.take(job.ID)
	current, ok := e.cur.Load().doc.Jobs[job.ID]
	if !ok || current.State != "running" || e.failure() != nil {
		e.removeAssetFile(asset)
		return
	}
	if hasProgress {
		current.Progress = progress
	}
	var err error
	switch {
	case runErr != nil:
		state, message := e.classify(current, runErr)
		_, err = e.updateLocked(func(t *tx) error {
			current.State, current.Error, current.UpdatedAt = state, message, now()
			t.putJob(current)
			return nil
		})
	case assetErr != nil:
		_, err = e.updateLocked(func(t *tx) error {
			current.State, current.Error, current.UpdatedAt = "failed", assetErr.Error(), now()
			t.putJob(current)
			return nil
		})
	default:
		_, err = e.updateLocked(func(t *tx) error {
			attachResult(t, current, asset)
			return nil
		})
		if err != nil {
			e.removeAssetFile(asset)
		}
	}
	if err != nil {
		e.fail(err)
	}
}

func (e *Engine) stillRunning(id string) bool {
	j, ok := e.cur.Load().doc.Jobs[id]
	return ok && j.State == "running"
}

// classify maps a runner error to the job's next state. Anything that might
// have reached the upstream is never silently retried.
func (e *Engine) classify(current Job, err error) (string, string) {
	state, message := "failed", err.Error()
	var uncertain *UncertainError
	var resumable *ResumeError
	var notSent *NotSentError
	closed := e.closed.Load()
	recoverable := current.RemoteID != "" || current.ResultURL != ""
	sent := !errors.As(err, &notSent)
	if errors.As(err, &uncertain) {
		state = "uncertain"
	}
	if recoverable && errors.As(err, &resumable) {
		state = "paused"
	}
	if recoverable && (errors.Is(err, context.DeadlineExceeded) || closed) {
		state, message = "paused", "等待中断，可恢复查询，不重新提交"
	}
	if closed && !recoverable {
		if sent {
			state, message = "uncertain", "应用在提交期间关闭，请先核对上游请求"
		} else {
			state, message = "paused", "应用关闭时请求尚未发出；恢复后会重新提交"
		}
	}
	return state, message
}

func resultName(kind string) string {
	if kind == "video" {
		return "生成视频"
	}
	return "生成图片"
}
