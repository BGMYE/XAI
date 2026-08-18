package backend

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

const (
	appUpdateProbePathEnv = "IMAGE_STUDIO_APP_UPDATE_PROBE_PATH"
	appUpdateProbeQuitEnv = "IMAGE_STUDIO_APP_UPDATE_PROBE_QUIT"
)

type AppUpdateProbeResult struct {
	AppVersion          string `json:"appVersion,omitempty"`
	CurrentVersion      string `json:"currentVersion,omitempty"`
	LatestVersion       string `json:"latestVersion,omitempty"`
	ReleaseTag          string `json:"releaseTag,omitempty"`
	ReleaseURL          string `json:"releaseURL,omitempty"`
	IgnoredReleaseTag   string `json:"ignoredReleaseTag,omitempty"`
	UpdateInfoAvailable bool   `json:"updateInfoAvailable"`
	HasUpdate           bool   `json:"hasUpdate"`
	ShouldShowUpdate    bool   `json:"shouldShowUpdate"`
	AppUpdateModalOpen  bool   `json:"appUpdateModalOpen"`
	CapturedAt          string `json:"capturedAt,omitempty"`
}

func (s *Service) WriteAppUpdateProbe(result AppUpdateProbeResult) error {
	path := strings.TrimSpace(os.Getenv(appUpdateProbePathEnv))
	if path == "" {
		path = commandLineArgValue(os.Args[1:], appUpdateProbePathArg)
	}
	if path == "" {
		return nil
	}
	absPath, err := filepath.Abs(path)
	if err != nil {
		return err
	}
	result.CapturedAt = time.Now().UTC().Format(time.RFC3339Nano)
	data, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(absPath), secureDirMode); err != nil {
		return err
	}
	if err := os.WriteFile(absPath, append(data, '\n'), secureFileMode); err != nil {
		return err
	}
	quitRequested := strings.TrimSpace(os.Getenv(appUpdateProbeQuitEnv)) != "" || commandLineBoolFlag(os.Args[1:], appUpdateProbeQuitArg)
	if quitRequested && s.ctx != nil {
		go func() {
			time.Sleep(150 * time.Millisecond)
			runtime.Quit(s.ctx)
		}()
	}
	return nil
}
