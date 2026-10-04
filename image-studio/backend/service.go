// Package backend exposes the GUI-facing bindings for the Wails app.
// All gptcodex-specific logic lives in github.com/yuanhua/image-gptcodex/pkg/client;
// this package only wires it into Wails (context, events, file dialogs).
//
// File layout:
//
//	service.go   — Service struct, lifecycle, generation orchestration (Generate / Edit / Cancel)
//	types.go     — JSON-bound structs shared with the TS frontend
//	dialogs.go   — file picker / save / open URL / read image / import-export history
//	imports.go   — drag-drop / paste import + filename sanitisation
//	imageops.go  — rotate / flip / crop on disk via Go image stdlib
//	paths.go     — output / import dir resolution + filename helpers
//	open.go      — cross-platform "open in OS" shell-out
package backend

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/wailsapp/wails/v2/pkg/runtime"
	"github.com/yuanhua/image-gptcodex/pkg/client"
)

// Service is the Wails-bound struct. Methods on it are exposed to the frontend
// via runtime/window/bindings.
type Service struct {
	studio *StudioV2
	ctx    context.Context

	thumbMu                   sync.Mutex
	mu                        sync.Mutex
	jobs                      map[string]*job
	runningByAPIMode          map[string]int
	outputDir                 string // 用户自定义输出目录;空时回退到 defaultOutputDir()
	keepLogs                  bool
	cleanupPreviewCacheOnExit bool
	apiKeys                   apiKeyStore

	trustedOutputRoots map[string]struct{}
	mediaAssets        map[string]mediaAsset

	promptImportListenerReady       bool
	pendingPromptImportTokens       []string
	pendingPromptImportInvalidCount int
}

type job struct {
	cancel  context.CancelFunc
	done    chan struct{}
	apiMode string
}

// NewService constructs a fresh Service ready to be passed to wails.Run Bind.
func NewService() *Service {
	return &Service{
		jobs:               map[string]*job{},
		runningByAPIMode:   map[string]int{},
		apiKeys:            keyringAPIKeyStore{},
		trustedOutputRoots: map[string]struct{}{},
		mediaAssets:        map[string]mediaAsset{},
	}
}

// Startup is wired into wails.Options OnStartup; persists the runtime context.
func (s *Service) Startup(ctx context.Context) {
	s.ctx = ctx
	s.loadCompatibilitySettings()
	s.HandlePromptImportArgs(os.Args[1:])
	if strings.TrimSpace(os.Getenv(appUpdateProbePathEnv)) != "" || commandLineArgValue(os.Args[1:], appUpdateProbePathArg) != "" {
		go s.captureAppUpdateProbe()
	}
}

func (s *Service) captureAppUpdateProbe() {
	appVersion, err := currentDesktopAppVersion()
	if err != nil || strings.TrimSpace(appVersion) == "" {
		appVersion = defaultAppVersion
	}
	result := AppUpdateProbeResult{
		AppVersion:          appVersion,
		CurrentVersion:      appVersion,
		UpdateInfoAvailable: false,
		HasUpdate:           false,
		ShouldShowUpdate:    false,
		AppUpdateModalOpen:  false,
	}
	updateInfo, err := s.CheckForAppUpdate()
	if err == nil {
		result.CurrentVersion = updateInfo.CurrentVersion
		result.LatestVersion = updateInfo.LatestVersion
		result.ReleaseTag = updateInfo.ReleaseTag
		result.ReleaseURL = updateInfo.ReleaseURL
		result.UpdateInfoAvailable = true
		result.HasUpdate = updateInfo.HasUpdate
		result.ShouldShowUpdate = updateInfo.HasUpdate
		result.AppUpdateModalOpen = updateInfo.HasUpdate
	}
	_ = s.WriteAppUpdateProbe(result)
}

// resolvedOutputDir 返回当前生效的输出目录:用户自定义优先,否则默认。
// 不存在则尝试创建。
func (s *Service) resolvedOutputDir() (string, error) {
	s.mu.Lock()
	custom := s.outputDir
	s.mu.Unlock()
	if custom != "" {
		if err := os.MkdirAll(custom, secureDirMode); err != nil {
			return "", fmt.Errorf("无法创建输出目录 %s: %w", custom, err)
		}
		s.addTrustedOutputRoot(custom)
		return custom, nil
	}
	root, err := defaultOutputDir()
	if err == nil {
		s.addTrustedOutputRoot(root)
	}
	return root, err
}

