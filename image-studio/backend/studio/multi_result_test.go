package studio

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func resultPNG(t *testing.T, shade uint8) []byte {
	t.Helper()
	im := image.NewNRGBA(image.Rect(0, 0, 2, 3))
	im.SetNRGBA(0, 0, color.NRGBA{R: shade, A: 255})
	var b bytes.Buffer
	if err := png.Encode(&b, im); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func TestAllFinalImagesAndProvenanceAreSaved(t *testing.T) {
	first, second := resultPNG(t, 80), resultPNG(t, 170)
	server, posts := openAIUpstream(t, func(w http.ResponseWriter, r *http.Request, body []byte) {
		if !strings.Contains(string(body), `"quality":"high"`) {
			t.Errorf("studio quality missing: %s", body)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("x-request-id", "request-multi")
		fmt.Fprintf(w, "data: {\"type\":\"response.output_item.done\",\"output_index\":0,\"item\":{\"id\":\"image-1\",\"type\":\"image_generation_call\",\"result\":%q,\"revised_prompt\":\"first revised\"}}\n\n", base64.StdEncoding.EncodeToString(first))
		fmt.Fprintf(w, "data: {\"type\":\"response.completed\",\"response\":{\"id\":\"response-multi\",\"status\":\"completed\",\"usage\":{\"total_tokens\":17},\"output\":[{\"id\":\"image-1\",\"type\":\"image_generation_call\",\"result\":%q},{\"id\":\"image-2\",\"type\":\"image_generation_call\",\"result\":%q,\"revised_prompt\":\"second revised\"}]}}\n\n", base64.StdEncoding.EncodeToString(first), base64.StdEncoding.EncodeToString(second))
	})
	profile := imageProfile(server.URL)
	profile.ImageAPI, profile.TextModel = "responses", "driver"
	e, r := generationEngine(t, profile)
	parent, err := e.Import(resultPNG(t, 20), "parent.png")
	if err != nil {
		t.Fatal(err)
	}
	r.ReferenceAssetID, r.OriginalPrompt, r.ConfirmedPrompt = parent.ID, "original idea", r.Prompt
	r.Parameters.PromptMode, r.Parameters.Quality = "verbatim", "high"
	if _, err := e.Submit(r); err != nil {
		t.Fatal(err)
	}
	j := await(t, e, r.ID, "succeeded")
	if posts.Load() != 1 || len(j.ResultAssetIDs) != 2 || len(j.ResultImages) != 2 || j.ResultAssetID != j.ResultAssetIDs[0] {
		t.Fatalf("results %+v; posts %d", j, posts.Load())
	}
	if j.ResponseID != "response-multi" || j.RequestID != "request-multi" || j.Usage["total_tokens"] != float64(17) {
		t.Fatalf("metadata %+v", j)
	}
	if j.OriginalPrompt != "original idea" || j.ConfirmedPrompt != r.Prompt || j.SentPrompt != r.Prompt || len(j.ParentAssetIDs) != 1 || j.ParentAssetIDs[0] != parent.ID {
		t.Fatalf("prompt/edit provenance %+v", j)
	}
	for _, id := range j.ResultAssetIDs {
		a, ok := e.Asset(id)
		if !ok || a.Width != 2 || a.Height != 3 || a.OriginalWidth != 2 || a.OriginalHeight != 3 {
			t.Fatalf("dimensions %+v", a)
		}
	}
	snapshot, _ := e.Snapshot()
	if got := len(snapshot.Projects[0].Nodes); got != 2 {
		t.Fatalf("canvas nodes=%d", got)
	}
	// Returned snapshots may be edited by callers without mutating durable state.
	j.ResultAssetIDs[0] = "changed"
	j.Usage["total_tokens"] = 0
	fresh, _ := e.Job(r.ID)
	if fresh.ResultAssetIDs[0] == "changed" || fresh.Usage["total_tokens"] != float64(17) {
		t.Fatal("job snapshot aliases stored metadata")
	}
	e.Close()
	reopened, err := Open(e.repo.root, e.secrets, Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	restored, ok := reopened.Job(r.ID)
	if !ok || len(restored.ResultImages) != 2 || restored.ResponseID != "response-multi" || restored.ParentAssetIDs[0] != parent.ID {
		t.Fatalf("generation provenance lost across restart: %+v", restored)
	}
}

func TestFinalBeforeDisconnectIsKeptWithoutClaimingSuccess(t *testing.T) {
	for _, terminal := range []string{"", "failed", "incomplete"} {
		t.Run("terminal-"+terminal, func(t *testing.T) {
			final := base64.StdEncoding.EncodeToString(resultPNG(t, 90))
			server, posts := openAIUpstream(t, func(w http.ResponseWriter, _ *http.Request, _ []byte) {
				w.Header().Set("Content-Type", "text/event-stream")
				fmt.Fprintf(w, "data: {\"type\":\"response.output_item.done\",\"item\":{\"id\":\"final\",\"type\":\"image_generation_call\",\"result\":%q}}\n\n", final)
				if terminal != "" {
					fmt.Fprintf(w, "data: {\"type\":\"response.%s\",\"response\":{\"id\":\"failed-response\",\"status\":%q,\"error\":{\"message\":\"upstream stopped\"}}}\n\n", terminal, terminal)
				}
			})
			profile := imageProfile(server.URL)
			profile.ImageAPI, profile.TextModel = "responses", "driver"
			e, r := generationEngine(t, profile)
			if _, err := e.Submit(r); err != nil {
				t.Fatal(err)
			}
			state := "failed"
			if terminal == "" {
				state = "uncertain"
			}
			j := await(t, e, r.ID, state)
			if posts.Load() != 1 || len(j.ResultAssetIDs) != 1 || j.ResultAssetID == "" {
				t.Fatalf("lost final or resubmitted: %+v posts=%d", j, posts.Load())
			}
		})
	}
}

func TestMultipleResultDownloadsResumeWithoutGeneration(t *testing.T) {
	var recovering atomic.Bool
	first, second := resultPNG(t, 10), resultPNG(t, 30)
	var base string
	server, posts := openAIUpstream(t, func(w http.ResponseWriter, r *http.Request, _ []byte) {
		switch r.URL.Path {
		case "/v1/images/generations":
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprintf(w, `{"data":[{"url":%q,"revised_prompt":"first download"},{"url":%q,"revised_prompt":"second download"}]}`, base+"/first.png", base+"/second.png")
		case "/first.png":
			w.Write(first)
		case "/second.png":
			if !recovering.Load() {
				w.WriteHeader(503)
				return
			}
			w.Write(second)
		}
	})
	base = server.URL
	e, r := generationEngine(t, imageProfile(base))
	if _, err := e.Submit(r); err != nil {
		t.Fatal(err)
	}
	paused := await(t, e, r.ID, "paused")
	if len(paused.ResultURLs) != 2 || len(paused.ResultAssetIDs) != 1 {
		t.Fatalf("incomplete download not saved: %+v", paused)
	}
	recovering.Store(true)
	if err := e.Resume(r.ID); err != nil {
		t.Fatal(err)
	}
	j := await(t, e, r.ID, "succeeded")
	if len(j.ResultImages) != 2 || j.ResultImages[1].RevisedPrompt != "second download" {
		t.Fatalf("download metadata lost on resume: %+v", j.ResultImages)
	}
	snapshot, _ := e.Snapshot()
	if posts.Load() != 1 || len(j.ResultAssetIDs) != 2 || len(snapshot.Projects[0].Nodes) != 2 {
		t.Fatalf("recovery duplicated/lost results: %+v posts=%d", j, posts.Load())
	}
}

func TestPartialIsNeverSavedAsFinal(t *testing.T) {
	final := base64.StdEncoding.EncodeToString(resultPNG(t, 180))
	server, posts := openAIUpstream(t, func(w http.ResponseWriter, _ *http.Request, _ []byte) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprintf(w, "data: {\"type\":\"image_generation.partial_image\",\"b64_json\":%q}\n\n", final)
	})
	e, r := generationEngine(t, imageProfile(server.URL))
	if _, err := e.Submit(r); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	j, err := e.Wait(ctx, r.ID)
	snapshot, _ := e.Snapshot()
	if err != nil || j.State != "uncertain" || len(j.ResultAssetIDs) != 0 || len(snapshot.Assets) != 0 || posts.Load() != 1 {
		t.Fatalf("partial promoted: %+v err=%v", j, err)
	}
}

func TestHeaderOnlyImageIsRejected(t *testing.T) {
	e, _, _ := fixture(t, nil)
	if _, err := e.Import(resultPNG(t, 90)[:16], "broken.png"); err == nil {
		t.Fatal("header-only PNG was accepted as a valid asset")
	}
}
