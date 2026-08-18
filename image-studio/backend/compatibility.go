package backend

import (
	"time"

	compat "image-studio/shared/compat"
)

func compatibilityStatePath() (string, error) {
	root, err := platformStableDataRoot()
	if err != nil {
		return "", err
	}
	return compat.StatePath(root), nil
}

func (s *Service) CompatibilityStatePath() (string, error) {
	return compatibilityStatePath()
}

func (s *Service) LoadCompatibilityState() (compat.State, error) {
	path, err := compatibilityStatePath()
	if err != nil {
		return compat.State{}, err
	}
	return compat.Load(path)
}

func (s *Service) SaveCompatibilityState(state compat.State) error {
	path, err := compatibilityStatePath()
	if err != nil {
		return err
	}
	state.Client = "webview2"
	if state.UpdatedAt <= 0 {
		state.UpdatedAt = time.Now().UnixMilli()
	}
	if err := compat.Save(path, state); err != nil {
		return err
	}
	s.syncCompatibilitySettings(state)
	return nil
}
