package backend

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
	"github.com/yuanhua/image-gptcodex/pkg/client"
	"github.com/yuanhua/image-gptcodex/pkg/promptimport"
)

const promptImportEventName = "studio-import-token"
const promptImportInvalidEventName = "studio-import-token-invalid"

var imagePromptsBaseURL = promptimport.DefaultBaseURL

func (s *Service) ImportPromptByToken(token string) (PromptImportPayload, error) {
	ctx := context.Background()
	if s.ctx != nil {
		ctx = s.ctx
	}
	fetchCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	payload, err := promptimport.Fetch(fetchCtx, strings.TrimSpace(token), promptimport.FetchOptions{
		BaseURL:   imagePromptsBaseURL,
		UserAgent: client.UserAgent(),
	})
	if err != nil {
		code := promptimport.ErrorCode(err)
		if code != "" {
			return PromptImportPayload{}, errors.New(string(code))
		}
		return PromptImportPayload{}, err
	}
	result := PromptImportPayload{
		Prompt: PromptImportBilingualText{
			Zh: payload.Prompt.Zh,
			En: payload.Prompt.En,
		},
		AspectRatio:  payload.AspectRatio,
		ResolvedSize: payload.ResolvedSize,
	}
	if payload.NegativePrompt != nil {
		result.NegativePrompt = &PromptImportBilingualText{
			Zh: payload.NegativePrompt.Zh,
			En: payload.NegativePrompt.En,
		}
	}
	return result, nil
}

func (s *Service) GetImagePromptsBaseURL() string {
	return imagePromptsBaseURL
}

func (s *Service) ActivatePromptImportListener() PromptImportActivation {
	s.mu.Lock()
	s.promptImportListenerReady = true
	activation := PromptImportActivation{
		Tokens:       append([]string(nil), s.pendingPromptImportTokens...),
		InvalidCount: s.pendingPromptImportInvalidCount,
	}
	s.pendingPromptImportTokens = nil
	s.pendingPromptImportInvalidCount = 0
	s.mu.Unlock()
	return activation
}

func (s *Service) HandlePromptImportArgs(args []string) {
	token := promptimport.ExtractFirstTokenFromArgs(args)
	if token == "" {
		return
	}
	s.dispatchPromptImportToken(token)
}

func (s *Service) HandlePromptImportURL(rawURL string) {
	token, err := promptimport.ParseTokenFromURL(rawURL)
	if err != nil {
		if promptimport.ErrorCode(err) == promptimport.TokenInvalid {
			s.dispatchPromptImportInvalid()
		}
		return
	}
	s.dispatchPromptImportToken(token)
}

func (s *Service) dispatchPromptImportToken(token string) {
	token = strings.TrimSpace(token)
	if !promptimport.IsValidToken(token) {
		s.dispatchPromptImportInvalid()
		return
	}
	s.focusMainWindow()
	s.mu.Lock()
	ready := s.promptImportListenerReady
	ctx := s.ctx
	if !ready || ctx == nil {
		s.pendingPromptImportTokens = append(s.pendingPromptImportTokens, token)
		s.mu.Unlock()
		return
	}
	s.mu.Unlock()
	runtime.EventsEmit(ctx, promptImportEventName, token)
}

func (s *Service) dispatchPromptImportInvalid() {
	s.focusMainWindow()
	s.mu.Lock()
	ready := s.promptImportListenerReady
	ctx := s.ctx
	if !ready || ctx == nil {
		s.pendingPromptImportInvalidCount++
		s.mu.Unlock()
		return
	}
	s.mu.Unlock()
	runtime.EventsEmit(ctx, promptImportInvalidEventName)
}

func (s *Service) focusMainWindow() {
	if s.ctx == nil {
		return
	}
	runtime.WindowUnminimise(s.ctx)
	runtime.WindowShow(s.ctx)
	runtime.Show(s.ctx)
}
