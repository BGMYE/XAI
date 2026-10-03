package studio

import (
	"context"
	"errors"
	"strings"
	"time"
)

// SaveProfile creates or updates an upstream. Credential rotation creates an
// immutable keychain slot first, then commits the pointer, so a failed
// database write cannot change the key used by an existing endpoint.
// Keychain calls run under the write lock: they are rare, and readers are
// never blocked by it.
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
	old := e.cur.Load().doc.Profiles[p.ID]
	if key == "" && old.HasKey && old.BaseURL != p.BaseURL {
		return Profile{}, errors.New("修改上游地址时请重新填写 API Key，避免将旧密钥发送到新地址")
	}
	p.CredentialID = old.CredentialID
	p.HasKey = old.HasKey
	p.VerifiedAt = ""
	p.UpdatedAt = now()
	slot := ""
	if key != "" {
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
	// Retain slots pinned by durable jobs, including paused jobs. Unreferenced
	// replaced slots can be removed without affecting requests already queued.
	if old.HasKey && old.secretSlot() != p.secretSlot() {
		used := false
		for _, j := range st.doc.Jobs {
			if j.Profile.secretSlot() == old.secretSlot() && !terminal(j.State) {
				used = true
				break
			}
		}
		if !used {
			_ = e.secrets.Delete(old.secretSlot())
		}
	}
	return p, nil
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
	slots := map[string]bool{p.secretSlot(): true}
	for _, j := range doc.Jobs {
		if j.Request.ProfileID == id {
			if !terminal(j.State) {
				return errors.New("上游仍有未结束任务，请先取消任务")
			}
			slots[j.Profile.secretSlot()] = true
		}
	}
	// Remove secrets before metadata. A partial keychain failure is surfaced and
	// metadata stays available so the user can retry cleanup or save a fresh key.
	for slot := range slots {
		if slot != "" {
			if err := e.secrets.Delete(slot); err != nil {
				return errors.New("清理系统凭据失败，请重试")
			}
		}
	}
	_, err := e.updateLocked(func(t *tx) error { t.deleteProfile(id); return nil })
	return err
}

func (e *Engine) TestProfile(ctx context.Context, id string) ([]string, error) {
	p, ok := e.cur.Load().doc.Profiles[id]
	if !ok {
		return nil, errors.New("上游不存在")
	}
	key, err := e.secrets.Get(p.secretSlot())
	if err != nil || key == "" {
		return nil, errors.New("无法读取系统中的 API Key")
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	names, err := (&HTTPProvider{}).Models(ctx, p, key)
	if err != nil {
		return nil, err
	}
	err = e.update(func(t *tx) error {
		// Record success only for the exact configuration that was tested.
		if current, ok := t.doc.Profiles[id]; ok && current.UpdatedAt == p.UpdatedAt && current.CredentialID == p.CredentialID {
			current.VerifiedAt = now()
			t.putProfile(current)
		}
		return nil
	})
	return names, err
}
