package studio

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/yuanhua/image-gptcodex/pkg/client"
)

func (p *HTTPProvider) runVideo(ctx context.Context, j Job, key string, reference *Output, api, media *http.Client, checkpoint Checkpoint) (Output, error) {
	opts := client.VideoOptions{BaseURL: j.Profile.BaseURL, APIKey: key, Protocol: j.Profile.Protocol, VideoModelID: j.Profile.VideoModel,
		Quality: j.Request.Parameters.Quality, EndpointPath: j.Request.Parameters.EndpointPath,
		Prompt: j.Request.Prompt, Seconds: j.Request.Parameters.Seconds, Size: j.Request.Parameters.Size,
		AspectRatio: j.Request.Parameters.AspectRatio, Resolution: j.Request.Parameters.Resolution, AllowInsecureConnection: j.Profile.AllowInsecure, HTTPClient: api}
	if reference != nil {
		opts.InputReference = reference.Data
		opts.InputReferenceName = "reference" + referenceExtension(reference)
	}
	runner := client.VideoRunner{Options: opts}
	id := j.RemoteID
	if id == "" {
		result, err := runner.Create(ctx)
		if err != nil {
			if client.SafeToRetry(err) {
				return Output{}, &NotSentError{Reason: err.Error()}
			}
			var uncertain *client.UncertainSubmissionError
			if errors.As(err, &uncertain) {
				return Output{}, &UncertainError{}
			}
			return Output{}, err
		}
		id = result.ID
		if !validRemoteID(id) {
			return Output{}, &UncertainError{}
		}
		if err = checkpoint(Progress{RemoteID: id, Percent: result.Progress}); err != nil {
			return Output{}, &UncertainError{}
		}
		if result.Status == client.VideoStatusCompleted {
			return p.completedVideo(ctx, j, runner, result, media, checkpoint)
		}
	}
	interval := p.PollInterval
	if interval <= 0 {
		interval = 5 * time.Second
	}
	delay := interval
	for {
		if err := wait(ctx, delay); err != nil {
			return Output{}, err
		}
		result, err := runner.Query(ctx, id)
		if err != nil {
			if ctx.Err() != nil {
				return Output{}, ctx.Err()
			}
			var status *client.HTTPStatusError
			var protocol *client.VideoProtocolError
			if errors.As(err, &protocol) {
				return Output{}, err
			}
			if errors.As(err, &status) && status.StatusCode < 500 && status.StatusCode != 429 {
				return Output{}, err
			}
			if result.Status == client.VideoStatusFailed || result.Status == client.VideoStatusCancelled {
				return Output{}, err
			}
			delay = min(delay*2, 30*time.Second)
			if status != nil && status.RetryAfter != "" {
				if seconds, parseErr := strconv.Atoi(status.RetryAfter); parseErr == nil {
					delay = max(delay, min(time.Duration(max(0, min(seconds, 300)))*time.Second, 5*time.Minute))
				} else if at, parseErr := http.ParseTime(status.RetryAfter); parseErr == nil {
					delay = max(delay, min(time.Until(at), 5*time.Minute))
				}
			}
			continue
		}
		delay = interval
		if err = checkpoint(Progress{RemoteID: id, Percent: result.Progress}); err != nil {
			return Output{}, err
		}
		switch result.Status {
		case client.VideoStatusQueued, client.VideoStatusInProgress:
			continue
		case client.VideoStatusCompleted:
			return p.completedVideo(ctx, j, runner, result, media, checkpoint)
		default:
			return Output{}, errors.New("上游返回未知的视频任务状态，未猜测成功")
		}
	}
}

func (p *HTTPProvider) completedVideo(ctx context.Context, j Job, runner client.VideoRunner, result client.VideoResult, media *http.Client, checkpoint Checkpoint) (Output, error) {
	if result.B64JSON != "" {
		return p.decodeBase64(result.B64JSON)
	}
	if result.URL != "" {
		return p.imageResult(ctx, media, j.Profile, mediaResult{URL: result.URL}, checkpoint)
	}
	if j.Profile.Protocol == "xai" {
		return Output{}, errors.New("上游标记完成，但没有提供视频文件")
	}
	runner.Options.HTTPClient = media
	resp, err := runner.Download(ctx, result.ID)
	if err != nil {
		return Output{}, &ResumeError{}
	}
	if resp.StatusCode >= 300 && resp.StatusCode < 400 {
		location, err := resp.Location()
		resp.Body.Close()
		if err != nil {
			return Output{}, errors.New("视频下载重定向无效")
		}
		return p.imageResult(ctx, media, j.Profile, mediaResult{URL: location.String()}, checkpoint)
	}
	return p.readMedia(resp)
}
