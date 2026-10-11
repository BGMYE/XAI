package dlss5

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"sync"
	"time"
)

type ProcessRunner struct {
	mu       sync.Mutex
	verified runtimeBundle
}

func (p *ProcessRunner) InvalidateRuntime() {
	p.mu.Lock()
	p.verified = runtimeBundle{}
	p.mu.Unlock()
}

func (p *ProcessRunner) resolve(ctx context.Context) (runtimeBundle, error) {
	executable, err := os.Executable()
	if err != nil {
		return runtimeBundle{}, invalidBundle()
	}
	return p.resolveAt(ctx, executable, runtime.GOOS, runtime.GOARCH)
}

func (p *ProcessRunner) resolveAt(ctx context.Context, executable, goos, goarch string) (runtimeBundle, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	b, err := inspectBundle(ctx, executable, goos, goarch)
	if err != nil {
		return b, err
	}
	if b.Root == p.verified.Root && b.Fingerprint == p.verified.Fingerprint {
		return b, nil
	}
	if err = verifyBundle(ctx, b); err != nil {
		return b, err
	}
	p.verified = b
	return b, nil
}

// RuntimeIdentity lets the Studio cache a GPU probe only for this verified
// installation. Legacy developer paths have no effect on production execution.
func (p *ProcessRunner) RuntimeIdentity(ctx context.Context) (string, error) {
	b, err := p.resolve(ctx)
	return b.Fingerprint, err
}

type wireRequest struct {
	Version          int        `json:"version"`
	ID               string     `json:"id"`
	Op               string     `json:"op"`
	ToolRoot         string     `json:"toolRoot"`
	RuntimePath      string     `json:"runtimePath"`
	InputPath        string     `json:"inputPath,omitempty"`
	OutputPath       string     `json:"outputPath,omitempty"`
	SourceOutputPath string     `json:"sourceOutputPath,omitempty"`
	Options          Options    `json:"options"`
	Resolution       Resolution `json:"resolution"`
	PositionSeconds  float64    `json:"positionSeconds,omitempty"`
	DurationSeconds  float64    `json:"durationSeconds,omitempty"`
}
type wireEvent struct {
	Type     string  `json:"type"`
	ID       string  `json:"id"`
	Progress float64 `json:"progress"`
	Stage    string  `json:"stage"`
	Message  string  `json:"message"`
	Error    string  `json:"error"`
}

