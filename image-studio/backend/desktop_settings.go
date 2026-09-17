package backend

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	compat "image-studio/shared/compat"
)

// DesktopSettingsService is the single writer of desktop preferences. Workspace
// exports share this lock and merge only their own fields into the document.
type DesktopSettingsService struct {
	mu         sync.Mutex
	svc        *Service
	path       string
	onChanged  func(int64)
	writeState func(string, compat.State) error
}

type DesktopSettingsSnapshot struct {
	Revision        int64            `json:"revision"`
	Profiles        []DesktopProfile `json:"profiles"`
	ActiveProfileID string           `json:"activeProfileId"`
	AIProfileID     string           `json:"aiProfileId"`
	Preferences     compat.Settings  `json:"preferences"`
}

type DesktopProfile struct {
	compat.UpstreamProfile
	HasAPIKey bool `json:"hasAPIKey"`
}

type DesktopCredentialChange struct {
	Action string `json:"action"`
	Value  string `json:"value,omitempty"`
}

type SaveDesktopProfileRequest struct {
	ExpectedRevision int64                   `json:"expectedRevision"`
	Profile          compat.UpstreamProfile  `json:"profile"`
	Credential       DesktopCredentialChange `json:"credential"`
	SetActive        bool                    `json:"setActive"`
}

type ProbeDesktopProfileRequest struct {
	ProfileID  string                  `json:"profileId,omitempty"`
	Draft      compat.UpstreamProfile  `json:"draft"`
	Credential DesktopCredentialChange `json:"credential"`
	ProxyMode  string                  `json:"proxyMode"`
	ProxyURL   string                  `json:"proxyURL"`
}

func NewDesktopSettingsService(svc *Service) *DesktopSettingsService {
	d := &DesktopSettingsService{svc: svc}
	svc.desktopSettings = d
	return d
}

// ConfigureDesktopSettingsEvents configures native events without exposing a
// function-valued method through Wails' service reflection.
func ConfigureDesktopSettingsEvents(d *DesktopSettingsService, callback func(int64)) {
	d.onChanged = callback
}

func (d *DesktopSettingsService) statePath() (string, error) {
	if d.path != "" {
		return d.path, nil
	}
	return compatibilityStatePath()
}

func (d *DesktopSettingsService) loadLocked() (compat.State, error) {
	path, err := d.statePath()
	if err != nil {
		return compat.State{}, err
	}
	return compat.Load(path)
}

func (d *DesktopSettingsService) snapshot(state compat.State) DesktopSettingsSnapshot {
	profiles := make([]DesktopProfile, 0, len(state.Profiles))
	for _, p := range state.Profiles {
		key, _ := d.svc.GetStoredAPIKey("profile:" + p.ID)
		profiles = append(profiles, DesktopProfile{UpstreamProfile: p, HasAPIKey: key != ""})
	}
	preferences := compat.Settings{}
	mergeDesktopPreferences(&preferences, state.Settings)
	return DesktopSettingsSnapshot{Revision: state.DesktopSettingsRevision, Profiles: profiles,
		ActiveProfileID: state.ActiveProfile, AIProfileID: state.AIProfile, Preferences: preferences}
}

func (d *DesktopSettingsService) GetSnapshot() (DesktopSettingsSnapshot, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	s, err := d.loadLocked()
	if err != nil {
		return DesktopSettingsSnapshot{}, err
	}
	return d.snapshot(s), nil
}

// Initialize imports the main window's legacy migration once. A settings window
// never migrates localStorage, creates a workspace, or exports history.
func (d *DesktopSettingsService) Initialize(legacy compat.State) (DesktopSettingsSnapshot, error) {
	return d.change(0, func(s *compat.State) (func() error, error) {
		if s.DesktopSettingsRevision > 0 {
			return nil, nil
		}
		// A missing/cleared WebView store must never erase the durable v2 file.
		if s.UpdatedAt == 0 {
			s.Profiles, s.ActiveProfile, s.AIProfile = legacy.Profiles, legacy.ActiveProfile, legacy.AIProfile
			mergeDesktopPreferences(&s.Settings, legacy.Settings)
		} else if len(s.Profiles) == 0 && len(legacy.Profiles) > 0 {
			s.Profiles, s.ActiveProfile, s.AIProfile = legacy.Profiles, legacy.ActiveProfile, legacy.AIProfile
		}
		return nil, nil
	}, true)
}

func (d *DesktopSettingsService) saveLocked(path string, state compat.State) error {
	if d.writeState != nil {
		return d.writeState(path, state)
	}
	return compat.Save(path, state)
}

