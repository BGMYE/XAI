package studio

import (
	"errors"
	"fmt"
	"maps"
	"slices"
	"sort"
	"sync"
)

// collection identifies one of the document maps in change records.
type collection uint8

const (
	colProfiles collection = iota
	colProjects
	colAssets
	colJobs
	colPromptCards
	// colSettings marks document-level settings. Settings are not part of
	// change feeds; the change only advances the revision.
	colSettings
)

// change records that one entity was written or removed by a transaction.
type change struct {
	rev     uint64
	col     collection
	id      string
	removed bool
}

// maxChangeLog bounds the in-memory change feed. Clients that fall further
// behind receive a full snapshot instead of a delta.
const maxChangeLog = 8192

// state is an immutable, published view of the database.
//
// Invariant: nothing reachable from a published state is ever mutated. Writers
// build the next state through a tx, which clones a map before its first write
// and stores fresh values; slices inside stored values must be replaced, never
// modified in place. This lets readers use a state without holding any lock,
// so snapshots, media requests and change feeds never wait for disk I/O.
type state struct {
	doc document
	rev uint64
	// log holds changes with rev in (logStart, rev], oldest first. A new state
	// may share the backing array with its parent: appends never touch elements
	// visible through the parent's shorter slice header, and writers are
	// serialized by Engine.writeMu.
	log      []change
	logStart uint64
}

// tx accumulates one atomic change. Reads see the base state plus the writes
// already made in this transaction.
type tx struct {
	doc     document
	cloned  [colSettings]bool
	changes []change
}

func newTx(base *state) *tx { return &tx{doc: base.doc} }

func (t *tx) touch(col collection, id string, removed bool) {
	t.changes = append(t.changes, change{col: col, id: id, removed: removed})
}

func (t *tx) jobs() map[string]Job {
	if !t.cloned[colJobs] {
		t.doc.Jobs = maps.Clone(t.doc.Jobs)
		t.cloned[colJobs] = true
	}
	return t.doc.Jobs
}

func (t *tx) putJob(j Job) { t.jobs()[j.ID] = j; t.touch(colJobs, j.ID, false) }

func (t *tx) putProject(p Project) {
	if !t.cloned[colProjects] {
		t.doc.Projects = maps.Clone(t.doc.Projects)
		t.cloned[colProjects] = true
	}
	t.doc.Projects[p.ID] = p
	t.touch(colProjects, p.ID, false)
}

func (t *tx) putAsset(a Asset) {
	if !t.cloned[colAssets] {
		t.doc.Assets = maps.Clone(t.doc.Assets)
		t.cloned[colAssets] = true
	}
	t.doc.Assets[a.ID] = a
	t.touch(colAssets, a.ID, false)
}

func (t *tx) profiles() map[string]Profile {
	if !t.cloned[colProfiles] {
		t.doc.Profiles = maps.Clone(t.doc.Profiles)
		t.cloned[colProfiles] = true
	}
	return t.doc.Profiles
}

func (t *tx) putProfile(p Profile) { t.profiles()[p.ID] = p; t.touch(colProfiles, p.ID, false) }

func (t *tx) deleteProfile(id string) {
	delete(t.profiles(), id)
	t.touch(colProfiles, id, true)
}

func (t *tx) promptCards() map[string]PromptCard {
	if !t.cloned[colPromptCards] {
		t.doc.PromptCards = maps.Clone(t.doc.PromptCards)
		t.cloned[colPromptCards] = true
	}
	return t.doc.PromptCards
}

func (t *tx) putPromptCard(p PromptCard) {
	t.promptCards()[p.ID] = p
	t.touch(colPromptCards, p.ID, false)
}

func (t *tx) deletePromptCard(id string) {
	delete(t.promptCards(), id)
	t.touch(colPromptCards, id, true)
}

func (t *tx) setNetwork(n NetworkSettings) {
	t.doc.Network = n
	t.touch(colSettings, "network", false)
}

// retireProfile remembers a deleted profile ID. The slice is replaced, never
// appended in place: the published document may share its backing array.
func (t *tx) retireProfile(id string) {
	ids := append(slices.Clip(t.doc.RetiredProfileIDs), id)
	if over := len(ids) - maxRetiredProfiles; over > 0 {
		ids = slices.Clone(ids[over:])
	}
	t.doc.RetiredProfileIDs = ids
	t.touch(colSettings, "retiredProfiles", false)
}

// errFatal wraps an error that stopped the engine.
type errFatal struct{ err error }

