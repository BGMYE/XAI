package backend

import "image-studio/backend/studio"

// This read-only method cannot access credentials or create generation tasks.
func (s *StudioV2) GetPublicPromptCatalog(sourceID string) (string, error) {
	if _, err := s.core(); err != nil {
		return "", err
	}
	s.mu.Lock()
	ctx := s.ctx
	s.mu.Unlock()
	return studio.FetchPublicCatalog(ctx, sourceID)
}