func (d *DesktopSettingsService) change(revision int64, mutate func(*compat.State) (func() error, error), initializing bool) (DesktopSettingsSnapshot, error) {
	d.mu.Lock()
	state, err := d.loadLocked()
	if err != nil {
		d.mu.Unlock()
		return DesktopSettingsSnapshot{}, err
	}
	if initializing && state.DesktopSettingsRevision > 0 {
		result := d.snapshot(state)
		d.mu.Unlock()
		return result, nil
	}
	if !initializing && revision != state.DesktopSettingsRevision {
		d.mu.Unlock()
		return DesktopSettingsSnapshot{}, errors.New("SETTINGS_CONFLICT: 设置已在另一窗口更新，请重新载入后保存")
	}
	rollback, err := mutate(&state)
	if err != nil {
		d.mu.Unlock()
		return DesktopSettingsSnapshot{}, err
	}
	state.Settings.Theme = "light"
	state.DesktopSettingsRevision++
	state.UpdatedAt = time.Now().UnixMilli()
	path, err := d.statePath()
	if err == nil {
		err = d.saveLocked(path, state)
	}
	if err != nil {
		if rollback != nil {
			if restoreErr := rollback(); restoreErr != nil {
				d.mu.Unlock()
				return DesktopSettingsSnapshot{}, errors.New("配置保存失败，系统凭据也未能恢复。请重新输入 API Key 后保存")
			}
		}
		d.mu.Unlock()
		return DesktopSettingsSnapshot{}, errors.New("无法保存设置，请检查本地存储权限后重试")
	}
	d.svc.syncCompatibilitySettings(state)
	result := d.snapshot(state)
	callback := d.onChanged
	d.mu.Unlock()
	if callback != nil {
		callback(result.Revision)
	}
	return result, nil
}

func cleanDesktopProfile(p compat.UpstreamProfile) (compat.UpstreamProfile, error) {
	p.Name = strings.TrimSpace(p.Name)
	if p.Name == "" {
		return p, errors.New("请填写配置名称")
	}
	if p.APIMode != "images" && p.APIMode != "responses" {
		return p, errors.New("请选择有效的 API 形态")
	}
	if p.RequestPolicy != "openai" && p.RequestPolicy != "compat" {
		return p, errors.New("请选择有效的请求策略")
	}
	p.BaseURL = strings.TrimRight(strings.TrimSpace(p.BaseURL), "/")
	p.TextModelID, p.ImageModelID, p.VideoModelID = strings.TrimSpace(p.TextModelID), strings.TrimSpace(p.ImageModelID), strings.TrimSpace(p.VideoModelID)
	if p.ResponsesTransport != "websocket" {
		p.ResponsesTransport = "sse"
	}
	if p.ReasoningEffort == "" {
		p.ReasoningEffort = "xhigh"
	}
	if p.ConcurrencyLimit < 0 {
		return p, errors.New("并发数不能小于 0")
	}
	seen := map[string]bool{}
	models := []string{}
	for _, value := range p.ModelIDs {
		value = strings.TrimSpace(value)
		if value != "" && !seen[value] {
			seen[value] = true
			models = append(models, value)
		}
	}
	p.ModelIDs = models
	return p, nil
}

func newDesktopProfileID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("p-%d", time.Now().UnixNano())
	}
	return "p-" + hex.EncodeToString(b)
}

func (d *DesktopSettingsService) SaveProfile(req SaveDesktopProfileRequest) (DesktopSettingsSnapshot, error) {
	return d.change(req.ExpectedRevision, func(s *compat.State) (func() error, error) {
		p, err := cleanDesktopProfile(req.Profile)
		if err != nil {
			return nil, err
		}
		if p.ID == "" {
			p.ID = newDesktopProfileID()
		}
		if _, err = normalizeKeyringUser("profile:" + p.ID); err != nil {
			return nil, errors.New("配置标识无效")
		}
		index := -1
		for i, old := range s.Profiles {
			if old.ID == p.ID {
				index = i
				p.CreatedAt = old.CreatedAt
				break
			}
		}
		if p.CreatedAt == 0 {
			p.CreatedAt = time.Now().UnixMilli()
		}
		rollback, err := d.changeCredential(p.ID, req.Credential)
		if err != nil {
			return nil, err
		}
		if index < 0 {
			s.Profiles = append(s.Profiles, p)
		} else {
			s.Profiles[index] = p
		}
		if req.SetActive || s.ActiveProfile == "" {
			s.ActiveProfile = p.ID
		}
		if s.AIProfile == p.ID && p.APIMode != "responses" {
			s.AIProfile = ""
		}
		return rollback, nil
	}, false)
}

