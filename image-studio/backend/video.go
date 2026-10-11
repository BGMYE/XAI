package backend

import (
	"context"
	"errors"
	"strings"

	"github.com/yuanhua/image-gptcodex/pkg/client"
)

// CreateVideo starts an external video job. Credentials, base URL, and model
// are all explicit; no model discovery or substitution is performed.
func (s *Service) CreateVideo(opts VideoOptions) (VideoResult, error) {
	if s.ctx == nil {
		return VideoResult{}, errors.New("服务未启动")
	}
	return s.createVideo(s.ctx, opts)
}

func (s *Service) createVideo(ctx context.Context, opts VideoOptions) (VideoResult, error) {
	result, err := client.CreateVideo(ctx, client.VideoOptions{
		BaseURL: opts.BaseURL, APIKey: opts.APIKey, VideoModelID: opts.VideoModelID,
		EndpointPath: opts.EndpointPath, Prompt: opts.Prompt, Seconds: opts.Seconds,
		Size: opts.Size, Quality: opts.Quality,
	})
	return videoResult(result), err
}

// PollVideo performs one status poll. Callers can repeat it until status is
// completed, failed, or cancelled; this keeps Wails bindings non-blocking.
func (s *Service) PollVideo(opts VideoPollOptions) (VideoResult, error) {
	if s.ctx == nil {
		return VideoResult{}, errors.New("服务未启动")
	}
	return s.pollVideo(s.ctx, opts)
}

func (s *Service) pollVideo(ctx context.Context, opts VideoPollOptions) (VideoResult, error) {
	result, err := client.PollVideo(ctx, client.VideoPollOptions{
		BaseURL: opts.BaseURL, APIKey: opts.APIKey, VideoID: opts.VideoID,
		EndpointPath: opts.EndpointPath,
	})
	return videoResult(result), err
}

func videoResult(result client.VideoResult) VideoResult {
	return VideoResult{ID: result.ID, Status: strings.ToLower(string(result.Status)), URL: result.URL, B64JSON: result.B64JSON, Error: result.Error}
}
