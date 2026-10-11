package studio

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type cleanupSecrets struct {
	memorySecrets
	failDeletes atomic.Bool
	failSetKey  string
}

func (s *cleanupSecrets) Delete(id string) error {
	if s.failDeletes.Load() {
		return errors.New("test keychain unavailable")
	}
	return s.memorySecrets.Delete(id)
}
func (s *cleanupSecrets) Set(id, key string) error {
	_ = s.memorySecrets.Set(id, key)
	if key == s.failSetKey {
		return errors.New("test keychain partially wrote")
	}
	return nil
}

func storedCredential(e *Engine, id string) string {
	// A terminal state is published before keychain cleanup finishes. Wait for
	// that transition's write lock before inspecting its cleanup side effect.
	e.writeMu.Lock()
	defer e.writeMu.Unlock()
	key, _ := e.secrets.Get(id)
	return key
}

func TestRotatedCredentialRetiredAfterJobCompletion(t *testing.T) {
	started, finish := make(chan struct{}), make(chan struct{})
	runner := runFunc(func(ctx context.Context, _ Job, key string, _ *Output, _ Checkpoint) (Output, error) {
		if key != "TEST-SECRET-never-persist" {
			t.Error("job did not use its pinned credential")
		}
		close(started)
		select {
		case <-finish:
			return Output{Data: pixel()}, nil
		case <-ctx.Done():
			return Output{}, ctx.Err()
		}
	})
	e, p, _ := fixture(t, runner)
	if _, err := e.Submit(req("rotation")); err != nil {
		t.Fatal(err)
	}
	<-started
	old := p.secretSlot()
	rotated, err := e.SaveProfile(p, "rotated-test-secret")
	if err != nil {
		t.Fatal(err)
	}
	if storedCredential(e, old) == "" {
		t.Fatal("active job lost its credential")
	}
	close(finish)
	await(t, e, "rotation", "succeeded")
	if storedCredential(e, old) != "" {
		t.Fatal("terminal job kept the retired key")
	}
	if err := e.DeleteJob("rotation"); err != nil {
		t.Fatal(err)
	}
	if err := e.DeleteProfile(p.ID); err != nil {
		t.Fatal(err)
	}
	if storedCredential(e, old) != "" || storedCredential(e, rotated.secretSlot()) != "" {
		t.Fatal("profile/history deletion left keys behind")
	}
}

func TestRetirementKeepsPausedPrimaryAndFallbackCredentials(t *testing.T) {
	for _, fallback := range []bool{false, true} {
		name := "primary"
		if fallback {
			name = "fallback"
		}
		t.Run(name, func(t *testing.T) {
			e, p, _ := fixture(t, nil)
			pinned := p.forJob()
			job := Job{ID: "paused", State: "paused", Request: req("paused"), CreatedAt: now(), UpdatedAt: now()}
			if fallback {
				job.FallbackProfile = &pinned
			} else {
				job.Profile = pinned
			}
			if err := e.update(func(tx *tx) error { tx.putJob(job); return nil }); err != nil {
				t.Fatal(err)
			}
			if _, err := e.SaveProfile(p, "new-key"); err != nil {
				t.Fatal(err)
			}
			if storedCredential(e, p.secretSlot()) == "" {
				t.Fatal("paused job's pinned credential was removed")
			}
			e.Close()
			reopened, err := Open(e.repo.root, e.secrets, Options{})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(reopened.Close)
			e = reopened
			if storedCredential(e, p.secretSlot()) == "" {
				t.Fatal("restart discarded a resumable job's credential")
			}
			if err := e.DeleteProfile(p.ID); err == nil {
				t.Fatal("deleted a profile still pinned by resumable work")
			}
			if err := e.Cancel(job.ID); err != nil {
				t.Fatal(err)
			}
			if storedCredential(e, p.secretSlot()) != "" {
				t.Fatal("cancelled job did not release retired credential")
			}
		})
	}
}

func TestRetirementRespectsAnotherCurrentProfile(t *testing.T) {
	e, p, _ := fixture(t, nil)
	shared := p
	shared.ID, shared.Name = "other-profile", "shared credential"
	if err := e.update(func(t *tx) error { t.putProfile(shared); return nil }); err != nil {
		t.Fatal(err)
	}
	if _, err := e.SaveProfile(p, "replacement"); err != nil {
		t.Fatal(err)
	}
	if storedCredential(e, p.secretSlot()) == "" {
		t.Fatal("key still used by another current profile was deleted")
	}
	if err := e.DeleteProfile(shared.ID); err != nil {
		t.Fatal(err)
	}
	if storedCredential(e, p.secretSlot()) != "" {
		t.Fatal("last current profile did not release the retired key")
	}
}

