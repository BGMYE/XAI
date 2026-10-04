package studio

import (
	"context"
	"sync/atomic"
	"testing"
)

func TestQueueFallbackOnlyAfterProvenUnsentFailure(t *testing.T) {
	for _, uncertain := range []bool{false, true} {
		var calls atomic.Int32
		e, p, _ := fixture(t, runFunc(func(_ context.Context, j Job, key string, _ *Output, _ Checkpoint) (Output, error) {
			calls.Add(1)
			if j.Profile.ID == "backup" {
				if key != "backup-key" {
					t.Error("wrong fallback credential")
				}
				return Output{Data: pixel()}, nil
			}
			if uncertain {
				return Output{}, &UncertainError{}
			}
			return Output{}, &NotSentError{Reason: "dial failed"}
		}))
		backup := p
		backup.ID = "backup"
		backup.CredentialID = ""
		if _, err := e.SaveProfile(backup, "backup-key"); err != nil {
			t.Fatal(err)
		}
		p.FallbackProfileID = "backup"
		if _, err := e.SaveProfile(p, ""); err != nil {
			t.Fatal(err)
		}
		r := req("safe-fallback")
		r.AutoFallback = true
		if _, err := e.Submit(r); err != nil {
			t.Fatal(err)
		}
		if uncertain {
			await(t, e, r.ID, "uncertain")
			if calls.Load() != 1 {
				t.Fatal("uncertain request replayed")
			}
		} else {
			j := await(t, e, r.ID, "succeeded")
			if calls.Load() != 2 || j.Profile.ID != "backup" {
				t.Fatal("fallback not pinned")
			}
		}
	}
}
