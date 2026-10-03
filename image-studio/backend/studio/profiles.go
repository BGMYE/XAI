package studio

import (
	"context"
	"errors"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/yuanhua/image-gptcodex/pkg/client"
)

// maxRetiredProfiles bounds the list of deleted profile IDs kept so that an
// import from the classic editor's stale copy never brings one back.
const maxRetiredProfiles = 1000

// SaveProfile creates or updates an upstream. Credential rotation creates an
// immutable keychain slot first, then commits the pointer, so a failed
// database write cannot change the key used by an existing endpoint.
// Keychain calls run under the write lock: they are rare, and readers are
// never blocked by it.
//
// An empty key keeps the saved one. Re-entering the saved key is not a
// rotation, so editors that always send the key do not churn keychain slots.
func (e *Engine) SaveProfile(p Profile, key string) (Profile, error) {
	if p.ID == "" {
		p.ID = NewID()
	}
	if err := p.Validate(); err != nil {
		return Profile{}, err
	}
	key = strings.TrimSpace(key)
	if len(key) > 8192 {
		return Profile{}, errors.New("API Key 过长")
	}
	e.writeMu.Lock()
	defer e.writeMu.Unlock()
	if err := e.ready(); err != nil {
		return Profile{}, err
	}
	doc := e.cur.Load().doc
	old, exists := doc.Profiles[p.ID]
	if p.FallbackProfileID != "" {
		if _, ok := doc.Profiles[p.FallbackProfileID]; !ok {
			return Profile{}, errors.New("备用上游不存在")
		}
	}
	if key == "" && old.HasKey && old.BaseURL != p.BaseURL {
		return Profile{}, errors.New("修改上游地址时请重新填写 API Key，避免将旧密钥发送到新地址")
	}
	rotate := key != ""
	if rotate && old.HasKey {
		if saved, err := e.secrets.Get(old.secretSlot()); err == nil && saved == key {
			rotate = false
		}
	}
	p.CredentialID = old.CredentialID
	p.HasKey = old.HasKey
	p.VerifiedAt = old.VerifiedAt
	if rotate || p.connection() != old.connection() {
		p.VerifiedAt = ""
	}
	p.CreatedAt = old.CreatedAt
	if !exists || p.CreatedAt == "" {
		p.CreatedAt = now()
	}
	p.UpdatedAt = now()
	slot := ""
	if rotate {
		slot = NewID()
		if err := e.secrets.Set(slot, key); err != nil {
			return Profile{}, errors.New("系统凭据存储失败；未回退到明文保存")
		}
		p.CredentialID = slot
		p.HasKey = true
	}
	st, err := e.updateLocked(func(t *tx) error { t.putProfile(p); return nil })
	if err != nil {
		if slot != "" {
			_ = e.secrets.Delete(slot)
		}
		return Profile{}, err
	}
	if rotate && old.HasKey {
		e.releaseSlot(st, old.secretSlot())
	}
	return cloneProfile(p), nil
}

// ClearProfileKey forgets an upstream's key. Jobs that can still run keep the
// credential version they pinned until they finish.
func (e *Engine) ClearProfileKey(id string) (Profile, error) {
	e.writeMu.Lock()
	defer e.writeMu.Unlock()
	if err := e.ready(); err != nil {
		return Profile{}, err
	}
	p, ok := e.cur.Load().doc.Profiles[id]
	if !ok {
		return Profile{}, errors.New("上游不存在")
	}
	if !p.HasKey {
		return cloneProfile(p), nil
	}
	slot := p.secretSlot()
	p.HasKey, p.CredentialID, p.VerifiedAt = false, "", ""
	p.UpdatedAt = now()
	st, err := e.updateLocked(func(t *tx) error { t.putProfile(p); return nil })
	if err != nil {
		return Profile{}, err
	}
	e.releaseSlot(st, slot)
	return cloneProfile(p), nil
}

// releaseSlot deletes a replaced credential unless a job that can still run
// pins it, including paused jobs.
func (e *Engine) releaseSlot(st *state, slot string) {
	for _, j := range st.doc.Jobs {
		if j.Profile.secretSlot() == slot && !terminal(j.State) {
			return
		}
	}
	_ = e.secrets.Delete(slot)
}

