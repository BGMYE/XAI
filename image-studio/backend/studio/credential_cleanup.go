package studio

import (
	"errors"
	"slices"
	"time"
)

// PendingCredentialIDs is a durable retirement journal, never a copy of a key.
// A candidate stays here while a live profile or resumable job pins its slot,
// and after a failed keychain deletion. Successful deletion is acknowledged
// only in a later database commit; repeating Delete after a crash is harmless.
func (t *tx) queueCredential(slot string) {
	if slot == "" || slices.Contains(t.doc.PendingCredentialIDs, slot) {
		return
	}
	t.doc.PendingCredentialIDs = append(slices.Clone(t.doc.PendingCredentialIDs), slot)
	t.touch(colSettings, "credentialCleanup", false)
}

func (t *tx) forgetCredential(slot string) {
	if !slices.Contains(t.doc.PendingCredentialIDs, slot) {
		return
	}
	t.doc.PendingCredentialIDs = slices.DeleteFunc(slices.Clone(t.doc.PendingCredentialIDs), func(id string) bool { return id == slot })
	t.touch(colSettings, "credentialCleanup", false)
}

func credentialSlots(j Job) []string {
	slots := []string{}
	if j.Profile.HasKey {
		slots = append(slots, j.Profile.secretSlot())
	}
	if j.FallbackProfile != nil && j.FallbackProfile.HasKey {
		slots = append(slots, j.FallbackProfile.secretSlot())
	}
	return slots
}

// Called before writing a transition, including job removal. This guarantees
// the last metadata reference cannot disappear before retirement is durable.
func (t *tx) recordRetiredCredentials(before document) {
	if t.cloned[colProfiles] {
		for id, p := range before.Profiles {
			next, exists := t.doc.Profiles[id]
			if p.HasKey && (!exists || !next.HasKey || p.secretSlot() != next.secretSlot()) {
				t.queueCredential(p.secretSlot())
			}
		}
	}
	if !t.cloned[colJobs] {
		return
	}
	for id, old := range before.Jobs {
		next, exists := t.doc.Jobs[id]
		retired := !exists || (!terminal(old.State) && terminal(next.State))
		nextSlots := credentialSlots(next)
		for _, slot := range credentialSlots(old) {
			if retired || !slices.Contains(nextSlots, slot) {
				t.queueCredential(slot)
			}
		}
	}
}

func pinnedCredentials(d document) map[string]bool {
	pins := map[string]bool{}
	for _, p := range d.Profiles {
		if p.HasKey {
			pins[p.secretSlot()] = true
		}
	}
	for _, j := range d.Jobs {
		if terminal(j.State) {
			continue
		}
		for _, slot := range credentialSlots(j) {
			pins[slot] = true
		}
	}
	return pins
}

// cleanupCredentialsLocked is best effort. Failed deletes retain their durable
// IDs and are retried on later mutations, periodically, and after restart.
// Caller holds writeMu, preventing a slot from being repinned while deleted.
func (e *Engine) cleanupCredentialsLocked() {
	d := e.cur.Load().doc
	if len(d.PendingCredentialIDs) == 0 {
		return
	}
	pins := pinnedCredentials(d)
	deleted := []string{}
	for _, slot := range d.PendingCredentialIDs {
		if pins[slot] {
			continue
		}
		if e.secrets.Delete(slot) == nil {
			deleted = append(deleted, slot)
		}
	}
	if len(deleted) == 0 {
		return
	}
	// Do not recursively collect. If this acknowledgement write fails, the
	// existing journal safely retries these idempotent deletions later.
	_, _ = e.commitLocked(func(t *tx) error {
		for _, slot := range deleted {
			t.forgetCredential(slot)
		}
		return nil
	})
}

// reserveCredentialLocked journals a new slot before writing the keychain.
// Until a profile is committed, a crash or failed commit leaves a recoverable
// cleanup candidate, without ever writing the key to the database.
func (e *Engine) reserveCredentialLocked(key string) (string, error) {
	slot := NewID()
	if _, err := e.commitLocked(func(t *tx) error { t.queueCredential(slot); return nil }); err != nil {
		return "", err
	}
	if err := e.secrets.Set(slot, key); err != nil {
		return "", errors.New("系统凭据存储失败；未回退到明文保存")
	}
	return slot, nil
}

// Recover candidates from old databases that predate the retirement journal.
// Nonterminal jobs remain pinned; history/archives never require live keys.
func (e *Engine) recoverCredentialCleanup() error {
	e.writeMu.Lock()
	defer e.writeMu.Unlock()
	_, err := e.updateLocked(func(t *tx) error {
		for _, j := range t.doc.Jobs {
			for _, slot := range credentialSlots(j) {
				t.queueCredential(slot)
			}
		}
		return nil
	})
	return err
}

func (e *Engine) retryCredentialCleanup() {
	defer e.wg.Done()
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			e.writeMu.Lock()
			if e.ready() == nil {
				e.cleanupCredentialsLocked()
			}
			e.writeMu.Unlock()
		case <-e.ctx.Done():
			return
		}
	}
}
