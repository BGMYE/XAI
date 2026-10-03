package studio

import (
	"context"
	"encoding/base64"
	"errors"
	"net/http"
	"net/http/httptrace"
	"os"
	"strings"
	"sync/atomic"

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
	}
	responses := j.Profile.ImageAPI == responsesImageAPI
	if responses {
		opts.APIMode = client.APIModeResponses
	}
	if reference != nil {
		opts.Mode = client.ModeEdit
		if responses {
			opts.ImageDataURLs = []string{"data:" + referenceMIME(reference) + ";base64," + base64.StdEncoding.EncodeToString(reference.Data)}
		} else {
			path, err := p.referenceFile(reference)
			if err != nil {
				return Output{}, &NotSentError{Reason: "参考图片无法写入临时文件"}
			}
			defer os.Remove(path)
			opts.ImagePaths = []string{path}
		}
	}

	var wrote atomic.Bool
	ctx = httptrace.WithClientTrace(ctx, &httptrace.ClientTrace{WroteRequest: func(httptrace.WroteRequestInfo) { wrote.Store(true) }})
	raw := &tailBuffer{limit: 256 << 10}
	onPartial := func(client.PartialImage) { _ = checkpoint(Progress{Percent: 60}) }
	var result client.ImageResult
	if responses {
		result, err = client.RequestAndExtractWithPartial(ctx, &client.NativeTransport{Client: generation}, opts, raw, nil, onPartial)
	} else {
		result, err = client.RequestImagesAPIWithPartial(ctx, opts, raw, nil, onPartial)
	}
	if err != nil {
		return Output{}, generationError(ctx, err, wrote.Load(), raw.String())
	}
	if result.ImageB64 != "" {
		return p.decodeBase64(result.ImageB64)
	}
	if result.URL == "" {
		return Output{}, errors.New("上游未返回图片；没有自动重试")
	}
	return p.imageResult(ctx, media, j.Profile, mediaResult{URL: result.URL}, checkpoint)
}

// generationError classifies a failed generation by what is known to have
// happened. Nothing written: certainly not accepted, safe to send again. An
// answer from the upstream (a 4xx rejection, or a completed response without
// an image): a plain failure that explains why. Anything else after the
// request was written may have been accepted and billed, so it is uncertain.
func generationError(ctx context.Context, err error, wrote bool, raw string) error {
	if !wrote {
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
	case errors.Is(err, client.ErrNoImageInResponse):
		return errors.New(client.DescribeProblem(raw) + "（未自动重试）")
	}
	return &UncertainError{}
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
