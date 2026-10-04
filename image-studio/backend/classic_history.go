package backend

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"image-studio/backend/studio"
)

type ClassicHistoryInput struct {
	Mode          string `json:"mode"`
	RevisedPrompt string `json:"revisedPrompt"`
	ID            string `json:"id"`
	SavedPath     string `json:"savedPath"`
	Prompt        string `json:"prompt"`
	CreatedAt     string `json:"createdAt"`
	Size          string `json:"size"`
	Quality       string `json:"quality"`
	OutputFormat  string `json:"outputFormat"`
}
type ClassicHistoryImport struct {
	ID      string `json:"id"`
	JobID   string `json:"jobId"`
	AssetID string `json:"assetId"`
	Error   string `json:"error,omitempty"`
}

func (s *Service) DeleteGenerationHistory(ids []string) error {
	if len(ids) > 10000 {
		return errors.New("历史记录数量超限")
	}
	e, err := s.sharedEngine()
	if err != nil {
		return err
	}
	return e.DeleteJobs(ids)
}

func (s *Service) ImportClassicHistory(items []ClassicHistoryInput) ([]ClassicHistoryImport, error) {
	if len(items) > 100 {
		return nil, errors.New("每次最多导入 100 条历史")
	}
	e, err := s.sharedEngine()
	if err != nil {
		return nil, err
	}
	results := make([]ClassicHistoryImport, 0, len(items))
	for _, item := range items {
		result := ClassicHistoryImport{ID: item.ID}
		sum := sha256.Sum256([]byte(item.ID))
		id := "legacy-" + hex.EncodeToString(sum[:])
		j, exists := e.Job(id)
		if !exists {
			path, readErr := s.ensureManagedReadablePath(item.SavedPath, managedImageFile)
			if readErr == nil {
				j, readErr = e.ImportHistory(path, studio.Request{ID: id, Source: "classic", ProjectID: "classic", Kind: "image", Prompt: item.Prompt, Parameters: studio.Parameters{Size: item.Size}, Image: studio.ImageParameters{Quality: item.Quality, OutputFormat: item.OutputFormat}}, item.CreatedAt, item.Mode, item.RevisedPrompt)
			}
			if readErr != nil {
				result.Error = readErr.Error()
				results = append(results, result)
				continue
			}
		}
		result.JobID, result.AssetID = j.ID, j.ResultAssetID
		results = append(results, result)
	}
	return results, nil
}
