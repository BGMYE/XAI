package client

import (
	"context"
	"encoding/json"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPromptModesPreserveUserIntent(t *testing.T) {
	prompt := "  两只狐狸，招牌写着“早安”\n只改变天空。  "
	for _, mode := range []string{"", "verbatim", "assisted"} {
		raw, err := BuildPayload(Options{Prompt: prompt, PromptMode: mode})
		if err != nil {
			t.Fatal(err)
		}
		payload := mustDecodePayload(t, raw)
		content := payload["input"].([]any)[0].(map[string]any)["content"].([]any)
		if content[0].(map[string]any)["text"] != prompt {
			t.Fatal("user text was changed")
		}
		if payload["tool_choice"].(map[string]any)["type"] != "image_generation" {
			t.Fatal("image tool must remain forced")
		}
		instructions := payload["instructions"].(string)
		if mode == "assisted" {
			if !strings.Contains(instructions, "exact requested text, subjects, counts, identities, and all edit constraints") {
				t.Fatal("assisted mode lost constraints")
			}
		} else if !strings.Contains(instructions, "VERBATIM") {
			t.Fatal("default must remain verbatim")
		}
	}
}

func TestImagesJSONOnlyCapabilityDoesNotInjectCompatFields(t *testing.T) {
	var payload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Error(err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"data":[{"b64_json":"aW1hZ2U="}]}`)
	}))
	defer server.Close()
	_, err := RequestImagesAPI(context.Background(), Options{APIKey: "test", Prompt: "cat", BaseURL: server.URL, DisableImageStreaming: true}, io.Discard, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"stream", "partial_images", "response_format"} {
		if _, exists := payload[field]; exists {
			t.Errorf("unexpected %s in JSON-only request", field)
		}
	}
}

func TestMultipartKeepsAllReferencesOrderedAndConfirmedFidelity(t *testing.T) {
	dir := t.TempDir()
	paths := []string{filepath.Join(dir, "one.png"), filepath.Join(dir, "two.png")}
	for i, path := range paths {
		if err := os.WriteFile(path, append(append([]byte{}, fakePNG...), byte(i)), 0600); err != nil {
			t.Fatal(err)
		}
	}
	body, contentType, err := buildEditsMultipart(paths, "", "edit", "gpt-image-2", "1024x1024", "high", "png", "auto", 100, "high", "auto", "", "", 0, RequestPolicyOpenAI, 1, false, editsMultipartOptions{InputFidelitySupported: true, DisableStreaming: true})
	if err != nil {
		t.Fatal(err)
	}
	_, params, err := mime.ParseMediaType(contentType)
	if err != nil {
		t.Fatal(err)
	}
	reader := multipart.NewReader(body, params["boundary"])
	var names []string
	fields := map[string]string{}
	for {
		part, err := reader.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		data, err := io.ReadAll(part)
		if err != nil {
			t.Fatal(err)
		}
		if part.FileName() != "" {
			if part.FormName() != "image[]" {
				t.Fatalf("mixed reference field %q", part.FormName())
			}
			names = append(names, part.FileName())
		} else {
			fields[part.FormName()] = string(data)
		}
	}
	if strings.Join(names, ",") != "one.png,two.png" {
		t.Fatalf("references reordered or lost: %v", names)
	}
	if fields["input_fidelity"] != "high" {
		t.Fatal("confirmed fidelity omitted")
	}
	if _, exists := fields["stream"]; exists {
		t.Fatal("JSON-only edit still streamed")
	}
}

func TestCapabilityValidationDoesNotDropEditInputs(t *testing.T) {
	unsupported := false
	maxRefs := 1
	for _, opts := range []Options{
		{Prompt: "edit", MaskB64: "mask"},
		{Prompt: "edit", ImageDataURLs: []string{"ref"}, MaskB64: "mask", ModelCapabilities: &ImageModelCapabilities{SupportsMask: &unsupported}},
		{Prompt: "edit", ImageDataURLs: []string{"ref1", "ref2"}, ModelCapabilities: &ImageModelCapabilities{MaxInputImages: &maxRefs}},
		{Prompt: "edit", APIMode: APIModeImages, ImageDataURLs: []string{"ref"}},
		{Prompt: "cat", APIMode: APIModeImages, PromptMode: "assisted"},
		{Prompt: "cat", Quality: "high", ModelCapabilities: &ImageModelCapabilities{Qualities: []string{"low"}}},
	} {
		if err := ValidateImageRequest(opts); err == nil {
			t.Errorf("unsupported request accepted: %+v", opts)
		}
	}
	raw, err := BuildPayload(Options{Prompt: "edit", ImageDataURLs: []string{"ref1", "ref2"}, MaskB64: "mask", ModelCapabilities: &ImageModelCapabilities{}})
	if err != nil {
		t.Fatal(err)
	}
	payload := mustDecodePayload(t, raw)
	content := payload["input"].([]any)[0].(map[string]any)["content"].([]any)
	if len(content) != 3 || content[1].(map[string]any)["image_url"] != "ref1" || content[2].(map[string]any)["image_url"] != "ref2" {
		t.Fatal("references changed")
	}
	if payload["tools"].([]any)[0].(map[string]any)["input_image_mask"] == nil {
		t.Fatal("mask silently dropped")
	}
}

func TestConfiguredFidelityRequiresConfirmation(t *testing.T) {
	supported := true
	for _, tc := range []struct {
		model string
		rule  *ImageModelCapabilities
		want  bool
	}{
		{"gpt-image-1", nil, true},
		{"gpt-image-2", nil, false},
		{"gpt-image-1", &ImageModelCapabilities{}, false},
		{"gpt-image-2", &ImageModelCapabilities{SupportsInputFidelity: &supported}, true},
	} {
		raw, err := BuildPayload(Options{Prompt: "edit", ImageDataURLs: []string{"ref"}, ImageModelID: tc.model, InputFidelity: "high", ModelCapabilities: tc.rule})
		if err != nil {
			t.Fatal(err)
		}
		tool := mustDecodePayload(t, raw)["tools"].([]any)[0].(map[string]any)
		_, sent := tool["input_fidelity"]
		if sent != tc.want {
			t.Errorf("model %s fidelity sent=%v, want %v", tc.model, sent, tc.want)
		}
	}
}
