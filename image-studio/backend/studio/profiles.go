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
	if exists && (rotate || p.capabilityScope() != old.capabilityScope()) {
		// Permission observations belong to one endpoint, credential and model
		// configuration. Saving or discovering models never confirms them.
		p.Capabilities = nil
	}
	p.CreatedAt = old.CreatedAt
	if !exists || p.CreatedAt == "" {
		p.CreatedAt = now()
	}
	p.UpdatedAt = now()
	slot := ""
	if rotate {
		var err error
		if slot, err = e.reserveCredentialLocked(key); err != nil {
			e.cleanupCredentialsLocked()
			return Profile{}, err
		}
		p.CredentialID = slot
		p.HasKey = true
	}
	_, err := e.updateLocked(func(t *tx) error { t.putProfile(p); t.forgetCredential(slot); return nil })
	if err != nil {
		e.cleanupCredentialsLocked()
		return Profile{}, err
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
	p.HasKey, p.CredentialID, p.VerifiedAt = false, "", ""
	p.Capabilities = nil
	p.UpdatedAt = now()
	_, err := e.updateLocked(func(t *tx) error { t.putProfile(p); return nil })
	if err != nil {
		return Profile{}, err
	}
	return cloneProfile(p), nil
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
	_, ok := doc.Profiles[id]
	if !ok {
		return errors.New("上游不存在")
	}
	for _, j := range doc.Jobs {
		if j.Request.ProfileID == id || j.Profile.ID == id || (j.FallbackProfile != nil && j.FallbackProfile.ID == id) {
			if !terminal(j.State) {
				return errors.New("上游仍有未结束任务，请先取消任务")
			}
		}
	}
	// Commit retirement before touching the keychain. Other current profiles
	// and resumable jobs can still pin shared slots; failures remain journaled.
	_, err := e.updateLocked(func(t *tx) error {
		t.deleteProfile(id)
		for _, j := range t.doc.Jobs {
			if j.Profile.ID == id && j.Profile.HasKey {
				t.queueCredential(j.Profile.secretSlot())
			}
			if j.FallbackProfile != nil && j.FallbackProfile.ID == id && j.FallbackProfile.HasKey {
				t.queueCredential(j.FallbackProfile.secretSlot())
			}
		}
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
	p.Capabilities = nil
	p.CreatedAt, p.UpdatedAt = now(), now()
	slot := ""
	if src.HasKey {
		key, err := e.secrets.Get(src.secretSlot())
		if err != nil || key == "" {
			return Profile{}, errors.New("系统凭据复制失败，上游配置未复制")
		}
		if slot, err = e.reserveCredentialLocked(key); err != nil {
			e.cleanupCredentialsLocked()
			return Profile{}, err
		}
		p.CredentialID, p.HasKey = slot, true
	}
	if _, err := e.updateLocked(func(t *tx) error { t.putProfile(p); t.forgetCredential(slot); return nil }); err != nil {
		e.cleanupCredentialsLocked()
		return Profile{}, err
	}
	return cloneProfile(p), nil
}

// ImportProfiles adds upstreams the classic editor kept in its own storage.
// It is idempotent: known and previously deleted IDs are skipped, so it can
// run on every start. legacyKey reads a profile's key from where the classic
// editor stored it; the key is copied into a new slot and the original is
// left in place. The classic list is replaced by the registry's afterwards, so
// an entry is never dropped for failing validation: see importable.
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
	for _, p := range incoming {
		p.CredentialID, p.HasKey, p.VerifiedAt = "", false, ""
		p.Capabilities = nil
		if known[p.ID] {
			continue
		}
		var ok bool
		if p, ok = importable(p); !ok {
			continue
		}
		known[p.ID] = true
		if legacyKey != nil {
			if key, err := legacyKey(p.ID); err == nil && strings.TrimSpace(key) != "" && len(key) <= 8192 {
				slot, slotErr := e.reserveCredentialLocked(strings.TrimSpace(key))
				if slotErr == nil {
					p.CredentialID, p.HasKey = slot, true
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
			t.forgetCredential(p.CredentialID)
		}
		return nil
	})
	if err != nil {
		e.cleanupCredentialsLocked()
		return 0, err
	}
	return len(fresh), nil
}

// importable returns a classic profile in a form the registry accepts. The
// classic editor stores profiles it cannot use yet, such as an address it
// would refuse to call, and some of its limits are looser. Rather than lose
// such a profile, it is kept as a draft: first without its address, which the
// user re-enters (and with it the key, as for any new address), and failing
// that with only its name and model choices. Only an invalid ID is skipped.
func importable(p Profile) (Profile, bool) {
	if p.Name = truncateUTF8(strings.TrimSpace(p.Name), 160); p.Name == "" {
		p.Name = "未命名上游"
	}
	if p.Validate() == nil {
		return p, true
	}
	p.BaseURL, p.AllowInsecure = "", false
	if p.Validate() == nil {
		return p, true
	}
	model := func(id string) string {
		if id = strings.TrimSpace(id); len(id) <= 200 {
			return id
		}
		return ""
	}
	draft := Profile{
		ID:         p.ID,
		Name:       p.Name,
		Protocol:   "openai",
		ImageModel: model(p.ImageModel),
		VideoModel: model(p.VideoModel),
		TextModel:  model(p.TextModel),
		ModelIDs:   p.ModelIDs,
		CreatedAt:  p.CreatedAt,
	}
	if p.Protocol == "xai" {
		draft.Protocol = "xai"
	}
	if draft.Validate() != nil {
		return Profile{}, false
	}
	return draft, true
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
// It lists only OpenAI-compatible upstreams, so keys of the others, which
// only the Studio uses, are never handed out.
func (e *Engine) ProfileKey(id string) (string, error) {
	p, ok := e.cur.Load().doc.Profiles[id]
	if !ok {
		return "", errors.New("上游不存在")
	}
	if p.Protocol != "openai" {
		return "", errors.New("该上游仅用于新版工作室，经典编辑无法读取其密钥")
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

// ProfileCredentials is used inside Go to resolve a saved profile. Callers
// never combine its key with an address supplied separately by the WebView.
func (e *Engine) ProfileCredentials(id string) (Profile, string, error) {
	p, ok := e.cur.Load().doc.Profiles[id]
	if !ok {
		return Profile{}, "", errors.New("上游不存在")
	}
	key, err := e.secrets.Get(p.secretSlot())
	if err != nil || key == "" {
		return Profile{}, "", errors.New("无法从系统凭据存储读取 API Key")
	}
	return cloneProfile(p), key, nil
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
