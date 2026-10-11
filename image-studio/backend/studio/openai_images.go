package studio

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"strings"

	"github.com/yuanhua/image-gptcodex/pkg/client"
)

// runOpenAIImage generates an image through go-cli, the request path the
// classic editor uses. The Images API response is streamed (for Responses API
// profiles, the image tool's event stream), which keeps relays such as
// Cloudflare from cutting long generations off with a 524 timeout.
//
// Exactly one request is sent. go-cli's automatic retries are not used: a
// retried generation may be billed twice.
func (p *HTTPProvider) runOpenAIImage(ctx context.Context, j Job, key string, reference *Output, media *http.Client, checkpoint Checkpoint) (Output, error) {
	if err := validateImageCapabilities(j.Profile, j.Request); err != nil {
		return Output{}, &NotSentError{Reason: err.Error()}
	}
	generation, err := newClient(j.Profile, p.network(), generationRequest)
	if err != nil {
		return Output{}, &NotSentError{Reason: "网络代理设置无效：" + err.Error()}
	}
	defer closeClient(generation)
	size := strings.TrimSpace(j.Request.Parameters.Size)
	if size == "" {
		size = "auto"
	}
	opts := client.Options{
		APIKey:                  key,
		Prompt:                  j.Request.Prompt,
		PromptMode:              j.Request.Parameters.PromptMode,
		Mode:                    client.ModeGenerate,
		Size:                    size,
		OutputFormat:            "png",
		BaseURL:                 j.Profile.BaseURL,
		ImageModelID:            j.Profile.ImageModel,
		TextModelID:             j.Profile.TextModel,
		ReasoningEffort:         j.Profile.ReasoningEffort,
		APIMode:                 client.APIModeImages,
		RequestPolicy:           client.RequestPolicy(j.Profile.RequestPolicy),
		ImagesNewAPICompat:      j.Profile.ImagesNewAPICompat,
		AllowInsecureConnection: j.Profile.AllowInsecure,
		HTTPClient:              generation,
		DeferURLDownload:        true,
		ModelCapabilities:       profileClientModelCapabilities(j.Profile),
		DisableImageStreaming:   imageStreamingDisabled(j.Profile),
	}
	image := j.Request.Image
	opts.Quality, opts.Seed, opts.NegativePrompt = image.Quality, image.Seed, image.NegativePrompt
	if opts.Quality == "" {
		opts.Quality = j.Request.Parameters.Quality
	}
	opts.Background, opts.OutputCompression, opts.InputFidelity = image.Background, image.OutputCompression, image.InputFidelity
	if opts.InputFidelity == "" {
		opts.InputFidelity = j.Request.Parameters.InputFidelity
	}
	opts.ImageStyle, opts.Moderation, opts.UserIdentifier = image.ImageStyle, image.Moderation, image.UserIdentifier
	opts.DisablePreview, opts.PartialImages = image.DisablePreview, image.PartialImages
	if image.OutputFormat != "" {
		opts.OutputFormat = image.OutputFormat
	} else if j.Request.Parameters.OutputFormat != "" {
		opts.OutputFormat = j.Request.Parameters.OutputFormat
	}
	if opts.PartialImages == 0 {
		opts.PartialImages = client.DefaultPartialImages
	}
	opts.ResponsesTransport = client.ResponsesTransport(j.Profile.ResponsesTransport)
	responses := j.Profile.ImageAPI == responsesImageAPI
	if responses {
		opts.APIMode = client.APIModeResponses
	}
	refs := []Output{}
	if reference != nil {
		refs = append(refs, *reference)
	}
	for _, id := range j.Request.ReferenceAssetIDs {
		if p.ReadReference == nil {
			return Output{}, &NotSentError{Reason: "素材库不可用"}
		}
		ref, err := p.ReadReference(id)
		if err != nil {
			return Output{}, &NotSentError{Reason: err.Error()}
		}
		refs = append(refs, ref)
	}
	if j.Request.MaskAssetID != "" {
		if p.ReadReference == nil {
			return Output{}, &NotSentError{Reason: "素材库不可用"}
		}
		mask, err := p.ReadReference(j.Request.MaskAssetID)
		if err != nil {
			return Output{}, &NotSentError{Reason: err.Error()}
		}
		if len(refs) == 0 {
			return Output{}, &NotSentError{Reason: "蒙版编辑需要对应的主参考图"}
		}
		if err := validateImageMask(&refs[0], &mask); err != nil {
			return Output{}, &NotSentError{Reason: err.Error()}
		}
		opts.MaskB64 = base64.StdEncoding.EncodeToString(mask.Data)
	}
	for i := range refs {
		reference := &refs[i]
		opts.Mode = client.ModeEdit
		if responses {
			opts.ImageDataURLs = append(opts.ImageDataURLs, "data:"+referenceMIME(reference)+";base64,"+base64.StdEncoding.EncodeToString(reference.Data))
		} else {
			path, err := p.referenceFile(reference)
			if err != nil {
				return Output{}, &NotSentError{Reason: "参考图片无法写入临时文件"}
			}
			defer os.Remove(path)
			opts.ImagePaths = append(opts.ImagePaths, path)
		}
	}

	ctx, mayHaveSent := connected(ctx)
	raw := &tailBuffer{limit: 256 << 10}
	defer func() {
		if p.OnDiagnostic != nil {
			p.OnDiagnostic(j.ID, redact(raw.String(), key))
		}
	}()
	onPartial := func(partial client.PartialImage) {
		_ = checkpoint(Progress{Percent: 60})
		if p.OnPreview != nil {
			p.OnPreview(j.ID, partial)
		}
	}
	var result client.ImageResult
	if responses {
		result, err = client.RequestResponsesOnce(ctx, opts, raw, nil, onPartial)
	} else {
		result, err = client.RequestImagesAPIWithPartial(ctx, opts, raw, nil, onPartial)
	}
	out := Output{ResponseID: result.ResponseID, RequestID: result.RequestID, Usage: result.Usage, Status: result.Status, RevisedPrompt: result.RevisedPrompt}
	var generationErr error
	if err != nil {
		generationErr = generationError(ctx, err, mayHaveSent() || (responses && j.Profile.ResponsesTransport == "websocket" && !client.SafeToRetry(err)), raw.String())
		if result.Status == "failed" || result.Status == "incomplete" {
			var uncertain *UncertainError
			if errors.As(generationErr, &uncertain) {
				generationErr = errors.New(err.Error() + "（未自动重试）")
			}
		}
	}
	finals := result.Images
	// Older non-stream adapters may still supply only the legacy single image.
	if len(finals) == 0 && result.SourceEvent != "partial" && (result.ImageB64 != "" || result.URL != "") {
		finals = []client.GeneratedImage{{ImageB64: result.ImageB64, URL: result.URL, RevisedPrompt: result.RevisedPrompt, Source: "final"}}
	}
	urls := []string{}
	downloads := []ResultDownload{}
	for i := range finals {
		if finals[i].OutputIndex == nil {
			index := i
			finals[i].OutputIndex = &index
		}
		item := finals[i]
		if item.Source != "partial" && item.ImageB64 == "" && item.URL != "" {
			if !validResultURL(item.URL) {
				return out, errors.New("上游返回的图片地址无效")
			}
			urls = append(urls, item.URL)
			downloads = append(downloads, ResultDownload{URL: item.URL, ItemID: item.ItemID, OutputIndex: item.OutputIndex, RevisedPrompt: item.RevisedPrompt})
		}
	}
	if len(urls) > 0 {
		if err := checkpoint(Progress{ResultURLs: urls, ResultDownloads: downloads}); err != nil {
			return out, &UncertainError{}
		}
	}
	var downloadErr error
	for _, item := range finals {
		if item.Source == "partial" {
			continue
		}
		var image Output
		var imageErr error
		if item.ImageB64 != "" {
			image, imageErr = p.decodeBase64(item.ImageB64)
		} else if item.URL != "" {
			image, imageErr = p.fetchMedia(ctx, media, j.Profile, item.URL, 0)
			imageErr = expiredLink(imageErr)
		} else {
			continue
		}
		if imageErr != nil {
			if downloadErr == nil {
				downloadErr = imageErr
			}
			continue
		}
		image.RevisedPrompt, image.ItemID, image.OutputIndex = item.RevisedPrompt, item.ItemID, item.OutputIndex
		image.Width, image.Height = item.Width, item.Height
		out.Images = append(out.Images, image)
	}
	if generationErr != nil {
		return out, generationErr
	}
	if downloadErr != nil {
		return out, downloadErr
	}
	if result.Status == "uncertain" {
		return out, &UncertainError{}
	}
	if len(out.Images) == 0 {
		return out, errors.New("上游未返回完整图片；未自动重试")
	}
	return out, nil
}