func (e *Engine) DeleteProfile(id string) error {
	if err := checkID(id); err != nil {
		return err
	}
	e.writeMu.Lock()
	defer e.writeMu.Unlock()
	if err := e.ready(); err != nil {
		return err
	}
	doc := e.cur.Load().doc
	p, ok := doc.Profiles[id]
	if !ok {
		return errors.New("上游不存在")
	}
	slots := map[string]bool{}
	if p.HasKey {
		slots[p.secretSlot()] = true
	}
	for _, j := range doc.Jobs {
		if j.Request.ProfileID == id {
			if !terminal(j.State) {
				return errors.New("上游仍有未结束任务，请先取消任务")
			}
			if j.Profile.HasKey {
				slots[j.Profile.secretSlot()] = true
			}
		}
	}
	// Remove secrets before metadata. A partial keychain failure is surfaced and
	// metadata stays available so the user can retry cleanup or save a fresh key.
	for slot := range slots {
		if err := e.secrets.Delete(slot); err != nil {
			return errors.New("清理系统凭据失败，请重试")
		}
	}
	_, err := e.updateLocked(func(t *tx) error {
		t.deleteProfile(id)
		for _, other := range t.doc.Profiles {
			if other.FallbackProfileID == id {
				other.FallbackProfileID = ""
				other.UpdatedAt = now()
				t.putProfile(other)
			}
		}
		t.retireProfile(id)
		return nil
	})
	return err
}

// DuplicateProfile copies an upstream, including its key, under a new ID.
func (e *Engine) DuplicateProfile(id string) (Profile, error) {
	e.writeMu.Lock()
	defer e.writeMu.Unlock()
	if err := e.ready(); err != nil {
		return Profile{}, err
	}
	src, ok := e.cur.Load().doc.Profiles[id]
	if !ok {
		return Profile{}, errors.New("上游不存在")
	}
	p := cloneProfile(src)
	p.ID = NewID()
	p.Name = truncateUTF8(src.Name+" · 副本", 160)
	p.CredentialID, p.HasKey, p.VerifiedAt = "", false, ""
	p.CreatedAt, p.UpdatedAt = now(), now()
	slot := ""
	if src.HasKey {
		key, err := e.secrets.Get(src.secretSlot())
		if err != nil || key == "" {
			return Profile{}, errors.New("系统凭据复制失败，上游配置未复制")
		}
		slot = NewID()
		if err := e.secrets.Set(slot, key); err != nil {
			return Profile{}, errors.New("系统凭据复制失败，上游配置未复制")
		}
		p.CredentialID, p.HasKey = slot, true
	}
	if _, err := e.updateLocked(func(t *tx) error { t.putProfile(p); return nil }); err != nil {
		if slot != "" {
			_ = e.secrets.Delete(slot)
		}
		return Profile{}, err
	}
	return cloneProfile(p), nil
}

