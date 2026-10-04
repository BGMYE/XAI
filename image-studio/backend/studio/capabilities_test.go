package studio

import (
	"bytes"
	"context"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func capabilityBool(value bool) *bool { return &value }
func capabilityInt(value int) *int    { return &value }

func confirmedCapabilities() *ImageProviderCapabilities {
	return &ImageProviderCapabilities{
		SchemaVersion: 1,
		Images:        &ImagesCapabilities{Generate: capabilityBool(true), Edit: capabilityBool(true), Stream: capabilityBool(false)},
		Responses:     &ResponsesCapabilities{ImageTool: capabilityBool(true), SSE: capabilityBool(true), WebSocket: capabilityBool(false)},
		ModelRules: map[string]ModelProtocolCapabilities{
			"exact-image": {Images: &ImageModelCapabilities{Qualities: []string{"high"}, Sizes: []string{"1024x1024"}, Formats: []string{"png"}, MaxInputImages: capabilityInt(1), SupportsMask: capabilityBool(false)}},
		},
	}
}

func capabilityProfile() Profile {
	return Profile{ID: "capability-profile", Name: "sub2api", Protocol: "openai", ProviderPreset: "sub2api", BaseURL: "https://example.com/v1", ImageModel: "exact-image", TextModel: "text-model", Capabilities: confirmedCapabilities()}
}

func TestCapabilityConfirmationsExpireOnConnectionAndModelChange(t *testing.T) {
	for _, tc := range []struct {
		name   string
		change func(*Profile) string
	}{
		{"key", func(p *Profile) string { return "rotated-secret" }},
		{"address", func(p *Profile) string { p.BaseURL = "https://other.example/v1"; return "same-secret" }},
		{"image model", func(p *Profile) string { p.ImageModel = "other-image"; return "" }},
		{"text model", func(p *Profile) string { p.TextModel = "other-text"; return "" }},
		{"image API", func(p *Profile) string { p.ImageAPI = "responses"; return "" }},
		{"preset", func(p *Profile) string { p.ProviderPreset = "custom"; return "" }},
		{"protocol", func(p *Profile) string { p.Protocol = "xai"; p.ProviderPreset = "custom"; return "" }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			e, _, _ := fixture(t, nil)
			p, err := e.SaveProfile(capabilityProfile(), "same-secret")
			if err != nil {
				t.Fatal(err)
			}
			key := tc.change(&p)
			p, err = e.SaveProfile(p, key)
			if err != nil {
				t.Fatal(err)
			}
			if p.Capabilities != nil {
				t.Fatal("stale capability confirmations retained")
			}
		})
	}
}

func TestCapabilityConfirmationsSurviveRenameButNotCredentialRemoval(t *testing.T) {
	e, _, _ := fixture(t, nil)
	p, err := e.SaveProfile(capabilityProfile(), "same-secret")
	if err != nil {
		t.Fatal(err)
	}
	p.Name = "Renamed"
	p, err = e.SaveProfile(p, "same-secret")
	if err != nil || p.Capabilities == nil {
		t.Fatalf("rename lost capabilities: %v", err)
	}
	p, err = e.ClearProfileKey(p.ID)
	if err != nil || p.Capabilities != nil {
		t.Fatalf("key removal retained capabilities: %v", err)
	}
}

func TestCapabilitiesDoNotAliasSavedOrReturnedProfiles(t *testing.T) {
	e, _, _ := fixture(t, nil)
	input := capabilityProfile()
	saved, err := e.SaveProfile(input, "same-secret")
	if err != nil {
		t.Fatal(err)
	}
	*input.Capabilities.Images.Generate = false
	input.Capabilities.ModelRules["exact-image"].Images.Qualities[0] = "low"
	*saved.Capabilities.Images.Generate = false
	saved.Capabilities.ModelRules["exact-image"].Images.Qualities[0] = "medium"
	profiles, err := e.Profiles()
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range profiles {
		if p.ID != input.ID {
			continue
		}
		if !*p.Capabilities.Images.Generate || p.Capabilities.ModelRules["exact-image"].Images.Qualities[0] != "high" {
			t.Fatal("caller mutated immutable capability state")
		}
		return
	}
	t.Fatal("profile missing")
}

