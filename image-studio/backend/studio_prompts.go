package backend

import "image-studio/backend/studio"

// Wails exposes these methods on the existing StudioV2 binding.
func (s *StudioV2) SavePromptCard(p studio.PromptCard) (studio.PromptCard, error) {
	e, err := s.core()
	if err != nil {
		return studio.PromptCard{}, err
	}
	return e.SavePromptCard(p)
}
func (s *StudioV2) DeletePromptCard(id string, revision int64) error {
	e, err := s.core()
	if err != nil {
		return err
	}
	return e.DeletePromptCard(id, revision)
}
func (s *StudioV2) ImportPromptCards(cards []studio.PromptCard) ([]studio.PromptCard, error) {
	e, err := s.core()
	if err != nil {
		return nil, err
	}
	return e.ImportPromptCards(cards)
}