// update applies fn as one durable transaction. The new state is published
// only after it has been written to disk; on any error nothing changes.
// Callers must hold e.writeMu.
func (e *Engine) updateLocked(fn func(*tx) error) (*state, error) {
	cur := e.cur.Load()
	t := newTx(cur)
	if err := fn(t); err != nil {
		return cur, err
	}
	if len(t.changes) == 0 {
		return cur, nil
	}
	if err := e.repo.write(t.doc); err != nil {
		return cur, fmt.Errorf("保存失败，原数据保留：%w", err)
	}
	next := &state{doc: t.doc, rev: cur.rev + 1, log: cur.log, logStart: cur.logStart}
	for _, c := range t.changes {
		c.rev = next.rev
		next.log = append(next.log, c)
	}
	if over := len(next.log) - maxChangeLog; over > 0 {
		// Copy so the retained window no longer aliases the parent's array.
		next.logStart = next.log[over-1].rev
		next.log = slices.Clone(next.log[over:])
	}
	e.cur.Store(next)
	close(e.updates)
	e.updates = make(chan struct{})
	e.changed(next.rev)
	return next, nil
}

// update is updateLocked for public operations: it takes the write lock and
// refuses work once the engine is closed or has failed.
func (e *Engine) update(fn func(*tx) error) error {
	e.writeMu.Lock()
	defer e.writeMu.Unlock()
	if err := e.ready(); err != nil {
		return err
	}
	_, err := e.updateLocked(fn)
	return err
}

func (e *Engine) ready() error {
	if e.closed.Load() {
		return errors.New("工作室已关闭")
	}
	return e.failure()
}

func (e *Engine) failure() error {
	if f := e.fatal.Load(); f != nil {
		return f.err
	}
	return nil
}

// fail stops the engine after a state transition could not be persisted.
func (e *Engine) fail(err error) {
	if e.fatal.CompareAndSwap(nil, &errFatal{fmt.Errorf("任务状态无法落盘，请重启并检查磁盘空间：%w", err)}) {
		close(e.failed)
	}
	e.wakeDispatcher()
}

// progressTracker keeps volatile per-job progress. Progress changes are
// frequent and do not need to survive a restart, so they are never written to
// disk; the last value is folded into the job on its next durable transition.
type progressTracker struct {
	mu sync.Mutex
	m  map[string]int
}

func (p *progressTracker) set(id string, v int) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.m == nil {
		p.m = map[string]int{}
	}
	if old, ok := p.m[id]; ok && old == v {
		return false
	}
	p.m[id] = v
	return true
}

func (p *progressTracker) take(id string) (int, bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	v, ok := p.m[id]
	delete(p.m, id)
	return v, ok
}

func (p *progressTracker) snapshot() map[string]int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return maps.Clone(p.m)
}

// Snapshot returns every collection. It reads the published state without
// locking or copying the database.
func (e *Engine) Snapshot() (Snapshot, error) {
	if err := e.failure(); err != nil {
		return Snapshot{}, err
	}
	st := e.cur.Load()
	progress := e.progress.snapshot()
	s := Snapshot{
		Epoch: e.epoch, Revision: st.rev,
		Profiles:    sortedValues(st.doc.Profiles, cloneProfile, func(a, b Profile) bool { return a.Name < b.Name }),
		Projects:    sortedValues(st.doc.Projects, cloneProject, func(a, b Project) bool { return a.UpdatedAt > b.UpdatedAt }),
		Assets:      sortedValues(st.doc.Assets, func(a Asset) Asset { return a }, func(a, b Asset) bool { return a.CreatedAt > b.CreatedAt }),
		Jobs:        withProgress(sortedValues(st.doc.Jobs, cloneJob, func(a, b Job) bool { return a.CreatedAt > b.CreatedAt }), progress),
		PromptCards: sortedValues(st.doc.PromptCards, clonePromptCard, func(a, b PromptCard) bool { return a.UpdatedAt > b.UpdatedAt }),
	}
	return s, nil
}

// ChangeSet is the delta between a client's revision and the current state.
// Full is set (and every collection is complete) when the client is on another
// epoch or too far behind the bounded change log.
type ChangeSet struct {
	Epoch       string         `json:"epoch"`
	Revision    uint64         `json:"revision"`
	Full        bool           `json:"full"`
	Profiles    []Profile      `json:"profiles"`
	Projects    []Project      `json:"projects"`
	Assets      []Asset        `json:"assets"`
	Jobs        []Job          `json:"jobs"`
	PromptCards []PromptCard   `json:"promptCards"`
	Removed     RemovedIDs     `json:"removed"`
	Progress    map[string]int `json:"progress"`
}

// RemovedIDs lists entities deleted since the client's revision.
type RemovedIDs struct {
	Projects    []string `json:"projects"`
	Assets      []string `json:"assets"`
	Jobs        []string `json:"jobs"`
	Profiles    []string `json:"profiles"`
	PromptCards []string `json:"promptCards"`
}

