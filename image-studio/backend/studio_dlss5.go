package backend

import (
	"context"
	"image-studio/backend/dlss5"
)

// The packaged engine is discovered by XAI. Runtime paths are not a user setting.
func (s *StudioV2) dlss5Context() context.Context {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.ctx != nil {
		return s.ctx
	}
	return context.Background()
}

func (s *StudioV2) ProbeDLSS5() (dlss5.Capabilities, error) {
	e, err := s.core()
	if err != nil {
		return dlss5.Capabilities{}, err
	}
	return e.ProbeDLSS5(s.dlss5Context())
}

func (s *StudioV2) PreviewDLSS5(request dlss5.PreviewRequest) (dlss5.PreviewResult, error) {
	e, err := s.core()
	if err != nil {
		return dlss5.PreviewResult{}, err
	}
	return e.PreviewDLSS5(s.dlss5Context(), request)
}

func (s *StudioV2) CancelDLSS5Preview(id string) error {
	e, err := s.core()
	if err != nil {
		return err
	}
	return e.CancelDLSS5Preview(id)
}

func (s *StudioV2) ApplyDLSS5(jobID string, options dlss5.Options) error {
	e, err := s.core()
	if err != nil {
		return err
	}
	return e.ApplyDLSS5(jobID, options)
}

func (s *StudioV2) RetryDLSS5(jobID string) error {
	e, err := s.core()
	if err != nil {
		return err
	}
	return e.RetryDLSS5(jobID)
}

func (s *StudioV2) CancelDLSS5(jobID string) error {
	e, err := s.core()
	if err != nil {
		return err
	}
	return e.CancelDLSS5(jobID)
}
