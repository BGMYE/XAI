package studio

import (
	"context"
	"errors"
	"time"
)

func (e *Engine) runWithPolicy(ctx context.Context, j Job, key string, ref *Output, checkpoint Checkpoint) (Output, error) {
	remaining := max(0, min(j.Request.UnsentRetries, 10))
	for {
		out, err := e.runner.Run(ctx, j, key, ref, checkpoint)
		if err == nil {
			return out, nil
		}
		err = redactError(err, key)
		var unsent *NotSentError
		current, ok := e.Job(j.ID)
		if !errors.As(err, &unsent) || ctx.Err() != nil || !ok || current.State != "running" || current.RemoteID != "" || current.ResultURL != "" {
			return out, err
		}
		if remaining > 0 {
			remaining--
			if err = wait(ctx, 15*time.Second); err != nil {
				return Output{}, &NotSentError{Reason: err.Error()}
			}
			continue
		}
		if j.FallbackProfile == nil || j.Profile.ID == j.FallbackProfile.ID {
			return Output{}, err
		}
		backup := *j.FallbackProfile
		backupKey, keyErr := e.secrets.Get(backup.secretSlot())
		if keyErr != nil || backupKey == "" {
			return Output{}, &NotSentError{Reason: "备用上游密钥不可用；请求未发出"}
		}
		if err = e.switchProfile(ctx, j.ID, backup); err != nil {
			return Output{}, err
		}
		j.Profile, key = backup, backupKey
	}
}
