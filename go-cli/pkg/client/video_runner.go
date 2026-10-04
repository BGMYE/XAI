package client

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"regexp"
	"strings"
)

// VideoRunner performs independent operations. The caller owns durable state
// and must persist an ID/result URL before querying or downloading it.
type VideoRunner struct{ Options VideoOptions }

var videoIDPattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$`)

func (v VideoRunner) endpoint(id string) (string, error) {
	o := v.Options
	base, err := ValidateAPIBaseURL(o.BaseURL, o.AllowInsecureConnection)
	if err != nil {
		return "", err
	}
	if id != "" && !videoIDPattern.MatchString(id) {
		return "", errors.New("invalid video id")
	}
	if o.EndpointPath != "" {
		return videoEndpoint(base, o.EndpointPath, id)
	}
	path := "videos"
	if id != "" {
		path += "/" + id
	} else if o.Protocol == "xai" {
		path += "/generations"
	}
	return OpenAIAPIEndpoint(base, path), nil
}

func (v VideoRunner) request(ctx context.Context, method, endpoint, contentType string, body io.Reader) (*http.Response, error) {
	if strings.TrimSpace(v.Options.APIKey) == "" {
		return nil, ErrEmptyAPIKey
	}
	req, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+v.Options.APIKey)
	req.Header.Set("User-Agent", UserAgent())
	req.Header.Set("Accept", "application/json")
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	c := *videoHTTPClient(v.Options.HTTPClient)
	c.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	if method == http.MethodPost {
		return doGeneration(&c, req)
	}
	return c.Do(req)
}

func (v VideoRunner) Create(ctx context.Context) (VideoResult, error) {
	o := v.Options
	if o.Protocol != "" && o.Protocol != "openai" && o.Protocol != "xai" {
		return VideoResult{}, errors.New("unknown video protocol")
	}
	if strings.TrimSpace(o.VideoModelID) == "" || strings.TrimSpace(o.Prompt) == "" {
		return VideoResult{}, errors.New("video model and prompt are required")
	}
	endpoint, err := v.endpoint("")
	if err != nil {
		return VideoResult{}, err
	}
	body, contentType, err := buildVideoMultipart(o)
	if err != nil {
		return VideoResult{}, err
	}
	if o.Protocol == "xai" {
		fields := map[string]any{"model": o.VideoModelID, "prompt": o.Prompt}
		if o.Seconds != 0 {
			fields["duration"] = o.Seconds
		}
		if o.AspectRatio != "" {
			fields["aspect_ratio"] = o.AspectRatio
		}
		if o.Resolution != "" {
			fields["resolution"] = o.Resolution
		}
		if len(o.InputReference) > 0 {
			fields["image"] = map[string]string{"url": "data:" + http.DetectContentType(o.InputReference) + ";base64," + base64.StdEncoding.EncodeToString(o.InputReference)}
		}
		b, err := json.Marshal(fields)
		if err != nil {
			return VideoResult{}, err
		}
		body = bytes.NewReader(b)
		contentType = "application/json"
	}
	resp, err := v.request(ctx, http.MethodPost, endpoint, contentType, body)
	if err != nil {
		return VideoResult{}, submissionError(err)
	}
	defer resp.Body.Close()
	result, err := decodeVideoResponse(resp, o.BaseURL, "")
	if err != nil {
		if result.Status == VideoStatusFailed || result.Status == VideoStatusCancelled {
			return result, err
		}
		return result, submissionError(err)
	}
	return result, nil
}

func (v VideoRunner) Query(ctx context.Context, id string) (VideoResult, error) {
	endpoint, err := v.endpoint(id)
	if err != nil {
		return VideoResult{}, err
	}
	resp, err := v.request(ctx, http.MethodGet, endpoint, "", nil)
	if err != nil {
		return VideoResult{}, err
	}
	defer resp.Body.Close()
	return decodeVideoResponse(resp, v.Options.BaseURL, id)
}

// Download fetches authenticated /content only. Redirects are returned to the
// caller so it can apply its media policy without forwarding the bearer key.
func (v VideoRunner) Download(ctx context.Context, id string) (*http.Response, error) {
	endpoint, err := v.endpoint(id)
	if err != nil {
		return nil, err
	}
	return v.request(ctx, http.MethodGet, endpoint+"/content", "", nil)
}
