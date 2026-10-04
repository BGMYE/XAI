package backend

import (
	"errors"

	"image-studio/backend/studio"
)

// CreateVideo submits a durable shared task using the selected upstream.
func (s *Service) CreateVideo(opts VideoOptions) (VideoResult, error) {
	if s.ctx == nil {
		return VideoResult{}, errors.New("服务未启动")
	}
	e, err := s.sharedEngine()
	if err != nil {
		return VideoResult{}, err
	}
	j, err := e.Submit(studio.Request{ID: studio.NewID(), ProfileID: opts.ProfileID, ProjectID: "classic", Source: "classic", Kind: "video", Prompt: opts.Prompt, Parameters: studio.Parameters{Seconds: opts.Seconds, Size: opts.Size, Quality: opts.Quality, EndpointPath: opts.EndpointPath}})
	if err != nil {
		return VideoResult{}, err
	}
	return VideoResult{ID: j.ID, Status: "queued"}, nil
}

// PollVideo performs one status poll. Callers can repeat it until status is
// completed, failed, or cancelled; this keeps Wails bindings non-blocking.
func (s *Service) PollVideo(opts VideoPollOptions) (VideoResult, error) {
	if s.ctx == nil {
		return VideoResult{}, errors.New("服务未启动")
	}
	e, err := s.sharedEngine()
	if err != nil {
		return VideoResult{}, err
	}
	j, ok := e.Job(opts.VideoID)
	if !ok || j.Request.Kind != "video" {
		return VideoResult{}, errors.New("视频任务不存在")
	}
	status := j.State
	if status == "succeeded" {
		status = "completed"
	}
	if status == "running" {
		status = "in_progress"
	}
	if status == "paused" || status == "uncertain" {
		status = "failed"
	}
	r := VideoResult{ID: j.ID, Status: status, Error: j.Error}
	if j.ResultAssetID != "" {
		if a, ok := e.Asset(j.ResultAssetID); ok {
			r.URL = a.URL()
		}
	}
	return r, nil
}