// generationError classifies a failed generation by what is known to have
// happened. No connection: certainly not accepted, safe to send again. A
// final answer from the upstream (a 4xx rejection, an error event, or a
// response that completed without an image): a plain failure that explains
// why. Anything else may have been accepted and billed, so it is uncertain;
// that includes a stream that simply stopped, even after preview frames.
func generationError(ctx context.Context, err error, mayHaveSent bool, raw string) error {
	if !mayHaveSent {
		return &NotSentError{Reason: describeSendFailure(ctx, err)}
	}
	if errors.Is(err, context.Canceled) || errors.Is(ctx.Err(), context.Canceled) {
		// Cancelled by the user or by closing the app; the engine decides.
		return context.Canceled
	}
	var status *client.HTTPStatusError
	switch {
	case ctx.Err() != nil:
		return &UncertainError{}
	case errors.As(err, &status):
		if status.StatusCode >= 500 {
			return &UncertainError{}
		}
		return errors.New("上游拒绝了请求：" + status.Error())
	case finalAnswer(raw):
		return errors.New(client.DescribeProblem(raw) + "（未自动重试）")
	}
	return &UncertainError{}
}

// finalAnswer reports whether a response body is the upstream's last word on
// a generation: a complete JSON document, or an event stream that reported an
// error or finished. A stream that stops without either, as when a relay loses
// its own upstream and ends the response, says nothing about the outcome.
func finalAnswer(raw string) bool {
	events := false
	for ev := range client.IterEvents(raw) {
		events = true
		if _, ok := ev["error"].(map[string]any); ok {
			return true
		}
		kind, _ := ev["type"].(string)
		switch {
		case kind == "error",
			strings.HasSuffix(kind, ".failed"),
			strings.HasSuffix(kind, ".incomplete"),
			strings.HasSuffix(kind, ".cancelled"),
			kind == "response.completed",
			kind == "response.done",
			kind == "image_generation.completed",
			kind == "image_edit.completed":
			return true
		}
	}
	if events {
		return false
	}
	var document any
	return json.Unmarshal([]byte(strings.TrimSpace(raw)), &document) == nil && document != nil
}