// ImportProfiles adds upstreams the classic editor kept in its own storage.
// It is idempotent: known and previously deleted IDs are skipped, so it can
// run on every start. legacyKey reads a profile's key from where the classic
// editor stored it; the key is copied into a new slot and the original is
// left in place. Entries that fail validation are skipped, not fatal.
func (e *Engine) ImportProfiles(incoming []Profile, legacyKey func(id string) (string, error)) (int, error) {
	if len(incoming) > 1000 {
		return 0, errors.New("一次最多导入 1000 个上游")
	}
	e.writeMu.Lock()
	defer e.writeMu.Unlock()
	if err := e.ready(); err != nil {
		return 0, err
	}
	doc := e.cur.Load().doc
	known := map[string]bool{}
	for id := range doc.Profiles {
		known[id] = true
	}
	for _, id := range doc.RetiredProfileIDs {
		known[id] = true
	}
	fresh := []Profile{}
	slots := []string{}
	for _, p := range incoming {
		p.CredentialID, p.HasKey, p.VerifiedAt = "", false, ""
		if known[p.ID] || p.Validate() != nil {
			continue
		}
		known[p.ID] = true
		if legacyKey != nil {
			if key, err := legacyKey(p.ID); err == nil && strings.TrimSpace(key) != "" && len(key) <= 8192 {
				slot := NewID()
				if e.secrets.Set(slot, strings.TrimSpace(key)) == nil {
					p.CredentialID, p.HasKey = slot, true
					slots = append(slots, slot)
				}
			}
		}
		if p.CreatedAt == "" {
			p.CreatedAt = now()
		}
		p.UpdatedAt = now()
		fresh = append(fresh, p)
	}
	if len(fresh) == 0 {
		return 0, nil
	}
	_, err := e.updateLocked(func(t *tx) error {
		for _, p := range fresh {
			if _, ok := t.doc.Profiles[p.FallbackProfileID]; !ok && !slices.ContainsFunc(fresh, func(f Profile) bool { return f.ID == p.FallbackProfileID }) {
				p.FallbackProfileID = ""
			}
			t.putProfile(p)
		}
		return nil
	})
	if err != nil {
		for _, slot := range slots {
			_ = e.secrets.Delete(slot)
		}
		return 0, err
	}
	return len(fresh), nil
}

// Profiles lists upstreams in creation order without building a snapshot.
func (e *Engine) Profiles() ([]Profile, error) {
	if err := e.failure(); err != nil {
		return nil, err
	}
	list := sortedValues(e.cur.Load().doc.Profiles, cloneProfile, func(a, b Profile) bool {
		if a.CreatedAt != b.CreatedAt {
			return a.CreatedAt < b.CreatedAt
		}
		return a.ID < b.ID
	})
	return list, nil
}

// ProfileKey returns the saved key of an upstream, or "" when it has none.
// The classic editor sends keys with its own requests and needs to read them.
func (e *Engine) ProfileKey(id string) (string, error) {
	p, ok := e.cur.Load().doc.Profiles[id]
	if !ok {
		return "", errors.New("上游不存在")
	}
	if !p.HasKey {
		return "", nil
	}
	key, err := e.secrets.Get(p.secretSlot())
	if err != nil {
		return "", errors.New("无法读取系统中的 API Key")
	}
	return key, nil
}

func (e *Engine) TestProfile(ctx context.Context, id string) ([]string, error) {
	p, ok := e.cur.Load().doc.Profiles[id]
	if !ok {
		return nil, errors.New("上游不存在")
	}
	if !p.HasKey {
		return nil, errors.New("请先保存 API Key")
	}
	key, err := e.secrets.Get(p.secretSlot())
	if err != nil || key == "" {
		return nil, errors.New("无法读取系统中的 API Key")
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	names, err := e.provider.Models(ctx, p, key)
	if err != nil {
		return nil, err
	}
	err = e.update(func(t *tx) error {
		// Record success only for the configuration that was tested.
		if current, ok := t.doc.Profiles[id]; ok && current.connection() == p.connection() && current.CredentialID == p.CredentialID {
			current.VerifiedAt = now()
			t.putProfile(current)
		}
		return nil
	})
	return names, err
}

// Network returns the proxy settings used for upstream requests. A new
// database follows the system proxy, like the classic editor.
func (e *Engine) Network() NetworkSettings {
	n := e.cur.Load().doc.Network
	if n.ProxyMode == "" {
		n.ProxyMode = client.ProxyModeSystem
	}
	return n
}

// SetNetwork changes the proxy settings. Running requests keep their
// connection; later requests use the new settings.
func (e *Engine) SetNetwork(n NetworkSettings) (NetworkSettings, error) {
	if err := n.Validate(); err != nil {
		return NetworkSettings{}, err
	}
	err := e.update(func(t *tx) error {
		if t.doc.Network != n {
			t.setNetwork(n)
		}
		return nil
	})
	if err != nil {
		return NetworkSettings{}, err
	}
	return n, nil
}

func truncateUTF8(s string, limit int) string {
	if len(s) <= limit {
		return s
	}
	cut := limit
	for cut > 0 && !utf8.RuneStart(s[cut]) {
		cut--
	}
	return s[:cut]
}