func (d *DesktopSettingsService) changeCredential(id string, change DesktopCredentialChange) (func() error, error) {
	if change.Action == "keep" || change.Action == "" {
		return nil, nil
	}
	if change.Action != "replace" && change.Action != "clear" {
		return nil, errors.New("凭据操作无效")
	}
	if change.Action == "replace" && strings.TrimSpace(change.Value) == "" {
		return nil, errors.New("请填写 API Key")
	}
	user := "profile:" + id
	previous, err := d.svc.GetStoredAPIKey(user)
	if err != nil {
		return nil, errors.New("无法读取系统凭据存储")
	}
	next := change.Value
	if change.Action == "clear" {
		next = ""
	}
	if err = d.svc.SetStoredAPIKey(user, next); err != nil {
		return nil, errors.New("无法写入系统凭据存储，配置未保存")
	}
	return func() error { return d.svc.SetStoredAPIKey(user, previous) }, nil
}

func (d *DesktopSettingsService) DeleteProfile(revision int64, id string) (DesktopSettingsSnapshot, error) {
	return d.change(revision, func(s *compat.State) (func() error, error) {
		found := false
		list := make([]compat.UpstreamProfile, 0, len(s.Profiles))
		for _, p := range s.Profiles {
			if p.ID == id {
				found = true
				continue
			}
			if p.FallbackProfileID == id {
				p.FallbackProfileID = ""
			}
			list = append(list, p)
		}
		if !found {
			return nil, errors.New("配置不存在")
		}
		rollback, err := d.changeCredential(id, DesktopCredentialChange{Action: "clear"})
		if err != nil {
			return nil, err
		}
		s.Profiles = list
		if s.ActiveProfile == id {
			s.ActiveProfile = ""
			if len(list) > 0 {
				s.ActiveProfile = list[0].ID
			}
		}
		if s.AIProfile == id {
			s.AIProfile = ""
		}
		return rollback, nil
	}, false)
}

func (d *DesktopSettingsService) DuplicateProfile(revision int64, id string) (DesktopSettingsSnapshot, error) {
	return d.change(revision, func(s *compat.State) (func() error, error) {
		for _, p := range s.Profiles {
			if p.ID != id {
				continue
			}
			key, err := d.svc.GetStoredAPIKey("profile:" + id)
			if err != nil {
				return nil, errors.New("无法读取系统凭据存储")
			}
			p.ID, p.Name, p.CreatedAt, p.LastUsedAt = newDesktopProfileID(), p.Name+" 副本", time.Now().UnixMilli(), 0
			var rollback func() error
			if key != "" {
				rollback, err = d.changeCredential(p.ID, DesktopCredentialChange{Action: "replace", Value: key})
				if err != nil {
					return nil, err
				}
			}
			s.Profiles = append(s.Profiles, p)
			return rollback, nil
		}
		return nil, errors.New("配置不存在")
	}, false)
}

func (d *DesktopSettingsService) SetProfileRole(revision int64, role, id string) (DesktopSettingsSnapshot, error) {
	return d.change(revision, func(s *compat.State) (func() error, error) {
		for i, p := range s.Profiles {
			if p.ID != id {
				continue
			}
			switch role {
			case "generation":
				s.ActiveProfile = id
				s.Profiles[i].LastUsedAt = time.Now().UnixMilli()
			case "assistant":
				if p.APIMode != "responses" {
					return nil, errors.New("AI 辅助需要 Responses API 配置")
				}
				s.AIProfile = id
			default:
				return nil, errors.New("配置用途无效")
			}
			return nil, nil
		}
		return nil, errors.New("配置不存在")
	}, false)
}

var desktopPreferenceNames = map[string]bool{
	"proxyMode": true, "proxyURL": true, "fontScale": true, "kernelRuntimeMode": true,
	"protectStreamPreview": true, "autoRetryEnabled": true, "autoRetryCount": true,
	"outputDir": true, "savePromptSuppressed": true, "keepLogs": true, "cleanupPreviewCacheOnExit": true,
	"completionSound": true, "completionNotification": true, "ignoredReleaseTag": true, "lastSettingsPane": true,
}