func (p *ProcessRunner) Probe(ctx context.Context, _ Settings) (Capabilities, error) {
	b, err := p.resolve(ctx)
	if err != nil {
		var failure *bundleError
		if errors.As(err, &failure) {
			return Capabilities{Status: failure.Status, Reason: failure.Message}, nil
		}
		return Capabilities{Status: "error", Reason: "内置视频引擎检查未完成，请稍后重试。"}, nil
	}
	c := Capabilities{BundleVersion: b.Manifest.BundleVersion, EngineVersion: b.Manifest.EngineVersion}
	data, err := p.run(ctx, b, wireRequest{Version: 1, ID: "probe", Op: "probe", Options: DefaultOptions()}, nil)
	if err != nil {
		c.Status, c.Reason = "error", "内置视频引擎检测失败，请检查显卡驱动后重试。"
		return c, nil
	}
	err = json.Unmarshal(data, &c)
	if err != nil {
		c.Available, c.Status, c.Reason = false, "incompatible_runtime", "内置视频引擎返回了不兼容的结果。"+bundleRepair
		return c, nil
	}
	c.BundleVersion = b.Manifest.BundleVersion
	c.Status = "error"
	if c.Available {
		c.Status = "ready"
	} else if c.Reason == "" {
		c.Reason = "当前显卡或驱动暂不支持本地视频增强。"
	}
	return c, nil
}
func (p *ProcessRunner) Process(ctx context.Context, _ Settings, r WorkRequest, onProgress func(Progress)) (Result, error) {
	var result Result
	if err := r.Options.Validate(); err != nil {
		return result, err
	}
	if !r.Options.Enabled {
		return result, errors.New("本地增强选项未启用")
	}
	if r.Operation != "preview" && r.Operation != "export" {
		return result, errors.New("未知本地处理操作")
	}
	b, err := p.resolve(ctx)
	if err != nil {
		return result, err
	}
	data, err := p.run(ctx, b, wireRequest{Version: 1, ID: r.ID, Op: r.Operation, InputPath: r.InputPath, OutputPath: r.OutputPath, SourceOutputPath: r.SourceOutputPath, Options: r.Options, Resolution: r.Resolution, PositionSeconds: r.PositionSeconds, DurationSeconds: r.DurationSeconds}, onProgress)
	if err != nil {
		return result, err
	}
	err = json.Unmarshal(data, &result)
	return result, err
}
func (p *ProcessRunner) run(ctx context.Context, b runtimeBundle, r wireRequest, onProgress func(Progress)) (json.RawMessage, error) {
	// This absolute path was verified against the private bundle manifest. Never
	// look up an interpreter/worker in PATH or use a legacy configured path.
	r.ToolRoot, r.RuntimePath = b.ToolRoot, b.RuntimePath
	cmd := exec.CommandContext(ctx, b.Executable)
	cmd.Dir = b.Root
	configureProcess(cmd)
	cmd.Env = append(os.Environ(), "PYTHONUNBUFFERED=1", "PYTHONDONTWRITEBYTECODE=1")
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	diagnostic := &boundedLog{limit: 16 << 10}
	cmd.Stderr = diagnostic
	done := make(chan struct{})
	cmd.Cancel = func() error {
		_, _ = io.WriteString(stdin, "{\"version\":1,\"op\":\"cancel\",\"command\":\"cancel\"}\n")
		go func() {
			select {
			case <-done:
				return
			case <-time.After(2 * time.Second):
				terminateProcess(cmd)
			}
		}()
		return nil
	}
	cmd.WaitDelay = 5 * time.Second
	if err = cmd.Start(); err != nil {
		return nil, fmt.Errorf("无法启动本地处理器：%w", err)
	}
	releaseTree, err := ownProcessTree(cmd)
	if err != nil {
		terminateProcess(cmd)
		_ = cmd.Wait()
		close(done)
		return nil, fmt.Errorf("无法监管本地处理进程树：%w", err)
	}
	defer releaseTree()
	payload, err := json.Marshal(r)
	if err == nil {
		_, err = stdin.Write(append(payload, '\n'))
	}
	if err != nil {
		terminateProcess(cmd)
		_ = cmd.Wait()
		close(done)
		return nil, err
	}
	scan := bufio.NewScanner(stdout)
	scan.Buffer(make([]byte, 4096), 1<<20)
	var result json.RawMessage
	var workerErr error
	for scan.Scan() {
		line := append([]byte(nil), scan.Bytes()...)
		var ev wireEvent
		if err := json.Unmarshal(line, &ev); err != nil {
			workerErr = errors.New("本地处理器返回无效 JSONL")
			terminateProcess(cmd)
			break
		}
		if ev.ID != "" && ev.ID != r.ID {
			continue
		}
		switch ev.Type {
		case "progress":
			if onProgress != nil {
				onProgress(Progress{Percent: max(0, min(99, int(ev.Progress))), Stage: ev.Stage, Message: ev.Message})
			}
		case "result":
			if result != nil {
				workerErr = errors.New("本地处理器重复返回终态")
			} else {
				result = line
			}
		case "error":
			workerErr = errors.New(ev.Error)
		}
	}
	if scan.Err() != nil {
		terminateProcess(cmd)
		if workerErr == nil {
			workerErr = fmt.Errorf("本地处理器通信中断：%w", scan.Err())
		}
	}
	waitErr := cmd.Wait()
	close(done)
	_ = stdin.Close()
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	if workerErr != nil {
		return nil, workerErr
	}
	if waitErr != nil {
		if r.Op == "probe" && result != nil {
			var c Capabilities
			if json.Unmarshal(result, &c) == nil && !c.Available {
				return result, nil
			}
		}
		return nil, fmt.Errorf("本地处理器退出失败：%v %s", waitErr, diagnostic.String())
	}
	if result == nil {
		return nil, errors.New("本地处理器未返回完成结果")
	}
	return result, nil
}

type boundedLog struct {
	mu    sync.Mutex
	limit int
	data  []byte
}

func (b *boundedLog) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.data = append(b.data, p...)
	if len(b.data) > b.limit {
		b.data = append([]byte(nil), b.data[len(b.data)-b.limit:]...)
	}
	return len(p), nil
}
func (b *boundedLog) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return strings.TrimSpace(string(b.data))
}
