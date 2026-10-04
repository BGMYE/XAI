package backend

import (
	"context"
	"image-studio/backend/studio"
	"strings"
	"testing"
)

func TestStartJobRejectsWhenConcurrencyLimitReached(t *testing.T) {
	svc := NewService()
	svc.Startup(context.Background())
	svc.studio = openStudioV2(t, &memoryAPIKeyStore{values: map[string]string{}})
	svc.jobs["existing"] = &job{apiMode: "responses", done: make(chan struct{})}
	svc.runningByAPIMode["responses"] = 1

	_, err := svc.Generate(GenerateOptions{
		ProfileID:        "test",
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

func TestCancelledClassicPreparationCannotSubmit(t *testing.T) {
	svc := NewService()
	ctx, cancel := context.WithCancel(context.Background())
	svc.ctx = ctx
	svc.studio = openStudioV2(t, &memoryAPIKeyStore{values: map[string]string{}})
	_, err := svc.studio.SaveProfile(studio.Profile{ID: "test", Name: "test", BaseURL: "https://example.com", Protocol: "openai", ImageModel: "gpt-image-1"}, "key")
	if err != nil {
		t.Fatal(err)
	}
	cancel()
	if _, err = svc.Generate(GenerateOptions{ProfileID: "test", Prompt: "test", RequestedJobID: "cancelled-preparation"}); err == nil {
		t.Fatal("cancelled request accepted")
	}
	snapshot, err := svc.studio.GetSnapshot()
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Jobs) != 0 {
		t.Fatal("cancelled preparation reached durable queue")
	}
}