func (d *DesktopSettingsService) PatchPreferences(revision int64, patch map[string]json.RawMessage) (DesktopSettingsSnapshot, error) {
	return d.change(revision, func(s *compat.State) (func() error, error) {
		for name := range patch {
			if !desktopPreferenceNames[name] {
				return nil, errors.New("不支持的设置项")
			}
		}
		data, err := json.Marshal(patch)
		if err != nil {
			return nil, errors.New("设置格式无效")
		}
		if err = json.Unmarshal(data, &s.Settings); err != nil {
			return nil, errors.New("设置值无效")
		}
		if s.Settings.FontScale != 0 && (s.Settings.FontScale < 0.85 || s.Settings.FontScale > 2) {
			return nil, errors.New("字号范围为 85% 至 200%")
		}
		if s.Settings.AutoRetryCount != nil && (*s.Settings.AutoRetryCount < 0 || *s.Settings.AutoRetryCount > 10) {
			return nil, errors.New("重试次数范围为 0 至 10")
		}
		if s.Settings.ProxyMode != "" && s.Settings.ProxyMode != "none" && s.Settings.ProxyMode != "system" && s.Settings.ProxyMode != "custom" {
			return nil, errors.New("代理模式无效")
		}
		if s.Settings.KernelRuntimeMode != "" && s.Settings.KernelRuntimeMode != "auto" && s.Settings.KernelRuntimeMode != "local" && s.Settings.KernelRuntimeMode != "remote" {
			return nil, errors.New("运行内核选项无效")
		}
		if _, ok := patch["outputDir"]; ok {
			d.svc.mu.Lock()
			previous := d.svc.outputDir
			d.svc.mu.Unlock()
			if err = d.svc.SetOutputDir(s.Settings.OutputDir); err != nil {
				return nil, err
			}
			return func() error { return d.svc.SetOutputDir(previous) }, nil
		}
		return nil, nil
	}, false)
}

func (d *DesktopSettingsService) ProbeProfile(req ProbeDesktopProfileRequest) (ProbeUpstreamResult, error) {
	key := strings.TrimSpace(req.Credential.Value)
	if req.Credential.Action == "keep" {
		var err error
		key, err = d.svc.GetStoredAPIKey("profile:" + req.ProfileID)
		if err != nil {
			return ProbeUpstreamResult{}, errors.New("无法读取系统凭据存储")
		}
	} else if req.Credential.Action != "replace" {
		return ProbeUpstreamResult{}, errors.New("请填写 API Key")
	}
	result, err := d.svc.ProbeUpstream(ProbeUpstreamOptions{BaseURL: req.Draft.BaseURL, APIKey: key,
		ProxyMode: req.ProxyMode, ProxyURL: req.ProxyURL, APIMode: req.Draft.APIMode,
		ResponsesTransport: req.Draft.ResponsesTransport, AllowInsecureConnection: req.Draft.AllowInsecureConnection})
	if key != "" {
		result.ResponsesTransportError = strings.ReplaceAll(result.ResponsesTransportError, key, "[已隐藏]")
	}
	if err != nil && key != "" {
		return result, errors.New(strings.ReplaceAll(err.Error(), key, "[已隐藏]"))
	}
	return result, err
}

func mergeDesktopPreferences(dst *compat.Settings, src compat.Settings) {
	dst.ProxyMode, dst.ProxyURL, dst.Theme, dst.FontScale = src.ProxyMode, src.ProxyURL, "light", src.FontScale
	dst.KernelRuntimeMode, dst.ProtectStreamPreview = src.KernelRuntimeMode, src.ProtectStreamPreview
	dst.AutoRetryEnabled, dst.AutoRetryCount = src.AutoRetryEnabled, src.AutoRetryCount
	dst.OutputDir, dst.SavePromptSuppressed, dst.KeepLogs = src.OutputDir, src.SavePromptSuppressed, src.KeepLogs
	dst.CleanupPreviewCacheOnExit, dst.CompletionSound = src.CleanupPreviewCacheOnExit, src.CompletionSound
	dst.CompletionNotification, dst.IgnoredReleaseTag = src.CompletionNotification, src.IgnoredReleaseTag
	dst.LastSettingsPane = src.LastSettingsPane
}

func (d *DesktopSettingsService) saveWorkspace(state compat.State) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	current, err := d.loadLocked()
	if err != nil {
		return err
	}
	if current.DesktopSettingsRevision > 0 {
		state.Profiles, state.ActiveProfile, state.AIProfile = current.Profiles, current.ActiveProfile, current.AIProfile
		state.DesktopSettingsRevision = current.DesktopSettingsRevision
		mergeDesktopPreferences(&state.Settings, current.Settings)
	}
	state.UpdatedAt, state.Client = time.Now().UnixMilli(), "webview2"
	path, err := d.statePath()
	if err != nil {
		return err
	}
	if err = d.saveLocked(path, state); err != nil {
		return err
	}
	d.svc.syncCompatibilitySettings(state)
	return nil
}
