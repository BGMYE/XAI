package backend

import (
	"errors"
	"time"
)

func (s *StudioV2) DeleteJob(id string) error {
	e, err := s.core()
	if err != nil {
		return err
	}
	return e.DeleteJob(id)
}
func (s *StudioV2) TrashProject(id string) error {
	e, err := s.core()
	if err != nil {
		return err
	}
	return e.TrashProject(id)
}
func (s *StudioV2) RestoreProject(id string) error {
	e, err := s.core()
	if err != nil {
		return err
	}
	return e.RestoreProject(id)
}
func (s *StudioV2) TrashAsset(id string) error {
	e, err := s.core()
	if err != nil {
		return err
	}
	return e.TrashAsset(id)
}
func (s *StudioV2) RestoreAsset(id string) error {
	e, err := s.core()
	if err != nil {
		return err
	}
	return e.RestoreAsset(id)
}
func (s *StudioV2) ArchiveJobs(days int) (string, error) {
	if days < 1 || days > 36500 {
		return "", errors.New("归档天数须为 1–36500")
	}
	e, err := s.core()
	if err != nil {
		return "", err
	}
	path, _, err := e.ArchiveJobs(time.Now().Add(-time.Duration(days) * 24 * time.Hour))
	return path, err
}