// Changes returns what changed after revision since in the given epoch. The
// volatile progress of running jobs is always included.
func (e *Engine) Changes(epoch string, since uint64) (ChangeSet, error) {
	if err := e.failure(); err != nil {
		return ChangeSet{}, err
	}
	st := e.cur.Load()
	progress := e.progress.snapshot()
	if progress == nil {
		progress = map[string]int{}
	}
	cs := ChangeSet{Epoch: e.epoch, Revision: st.rev, Progress: progress,
		Profiles: []Profile{}, Projects: []Project{}, Assets: []Asset{}, Jobs: []Job{}, PromptCards: []PromptCard{},
		Removed: RemovedIDs{Profiles: []string{}, PromptCards: []string{}}}
	if epoch != e.epoch || since < st.logStart || since > st.rev {
		s, err := e.Snapshot()
		if err != nil {
			return ChangeSet{}, err
		}
		cs.Full = true
		cs.Revision = s.Revision
		cs.Profiles, cs.Projects, cs.Assets, cs.Jobs, cs.PromptCards = s.Profiles, s.Projects, s.Assets, s.Jobs, s.PromptCards
		return cs, nil
	}
	// Changes are ordered by revision; walk back to the first one after since.
	start := sort.Search(len(st.log), func(i int) bool { return st.log[i].rev > since })
	seen := map[change]bool{}
	for _, c := range st.log[start:] {
		key := change{col: c.col, id: c.id}
		if seen[key] {
			continue
		}
		seen[key] = true
		switch c.col {
		case colProfiles:
			if v, ok := st.doc.Profiles[c.id]; ok {
				cs.Profiles = append(cs.Profiles, cloneProfile(v))
			} else {
				cs.Removed.Profiles = append(cs.Removed.Profiles, c.id)
			}
		case colProjects:
			if v, ok := st.doc.Projects[c.id]; ok {
				cs.Projects = append(cs.Projects, cloneProject(v))
			} else {
				cs.Removed.Projects = append(cs.Removed.Projects, c.id)
			}
		case colAssets:
			if v, ok := st.doc.Assets[c.id]; ok {
				cs.Assets = append(cs.Assets, v)
			} else {
				cs.Removed.Assets = append(cs.Removed.Assets, c.id)
			}
		case colJobs:
			if v, ok := st.doc.Jobs[c.id]; ok {
				cs.Jobs = append(cs.Jobs, cloneJob(v))
			} else {
				cs.Removed.Jobs = append(cs.Removed.Jobs, c.id)
			}
		case colPromptCards:
			if v, ok := st.doc.PromptCards[c.id]; ok {
				cs.PromptCards = append(cs.PromptCards, clonePromptCard(v))
			} else {
				cs.Removed.PromptCards = append(cs.Removed.PromptCards, c.id)
			}
		}
	}
	cs.Jobs = withProgress(cs.Jobs, progress)
	return cs, nil
}

// sortedValues copies a collection out of a state. clone detaches nested
// slices, so callers can never modify the published database through results.
func sortedValues[T any](m map[string]T, clone func(T) T, less func(a, b T) bool) []T {
	out := make([]T, 0, len(m))
	for _, v := range m {
		out = append(out, clone(v))
	}
	sort.Slice(out, func(i, j int) bool { return less(out[i], out[j]) })
	return out
}

// withProgress overlays volatile progress on running jobs. Jobs are values, so
// this never touches the published state.
func withProgress(jobs []Job, progress map[string]int) []Job {
	if len(progress) == 0 {
		return jobs
	}
	for i := range jobs {
		if p, ok := progress[jobs[i].ID]; ok && jobs[i].State == "running" {
			jobs[i].Progress = p
		}
	}
	return jobs
}

func cloneProfile(p Profile) Profile {
	p.ModelIDs = slices.Clone(p.ModelIDs)
	return p
}

func cloneProject(p Project) Project {
	p.Nodes = slices.Clone(p.Nodes)
	p.Edges = slices.Clone(p.Edges)
	return p
}

func cloneJob(j Job) Job {
	if j.FallbackProfile != nil {
		copy := cloneProfile(*j.FallbackProfile)
		j.FallbackProfile = &copy
	}
	j.DependsOn = slices.Clone(j.DependsOn)
	j.Request.ReferenceAssetIDs = slices.Clone(j.Request.ReferenceAssetIDs)
	return j
}

func clonePromptCard(c PromptCard) PromptCard {
	c.Tags = slices.Clone(c.Tags)
	c.ReferenceImageURLs = slices.Clone(c.ReferenceImageURLs)
	return c
}