// SetOutputDir 由前端调用以应用用户选择的输出目录。空串表示恢复默认。
// 路径会被 MkdirAll 兜底创建;创建失败则不接受。
func (s *Service) SetOutputDir(path string) error {
	if strings.TrimSpace(path) == "" {
		s.mu.Lock()
		s.outputDir = ""
		s.mu.Unlock()
		return nil
	}
	clean, err := filepath.Abs(path)
	if err != nil {
		return fmt.Errorf("路径无效:%w", err)
	}
	if err := os.MkdirAll(clean, secureDirMode); err != nil {
		return fmt.Errorf("无法创建输出目录 %s: %w", clean, err)
	}
	s.mu.Lock()
	s.outputDir = clean
	s.mu.Unlock()
	s.addTrustedOutputRoot(clean)
	return nil
}

// ChooseOutputDir 弹出系统目录选择对话框,选中后立刻应用并返回新路径。
// 用户取消时返回空串(不报错)。
func (s *Service) ChooseOutputDir() (string, error) {
	if s.ctx == nil {
		return "", errors.New("服务未启动")
	}
	chosen, err := runtime.OpenDirectoryDialog(s.ctx, runtime.OpenDialogOptions{
		Title: "选择生成图片的保存目录",
	})
	if err != nil {
		return "", err
	}
	if chosen == "" {
		return "", nil // 用户取消
	}
	if err := s.SetOutputDir(chosen); err != nil {
		return "", err
	}
	return chosen, nil
}

func (s *Service) ChooseDirectory(title string) (string, error) {
	if s.ctx == nil {
		return "", errors.New("服务未启动")
	}
	chosen, err := runtime.OpenDirectoryDialog(s.ctx, runtime.OpenDialogOptions{
		Title: strings.TrimSpace(title),
	})
	if err != nil {
		return "", err
	}
	return chosen, nil
}

func (s *Service) BuildBatchOutputPath(sourcePath, outputDir, prefix string) (string, error) {
	cleanSource := strings.TrimSpace(sourcePath)
	if cleanSource == "" {
		return "", errors.New("源文件不能为空")
	}
	targetRoot := strings.TrimSpace(outputDir)
	if targetRoot == "" {
		targetRoot = filepath.Dir(cleanSource)
	}
	root, err := ensureTargetDirectory(targetRoot)
	if err != nil {
		return "", err
	}
	return uniquePrefixedTargetPath(root, filepath.Base(cleanSource), prefix)
}

// --- Generation entry points -----------------------------------------------

// Generate starts a text-to-image job and returns its ID immediately. Progress
// and final result arrive as Wails events.
func (s *Service) Generate(opts GenerateOptions) (JobStarted, error) {
	opts.Mode = "generate"
	return s.startJob(opts)
}

// Edit starts an image-to-image job. opts.ImagePaths must list one or more
// existing local files (the frontend writes imports/generated PNGs to disk
// so we never push raw base64 across the JSON bridge for large files).
func (s *Service) Edit(opts GenerateOptions) (JobStarted, error) {
	opts.Mode = "edit"
	if len(opts.collectPaths()) == 0 {
		return JobStarted{}, errors.New("edit 模式必须提供至少一张源图片")
	}
	return s.startJob(opts)
}

// OptimizePrompt uses the configured LLM to rewrite the current prompt into a
// cleaner image prompt. If edit source images are provided, they are included
// as visual context. The original prompt is not mutated by the backend.
func (s *Service) OptimizePrompt(opts PromptOptimizeOptions) (string, error) {
	if s.ctx == nil {
		return "", errors.New("服务未启动")
	}
	if opts.ProfileID != "" {
		e, err := s.sharedEngine()
		if err != nil {
			return "", err
		}
		p, key, err := e.ProfileCredentials(opts.ProfileID)
		if err != nil {
			return "", err
		}
		opts.APIKey, opts.BaseURL, opts.TextModelID, opts.AllowInsecureConnection = key, p.BaseURL, p.TextModel, p.AllowInsecure
		n := e.Network()
		opts.ProxyMode, opts.ProxyURL = n.ProxyMode, n.ProxyURL
	}
	if strings.TrimSpace(opts.APIKey) == "" {
		return "", errors.New("API Key 不能为空")
	}
	operation := strings.TrimSpace(opts.Mode)
	if operation != "describe" && strings.TrimSpace(opts.Prompt) == "" {
		return "", errors.New("提示词不能为空")
	}
	if operation == "describe" && len(opts.collectPaths()) == 0 {
		return "", errors.New("图片反推必须提供画布图片")
	}
	baseURL, err := client.ValidateAPIBaseURL(opts.BaseURL, opts.AllowInsecureConnection)
	if err != nil {
		return "", err
	}
	refPaths, cleanup, err := prepareUploadSourcePaths(opts.collectPaths())
	if err != nil {
		return "", err
	}
	defer cleanup()
	modelID := strings.TrimSpace(opts.TextModelID)
	if modelID == "" {
		modelID = client.TextModel
	}
	proxyConfig, err := client.NormalizeProxyConfig(opts.ProxyMode, opts.ProxyURL)
	if err != nil {
		return "", err
	}
	return optimizePromptWithLLM(s.ctx, baseURL, opts.APIKey, modelID, opts.Mode, opts.Prompt, refPaths, proxyConfig, opts.AllowInsecureConnection)
}

