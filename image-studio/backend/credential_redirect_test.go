package backend

import (
	"context"
	"fmt"
	"image-studio/backend/studio"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

func TestSavedCredentialOperationsDoNotFollowRedirects(t *testing.T) {
	for _, operation := range []string{"probe", "optimize"} {
		t.Run(operation, func(t *testing.T) {
			var redirected atomic.Int32
			target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				redirected.Add(1)
				fmt.Fprint(w, `{"data":[],"output_text":"rewritten"}`)
			}))
			defer target.Close()
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				http.Redirect(w, r, target.URL+"/capture", http.StatusTemporaryRedirect)
			}))
			defer upstream.Close()
			svc := NewService()
			svc.ctx = context.Background()
			svc.studio = openStudioV2(t, &memoryAPIKeyStore{values: map[string]string{}})
			if _, err := svc.studio.SaveProfile(studio.Profile{ID: "saved", Name: "saved", BaseURL: upstream.URL, Protocol: "openai", ImageModel: "gpt-image-1", AllowLocal: true}, "test-only-key"); err != nil {
				t.Fatal(err)
			}
			var err error
			if operation == "probe" {
				_, err = svc.ProbeUpstream(ProbeUpstreamOptions{ProfileID: "saved"})
			} else {
				_, err = svc.OptimizePrompt(PromptOptimizeOptions{ProfileID: "saved", Prompt: "a tree", Mode: "generate"})
			}
			if redirected.Load() != 0 {
				t.Fatalf("authenticated operation followed %d redirects", redirected.Load())
			}
			if err == nil {
				t.Fatal("redirect must not be reported as success")
			}
		})
	}
}
