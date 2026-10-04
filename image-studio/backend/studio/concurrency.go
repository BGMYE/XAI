package studio

import "context"

// Profile limits apply to submissions from both interfaces; polling and saved
// downloads do not occupy submission capacity.
func profileAvailable(d document, profile Profile, except string) bool {
	if profile.ConcurrencyLimit <= 0 {
		return true
	}
	active := 0
	for id, j := range d.Jobs {
		if id != except && j.State == "running" && j.Profile.ID == profile.ID && j.RemoteID == "" && j.ResultURL == "" {
			active++
		}
	}
	return active < profile.ConcurrencyLimit
}

func (e *Engine) switchProfile(ctx context.Context, id string, p Profile) error {
	if ctx.Err() != nil {
		return &NotSentError{Reason: ctx.Err().Error()}
	}
	return e.update(func(t *tx) error {
		j, ok := t.doc.Jobs[id]
		if !ok || j.State != "running" || j.RemoteID != "" || j.ResultURL != "" {
			return context.Canceled
		}
		// Do not hold one upstream slot while waiting for another: reciprocal
		// fallbacks could deadlock. The user can resubmit this certainly unsent job.
		if !profileAvailable(t.doc, p, id) {
			return &NotSentError{Reason: "备用上游并发已满；请求未发出，请稍后重试"}
		}
		j.Profile = p
		j.UpdatedAt = now()
		t.putJob(j)
		return nil
	})
}