func TestHistoryDeletionAndArchiveRetireLegacySlots(t *testing.T) {
	for _, archive := range []bool{false, true} {
		name := "delete"
		if archive {
			name = "archive"
		}
		t.Run(name, func(t *testing.T) {
			e, p, _ := fixture(t, nil)
			p.CredentialID = "legacy-retired-slot"
			if err := e.secrets.Set(p.CredentialID, "LEGACY-TEST-ONLY"); err != nil {
				t.Fatal(err)
			}
			old := time.Now().Add(-48 * time.Hour).UTC().Format(time.RFC3339Nano)
			j := Job{ID: "legacy-history", State: "succeeded", Profile: p, Request: req("legacy-history"), CreatedAt: old, UpdatedAt: old}
			if err := e.update(func(t *tx) error { t.putJob(j); return nil }); err != nil {
				t.Fatal(err)
			}
			if archive {
				path, count, err := e.ArchiveJobs(time.Now())
				if err != nil || count != 1 {
					t.Fatalf("archive: %s %d %v", path, count, err)
				}
				data, err := os.ReadFile(path)
				if err != nil || strings.Contains(string(data), "LEGACY-TEST-ONLY") {
					t.Fatal("archive leaked a credential")
				}
			} else if err := e.DeleteJob(j.ID); err != nil {
				t.Fatal(err)
			}
			if storedCredential(e, p.CredentialID) != "" {
				t.Fatal("history removal discarded the last cleanup reference")
			}
		})
	}
}

func TestFailedCredentialDeletionPersistsAndRetriesAfterRestart(t *testing.T) {
	secrets := &cleanupSecrets{memorySecrets: memorySecrets{m: map[string]string{}}}
	root := t.TempDir()
	e, err := Open(root, secrets, Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer e.Close()
	p, err := e.SaveProfile(upstream("cleanup"), "OLD-TEST-KEY")
	if err != nil {
		t.Fatal(err)
	}
	secrets.failDeletes.Store(true)
	replacement, err := e.SaveProfile(p, "NEW-TEST-KEY")
	if err != nil {
		t.Fatal(err)
	}
	if err := e.DeleteProfile(p.ID); err != nil {
		t.Fatal(err)
	}
	if !slices.Contains(e.cur.Load().doc.PendingCredentialIDs, p.secretSlot()) || !slices.Contains(e.cur.Load().doc.PendingCredentialIDs, replacement.secretSlot()) {
		t.Fatal("failed keychain deletes were not journaled")
	}
	bytes, err := os.ReadFile(filepath.Join(root, "studio.json"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(bytes), "OLD-TEST-KEY") || strings.Contains(string(bytes), "NEW-TEST-KEY") {
		t.Fatal("journal contains an actual credential")
	}
	e.Close()
	secrets.failDeletes.Store(false)
	reopened, err := Open(root, secrets, Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	if storedCredential(reopened, p.secretSlot()) != "" || storedCredential(reopened, replacement.secretSlot()) != "" || len(reopened.cur.Load().doc.PendingCredentialIDs) != 0 {
		t.Fatal("restart did not retry pending keychain deletion")
	}
}

func TestFailedCredentialDeletionRetriesOnNextMutation(t *testing.T) {
	secrets := &cleanupSecrets{memorySecrets: memorySecrets{m: map[string]string{}}}
	e, err := Open(t.TempDir(), secrets, Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer e.Close()
	p, err := e.SaveProfile(upstream("cleanup"), "TEST-KEY")
	if err != nil {
		t.Fatal(err)
	}
	secrets.failDeletes.Store(true)
	if _, err := e.ClearProfileKey(p.ID); err != nil {
		t.Fatal(err)
	}
	secrets.failDeletes.Store(false)
	if _, err := e.SaveProject(Project{ID: "retry", Name: "retry cleanup", Viewport: Viewport{Zoom: 1}}); err != nil {
		t.Fatal(err)
	}
	if storedCredential(e, p.secretSlot()) != "" || len(e.cur.Load().doc.PendingCredentialIDs) != 0 {
		t.Fatal("later mutation did not retry deletion")
	}
}

func TestUncommittedCredentialSlotIsJournaled(t *testing.T) {
	secrets := &cleanupSecrets{memorySecrets: memorySecrets{m: map[string]string{}}, failSetKey: "PARTIAL-WRITE-KEY"}
	secrets.failDeletes.Store(true)
	root := t.TempDir()
	e, err := Open(root, secrets, Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer e.Close()
	if _, err := e.SaveProfile(upstream("broken"), secrets.failSetKey); err == nil {
		t.Fatal("partial keychain write reported success")
	}
	pending := slices.Clone(e.cur.Load().doc.PendingCredentialIDs)
	if len(pending) != 1 || len(e.cur.Load().doc.Profiles) != 0 {
		t.Fatal("uncommitted key was not safely journaled")
	}
	e.Close()
	secrets.failDeletes.Store(false)
	reopened, err := Open(root, secrets, Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	if storedCredential(reopened, pending[0]) != "" {
		t.Fatal("uncommitted credential survived restart cleanup")
	}
}

func TestImportPartialKeychainFailureKeepsOtherNewCredentials(t *testing.T) {
	secrets := &cleanupSecrets{memorySecrets: memorySecrets{m: map[string]string{}}, failSetKey: "bad-import-key"}
	e, err := Open(t.TempDir(), secrets, Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer e.Close()
	count, err := e.ImportProfiles([]Profile{upstream("first"), upstream("second")}, func(id string) (string, error) {
		if id == "second" {
			return "bad-import-key", nil
		}
		return "valid-import-key", nil
	})
	if err != nil || count != 2 {
		t.Fatalf("import count=%d err=%v", count, err)
	}
	first := e.cur.Load().doc.Profiles["first"]
	if !first.HasKey || storedCredential(e, first.secretSlot()) != "valid-import-key" {
		t.Fatal("later failed import removed an earlier reserved key")
	}
	if e.cur.Load().doc.Profiles["second"].HasKey || len(e.cur.Load().doc.PendingCredentialIDs) != 0 {
		t.Fatal("failed keychain import retained a key or pending cleanup")
	}
}
