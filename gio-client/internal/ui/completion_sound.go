package ui

import (
	"encoding/base64"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	sharedCompat "image-studio/shared/compat"
)

const maxCompletionSoundBytes = 256 * 1024

var completionSoundAudioMIMETypes = map[string]string{
	".mp3":  "audio/mpeg",
	".wav":  "audio/wav",
	".ogg":  "audio/ogg",
	".m4a":  "audio/mp4",
	".aac":  "audio/aac",
	".webm": "audio/webm",
}

var playCompletionSoundFunc = playCompletionSound

func shouldPlayCompletionSound(config sharedCompat.CompletionSoundSettings, completedNow int, totalNow int) bool {
	next := normaliseCompletionSoundSettings(&config)
	return next.Enabled && totalNow > 0 && completedNow == totalNow
}

func (a *App) maybePlayCompletionSound(completedNow int, totalNow int) {
	a.mu.Lock()
	config := a.completionSound
	a.mu.Unlock()
	if !shouldPlayCompletionSound(config, completedNow, totalNow) {
		return
	}
	go func() {
		if err := playCompletionSoundFunc(config, false); err != nil {
			a.appendLog("播放完成提示音失败: " + err.Error())
		}
	}()
}

func (a *App) previewCompletionSound() {
	a.mu.Lock()
	config := a.completionSound
	a.mu.Unlock()
	go func() {
		if err := playCompletionSoundFunc(config, true); err != nil {
			a.appendLog("试听完成提示音失败: " + err.Error())
		}
	}()
}

func (a *App) importCompletionSound() {
	path, err := chooseAudioFile()
	if err != nil {
		a.appendLog("选择提示音失败: " + err.Error())
		return
	}
	if strings.TrimSpace(path) == "" {
		return
	}
	name, dataURL, err := importCompletionSoundFile(path)
	if err != nil {
		a.appendLog("导入提示音失败: " + err.Error())
		return
	}
	a.completionSound.Enabled = true
	a.completionSound.Mode = "custom"
	a.completionSound.CustomName = name
	a.completionSound.CustomData = dataURL
	a.appendLog("已导入完成提示音: " + name)
}

func (a *App) resetCompletionSoundCustom() {
	a.completionSound.Mode = "default"
	a.completionSound.CustomName = ""
	a.completionSound.CustomData = ""
	a.appendLog("已恢复默认完成提示音")
}

func importCompletionSoundFile(path string) (string, string, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return "", "", fmt.Errorf("音频文件为空")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", "", err
	}
	if len(data) == 0 {
		return "", "", fmt.Errorf("音频文件为空")
	}
	if len(data) > maxCompletionSoundBytes {
		return "", "", fmt.Errorf("音频文件不能超过 %d KB", maxCompletionSoundBytes/1024)
	}
	mimeType, ok := completionSoundAudioMIMETypes[strings.ToLower(filepath.Ext(path))]
	if !ok {
		return "", "", fmt.Errorf("仅支持 mp3、wav、ogg、m4a、aac、webm 音频")
	}
	return filepath.Base(path), "data:" + mimeType + ";base64," + base64.StdEncoding.EncodeToString(data), nil
}

func playCompletionSound(config sharedCompat.CompletionSoundSettings, force bool) error {
	next := normaliseCompletionSoundSettings(&config)
	if !force && !next.Enabled {
		return nil
	}
	if next.Mode == "custom" && strings.TrimSpace(next.CustomData) != "" {
		return playCustomCompletionSound(next.CustomData)
	}
	return playDefaultCompletionSound()
}

func playDefaultCompletionSound() error {
	switch runtime.GOOS {
	case "darwin":
		if _, err := os.Stat("/System/Library/Sounds/Glass.aiff"); err == nil {
			return exec.Command("afplay", "/System/Library/Sounds/Glass.aiff").Run()
		}
		return exec.Command("osascript", "-e", "beep").Run()
	case "windows":
		return exec.Command("powershell", "-NoProfile", "-Command", "[System.Media.SystemSounds]::Asterisk.Play(); Start-Sleep -Milliseconds 500").Run()
	default:
		if _, err := exec.LookPath("canberra-gtk-play"); err == nil {
			return exec.Command("canberra-gtk-play", "-i", "complete").Run()
		}
		if _, err := exec.LookPath("paplay"); err == nil {
			candidate := "/usr/share/sounds/freedesktop/stereo/complete.oga"
			if _, statErr := os.Stat(candidate); statErr == nil {
				return exec.Command("paplay", candidate).Run()
			}
		}
		return fmt.Errorf("当前系统没有可用的默认提示音播放器")
	}
}

func playCustomCompletionSound(dataURL string) error {
	path, err := writeCompletionSoundDataURLToTemp(dataURL)
	if err != nil {
		return err
	}
	defer os.Remove(path)
	switch runtime.GOOS {
	case "darwin":
		return exec.Command("afplay", path).Run()
	case "windows":
		script := `Add-Type -AssemblyName PresentationCore; $p = New-Object System.Windows.Media.MediaPlayer; $p.Open([Uri]::new($args[0])); $p.Play(); while($p.NaturalDuration.HasTimeSpan -eq $false){Start-Sleep -Milliseconds 100}; Start-Sleep -Milliseconds ([Math]::Max(150, [int]$p.NaturalDuration.TimeSpan.TotalMilliseconds)); $p.Close()`
		return exec.Command("powershell", "-NoProfile", "-Command", script, path).Run()
	default:
		if _, err := exec.LookPath("ffplay"); err == nil {
			return exec.Command("ffplay", "-nodisp", "-autoexit", "-loglevel", "quiet", path).Run()
		}
		if _, err := exec.LookPath("paplay"); err == nil {
			return exec.Command("paplay", path).Run()
		}
		if _, err := exec.LookPath("aplay"); err == nil {
			return exec.Command("aplay", path).Run()
		}
		return fmt.Errorf("当前系统没有可用的自定义提示音播放器")
	}
}

func writeCompletionSoundDataURLToTemp(dataURL string) (string, error) {
	idx := strings.Index(dataURL, ",")
	if !strings.HasPrefix(dataURL, "data:") || idx < 0 {
		return "", fmt.Errorf("不是有效的 data URL")
	}
	header := dataURL[5:idx]
	payload := dataURL[idx+1:]
	if !strings.Contains(header, "base64") {
		return "", fmt.Errorf("data URL 不是 base64")
	}
	data, err := base64.StdEncoding.DecodeString(payload)
	if err != nil {
		return "", err
	}
	ext := ".wav"
	for candidateExt, mimeType := range completionSoundAudioMIMETypes {
		if strings.HasPrefix(header, mimeType) {
			ext = candidateExt
			break
		}
	}
	file, err := os.CreateTemp("", "image-studio-completion-*"+ext)
	if err != nil {
		return "", err
	}
	if _, err := file.Write(data); err != nil {
		file.Close()
		return "", err
	}
	if err := file.Close(); err != nil {
		return "", err
	}
	return file.Name(), nil
}