// Cancel terminates a running job. Safe to call with unknown IDs.
func (s *Service) Cancel(jobID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if j := s.jobs[jobID]; j != nil {
		j.cancel()
	}
	if e, err := s.sharedEngine(); err == nil {
		if _, exists := e.Job(jobID); exists {
			if err = e.Cancel(jobID); err != nil {
				return err
			}
		}
	}
	return nil
}

// collectPaths merges legacy ImagePath into ImagePaths and drops blanks.
func (o GenerateOptions) collectPaths() []string {
	paths := make([]string, 0, len(o.ImagePaths)+1)
	for _, p := range o.ImagePaths {
		if strings.TrimSpace(p) != "" {
			paths = append(paths, p)
		}
	}
	if strings.TrimSpace(o.ImagePath) != "" {
		paths = append(paths, o.ImagePath)
	}
	return paths
}

// --- Internal job lifecycle ------------------------------------------------

func (s *Service) startJob(opts GenerateOptions) (JobStarted, error) {
	e, err := s.sharedEngine()
	if err != nil {
		return JobStarted{}, err
	}
	if strings.TrimSpace(opts.ProfileID) == "" {
		return JobStarted{}, errors.New("请选择共享上游配置")
	}
	if strings.TrimSpace(opts.Prompt) == "" {
		return JobStarted{}, errors.New("提示词/修改要求不能为空")
	}
	apiMode := normaliseAPIMode(opts.APIMode)
	limit := normaliseConcurrencyLimit(opts.ConcurrencyLimit)
	if s.ctx == nil {
		return JobStarted{}, errors.New("服务未启动")
	}

	s.mu.Lock()
	jobID := strings.TrimSpace(opts.RequestedJobID)
	if jobID == "" {
		var err error
		jobID, err = newJobID()
		if err != nil {
			s.mu.Unlock()
			return JobStarted{}, err
		}
	}
	if _, exists := s.jobs[jobID]; exists {
		s.mu.Unlock()
		return JobStarted{}, fmt.Errorf("job id 已存在,请稍后重试")
	}
	if !s.canStartJobLocked(apiMode, limit) {
		s.mu.Unlock()
		return JobStarted{}, fmt.Errorf("%s 已达到并发限制 %d,请等待当前任务完成后再提交", apiModeLabel(apiMode), limit)
	}
	ctx, cancel := context.WithCancel(s.ctx)
	done := make(chan struct{})
	s.jobs[jobID] = &job{cancel: cancel, done: done, apiMode: apiMode}
	s.runningByAPIMode[apiMode]++
	s.mu.Unlock()

	r, err := s.classicRequest(e, opts, jobID)
	if err == nil {
		// Cancel uses the same lock, so it cannot miss a submission between
		// the context check and publication into the durable queue.
		s.mu.Lock()
		err = ctx.Err()
		if err == nil {
			_, err = e.Submit(r)
		}
		s.mu.Unlock()
	}
	if err != nil {
		cancel()
		s.mu.Lock()
		delete(s.jobs, jobID)
		s.runningByAPIMode[apiMode]--
		s.mu.Unlock()
		close(done)
		return JobStarted{}, err
	}
	go s.runJob(ctx, jobID, opts, done)

	return JobStarted{JobID: jobID}, nil
}

func (s *Service) canStartJobLocked(apiMode string, limit int) bool {
	return limit <= 0 || s.runningByAPIMode[apiMode] < limit
}

func (s *Service) emitError(jobID string, err error) {
	runtime.EventsEmit(s.ctx, "error:"+jobID, ErrorPayload{Message: err.Error()})
}

// emitErrorWithRaw 跟 emitError 一样,但额外带上原始响应日志的绝对路径,
// 前端「查看日志」按钮用它一键打开。请求都没发出去的早期失败走 emitError 即可。
func (s *Service) emitErrorWithRaw(jobID string, err error, rawPath string) {
	abs := rawPath
	if rawPath != "" {
		if a, e := filepath.Abs(rawPath); e == nil {
			abs = a
		}
	}
	runtime.EventsEmit(s.ctx, "error:"+jobID, ErrorPayload{
		Message: err.Error(),
		RawPath: abs,
	})
}

func normaliseAPIMode(mode string) string {
	switch strings.TrimSpace(mode) {
	case string(client.APIModeImages):
		return string(client.APIModeImages)
	default:
		return string(client.APIModeResponses)
	}
}

func normaliseConcurrencyLimit(limit int) int {
	if limit < 0 {
		return 0
	}
	return limit
}

func apiModeLabel(mode string) string {
	if mode == string(client.APIModeImages) {
		return "Images API"
	}
	return "Responses API"
}

func newJobID() (string, error) {
	var b [12]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(b[:]), nil
}
