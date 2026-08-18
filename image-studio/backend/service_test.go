package backend

import (
	"context"
	"strings"
	"testing"
)

func TestStartJobRejectsWhenConcurrencyLimitReached(t *testing.T) {
	svc := NewService()
	svc.Startup(context.Background())
	svc.jobs["existing"] = &job{apiMode: "responses", done: make(chan struct{})}
	svc.runningByAPIMode["responses"] = 1

	_, err := svc.Generate(GenerateOptions{
		APIKey:           "sk-test",
		Prompt:           "a red dot",
		APIMode:          "responses",
		ConcurrencyLimit: 1,
	})
	if err == nil {
		t.Fatal("expected concurrency limit error")
	}
	if !strings.Contains(err.Error(), "并发限制 1") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestStartJobConcurrencyLimitIsPerAPIMode(t *testing.T) {
	svc := NewService()
	svc.Startup(context.Background())
	svc.runningByAPIMode["responses"] = 1

	if !svc.canStartJobLocked("images", 1) {
		t.Fatal("images request should not be blocked by responses jobs")
	}
}

func TestStartJobConcurrencyLimitZeroIsUnlimited(t *testing.T) {
	svc := NewService()
	svc.Startup(context.Background())
	svc.runningByAPIMode["responses"] = 1

	if !svc.canStartJobLocked("responses", 0) {
		t.Fatal("zero concurrency limit should not block")
	}
}