func TestCapabilityRulesAreScopedToExactModelAndAPI(t *testing.T) {
	p := capabilityProfile()
	if rule := profileClientModelCapabilities(p); rule == nil || len(rule.Qualities) != 1 {
		t.Fatal("matching rule missing")
	}
	p.ImageAPI = "responses"
	if rule := profileClientModelCapabilities(p); rule == nil || len(rule.Qualities) != 0 || rule.SupportsInputFidelity != nil {
		t.Fatal("Images capability leaked into Responses")
	}
	p.ImageAPI, p.ImageModel = "images", "exact-image-alias"
	if rule := profileClientModelCapabilities(p); rule == nil || len(rule.Qualities) != 0 {
		t.Fatal("model prefix treated as verified model")
	}
	p.Capabilities = nil
	if rule := profileClientModelCapabilities(p); rule == nil || rule.SupportsInputFidelity != nil {
		t.Fatal("sub2api unknown must not inherit fidelity support")
	}
	encoded, err := json.Marshal(&ImageProviderCapabilities{SchemaVersion: 1, Images: &ImagesCapabilities{}})
	if err != nil || strings.Contains(string(encoded), "generate") {
		t.Fatal("unknown serialized as confirmed capability")
	}
}

func TestKnownCapabilityBoundsRejectBeforeEnqueue(t *testing.T) {
	p := capabilityProfile()
	r := Request{Kind: "image", Parameters: Parameters{Quality: "high", Size: "1024x1024", OutputFormat: "png"}}
	if err := validateImageCapabilities(p, r); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name   string
		change func(*Profile, *Request)
	}{
		{"quality", func(p *Profile, r *Request) { r.Parameters.Quality = "low" }},
		{"size", func(p *Profile, r *Request) { r.Parameters.Size = "auto" }},
		{"format", func(p *Profile, r *Request) { r.Parameters.OutputFormat = "jpeg" }},
		{"reference count", func(p *Profile, r *Request) { r.ReferenceAssetID = "first"; r.ReferenceAssetIDs = []string{"second"} }},
		{"mask", func(p *Profile, r *Request) { r.ReferenceAssetID = "first"; r.MaskAssetID = "mask" }},
		{"generation", func(p *Profile, r *Request) { p.Capabilities.Images.Generate = capabilityBool(false) }},
		{"edit", func(p *Profile, r *Request) {
			r.ReferenceAssetID = "first"
			p.Capabilities.Images.Edit = capabilityBool(false)
		}},
		{"WebSocket", func(p *Profile, r *Request) { p.ImageAPI = "responses"; p.ResponsesTransport = "websocket" }},
		{"image tool", func(p *Profile, r *Request) {
			p.ImageAPI = "responses"
			p.Capabilities.Responses.ImageTool = capabilityBool(false)
		}},
		{"prompt mode", func(p *Profile, r *Request) {
			p.Capabilities.PromptModes = []string{"verbatim"}
			r.Parameters.PromptMode = "assisted"
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			profile, request := cloneProfile(p), r
			tc.change(&profile, &request)
			if err := validateImageCapabilities(profile, request); err == nil {
				t.Fatal("unsupported request allowed")
			}
		})
	}
}

func TestModelDiscoveryDoesNotConfirmImageCapabilitiesOrGenerate(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Method != "GET" || r.URL.Path != "/v1/models" {
			t.Errorf("unexpected paid request: %s %s", r.Method, r.URL.Path)
			http.Error(w, "unexpected", 400)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"id":"exact-image"}]}`))
	}))
	defer server.Close()
	e, _, _ := fixture(t, nil)
	p := capabilityProfile()
	p.BaseURL, p.AllowLocal, p.Capabilities = server.URL+"/v1", true, nil
	p, err := e.SaveProfile(p, "test-key")
	if err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 0 {
		t.Fatal("saving profile made network request")
	}
	models, err := e.TestProfile(context.Background(), p.ID)
	if err != nil || len(models) != 1 {
		t.Fatalf("discovery: %v %v", models, err)
	}
	profiles, err := e.Profiles()
	if err != nil {
		t.Fatal(err)
	}
	for _, current := range profiles {
		if current.ID == p.ID && (current.Capabilities != nil || current.VerifiedAt == "") {
			t.Fatal("discovery certified image capability or failed to record connection")
		}
	}
	if calls.Load() != 1 {
		t.Fatal("model discovery sent multiple requests")
	}
}

func maskPNG(t *testing.T, width, height int, transparent bool) []byte {
	t.Helper()
	im := image.NewNRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			im.SetNRGBA(x, y, color.NRGBA{R: 200, A: 255})
		}
	}
	if transparent {
		im.SetNRGBA(0, 0, color.NRGBA{})
	}
	var b bytes.Buffer
	if err := png.Encode(&b, im); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func TestMaskValidationRequiresMatchingPNGWithTransparentEditRegion(t *testing.T) {
	ref := &Output{Data: maskPNG(t, 2, 2, false)}
	if err := validateImageMask(ref, &Output{Data: maskPNG(t, 2, 2, true)}); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name string
		mask []byte
	}{
		{"wrong dimensions", maskPNG(t, 3, 2, true)},
		{"opaque", maskPNG(t, 2, 2, false)},
		{"not PNG", []byte("not an image")},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if err := validateImageMask(ref, &Output{Data: tc.mask}); err == nil {
				t.Fatal("invalid mask accepted")
			}
		})
	}
}
