package studio

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"image"
	"image/png"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestClassicImagePreservesReferencesMaskAndOptionsOverHTTP(t *testing.T) {
	var posts atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		posts.Add(1)
		if r.URL.Path != "/api/v3/images/edits" {
			t.Error(r.URL.Path)
		}
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			t.Error(err)
			w.WriteHeader(400)
			return
		}
		defer r.MultipartForm.RemoveAll()
		for k, want := range map[string]string{"model": "gpt-image-1", "prompt": "edit", "quality": "high", "output_format": "webp", "background": "transparent", "input_fidelity": "high", "seed": "42", "negative_prompt": "blur"} {
			if got := r.FormValue(k); got != want {
				t.Errorf("%s=%s want %s", k, got, want)
			}
		}
		if len(r.MultipartForm.File["image[]"])+len(r.MultipartForm.File["image"]) != 2 || len(r.MultipartForm.File["mask"]) != 1 {
			t.Errorf("files: %+v", r.MultipartForm.File)
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"data":[{"b64_json":%q,"revised_prompt":"edited"}]}`, base64.StdEncoding.EncodeToString(pixel()))
	}))
	defer srv.Close()
	e, p, _ := fixture(t, nil)
	p.Protocol = "openai"
	p.ImageModel = "gpt-image-1"
	p.ImageAPI = "images"
	p.BaseURL = srv.URL + "/api/v3"
	p.AllowLocal = true
	p.RequestPolicy = "compat"
	if _, err := e.SaveProfile(p, "test-key"); err != nil {
		t.Fatal(err)
	}
	a, err := e.Import(pixel(), "reference.png")
	if err != nil {
		t.Fatal(err)
	}
	r := req("classic-http")
	r.Source = "classic"
	r.ProjectID = "classic"
	r.Prompt = "edit"
	r.Parameters.Size = "1024x1024"
	r.ReferenceAssetIDs = []string{a.ID, a.ID}
	var mask bytes.Buffer
	if err := png.Encode(&mask, image.NewNRGBA(image.Rect(0, 0, 1, 1))); err != nil {
		t.Fatal(err)
	}
	maskAsset, err := e.Import(mask.Bytes(), "mask.png")
	if err != nil {
		t.Fatal(err)
	}
	r.MaskAssetID = maskAsset.ID
	r.Image = ImageParameters{Quality: "high", OutputFormat: "webp", Background: "transparent", InputFidelity: "high", Seed: 42, NegativePrompt: "blur"}
	if _, err = e.Submit(r); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	j, err := e.Wait(ctx, r.ID)
	if err != nil || j.State != "succeeded" || posts.Load() != 1 || j.RevisedPrompt != "edited" {
		t.Fatalf("%+v %v posts=%d", j, err, posts.Load())
	}
}