// referenceFile writes a reference image where the multipart encoder can
// stream it from. The caller removes it.
func (p *HTTPProvider) referenceFile(reference *Output) (string, error) {
	dir := p.MediaDir
	if dir == "" {
		dir = os.TempDir()
	}
	f, err := os.CreateTemp(dir, ".incoming-reference-*"+referenceExtension(reference))
	if err != nil {
		return "", err
	}
	if _, err = f.Write(reference.Data); err == nil {
		err = f.Chmod(0600)
	}
	if closeErr := f.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		_ = os.Remove(f.Name())
		return "", err
	}
	return f.Name(), nil
}

func referenceMIME(reference *Output) string {
	mime := http.DetectContentType(reference.Data)
	if _, ok := mediaExtensions[mime]; ok && strings.HasPrefix(mime, "image/") {
		return mime
	}
	return "image/png"
}

// referenceExtension lets go-cli label the upload with the right type.
func referenceExtension(reference *Output) string {
	switch referenceMIME(reference) {
	case "image/jpeg":
		return ".jpg"
	case "image/webp":
		return ".webp"
	default:
		return ".png"
	}
}

// tailBuffer keeps the last limit bytes written. Generation streams carry
// large preview images; only the end, where errors are reported, is kept.
type tailBuffer struct {
	limit int
	buf   []byte
}

func (t *tailBuffer) Write(b []byte) (int, error) {
	t.buf = append(t.buf, b...)
	if len(t.buf) > 2*t.limit {
		// Trimming to the limit only after doubling keeps writes amortized O(1).
		t.buf = append(t.buf[:0], t.buf[len(t.buf)-t.limit:]...)
	}
	return len(b), nil
}

func (t *tailBuffer) String() string {
	if len(t.buf) > t.limit {
		return string(t.buf[len(t.buf)-t.limit:])
	}
	return string(t.buf)
}
