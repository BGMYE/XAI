// Package dlss5 defines the local, credential-free video enhancement boundary.
package dlss5

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strings"
)

// Settings is retained for older Studio databases. Production execution ignores
// these developer paths and uses only the verified application-private bundle.
type Settings struct {
	PythonPath  string `json:"pythonPath"`
	ToolRoot    string `json:"toolRoot"`
	RuntimePath string `json:"runtimePath"`
}

func (s *Settings) Validate() error {
	s.PythonPath, s.ToolRoot, s.RuntimePath = strings.TrimSpace(s.PythonPath), strings.TrimSpace(s.ToolRoot), strings.TrimSpace(s.RuntimePath)
	for _, value := range []string{s.PythonPath, s.ToolRoot, s.RuntimePath} {
		if len(value) > 4096 || strings.ContainsAny(value, "\x00\r\n") {
			return errors.New("本地处理器路径无效")
		}
	}
	return nil
}

type Resolution struct {
	Mode   string `json:"mode"`
	Width  int    `json:"width,omitempty"`
	Height int    `json:"height,omitempty"`
}

func (r *Resolution) validate(preview bool) error {
	if r.Mode == "" {
		r.Mode = "source"
	}
	if r.Mode == "source" {
		r.Width, r.Height = 0, 0
		return nil
	}
	if r.Mode != "custom" {
		return errors.New("分辨率模式只能是 source 或 custom")
	}
	maxEdge, maxPixels := 8192, 7680*4320
	if preview {
		maxEdge, maxPixels = 4096, 3840*2160
	}
	if r.Width < 128 || r.Height < 128 || r.Width > maxEdge || r.Height > maxEdge || r.Width%2 != 0 || r.Height%2 != 0 || int64(r.Width)*int64(r.Height) > int64(maxPixels) {
		return fmt.Errorf("分辨率必须为 128–%d 的偶数边长，且总像素不超过 %d", maxEdge, maxPixels)
	}
	return nil
}

type Options struct {
	Enabled           bool       `json:"enabled"`
	Style             int        `json:"style"`
	Intensity         float64    `json:"intensity"`
	LocalTone         float64    `json:"localTone"`
	LocalStructure    float64    `json:"localStructure"`
	SkinStructure     float64    `json:"skinStructure"`
	AutoMask          bool       `json:"autoMask"`
	OutputMix         float64    `json:"outputMix"`
	FlowBackend       string     `json:"flowBackend"`
	FlowWidth         int        `json:"flowWidth"`
	FlowIterations    int        `json:"flowIterations"`
	PreviewResolution Resolution `json:"previewResolution"`
	ExportResolution  Resolution `json:"exportResolution"`
}

func DefaultOptions() Options {
	return Options{Enabled: true, Intensity: 1, LocalTone: 1, LocalStructure: 1, SkinStructure: 1, AutoMask: true, OutputMix: 1, FlowBackend: "off", FlowWidth: 512, FlowIterations: 6, PreviewResolution: Resolution{Mode: "source"}, ExportResolution: Resolution{Mode: "source"}}
}
func (o *Options) Validate() error {
	if !o.Enabled {
		return nil
	}
	if o.Style < 0 || o.Style > 2 {
		return errors.New("DLSS5 风格必须为 0、1 或 2")
	}
	for name, v := range map[string]float64{"intensity": o.Intensity, "localTone": o.LocalTone, "localStructure": o.LocalStructure, "skinStructure": o.SkinStructure, "outputMix": o.OutputMix} {
		if math.IsNaN(v) || math.IsInf(v, 0) || v < 0 || v > 1 {
			return fmt.Errorf("DLSS5 %s 必须为 0–1", name)
		}
	}
	if o.FlowBackend == "" {
		o.FlowBackend = "off"
	}
	if o.FlowBackend != "off" && o.FlowBackend != "raft" && o.FlowBackend != "nvofa" {
		return errors.New("光流模式必须为 off、raft 或 nvofa")
	}
	if o.FlowWidth == 0 {
		o.FlowWidth = 512
	}
	if o.FlowIterations == 0 {
		o.FlowIterations = 6
	}
	if o.FlowWidth < 128 || o.FlowWidth > 2048 || o.FlowIterations < 1 || o.FlowIterations > 32 {
		return errors.New("光流宽度须为 128–2048，迭代次数须为 1–32")
	}
	if err := o.PreviewResolution.validate(true); err != nil {
		return err
	}
	return o.ExportResolution.validate(false)
}

type Capabilities struct {
	Status        string         `json:"status"`
	BundleVersion string         `json:"bundleVersion,omitempty"`
	Available     bool           `json:"available"`
	Reason        string         `json:"reason,omitempty"`
	EngineVersion string         `json:"engineVersion,omitempty"`
	GPU           string         `json:"gpu,omitempty"`
	SupportsFlow  []string       `json:"supportsFlow,omitempty"`
	Limits        map[string]any `json:"limits,omitempty"`
}

func (c Capabilities) Check(o Options) error {
	if !c.Available {
		if c.Reason != "" {
			return errors.New(c.Reason)
		}
		return errors.New("DLSS5 本地处理器尚不可用")
	}
	if o.FlowBackend != "" && o.FlowBackend != "off" {
		for _, v := range c.SupportsFlow {
			if v == o.FlowBackend {
				return nil
			}
		}
		return fmt.Errorf("当前本地处理器不支持 %s 光流", o.FlowBackend)
	}
	return nil
}

type Progress struct {
	Percent int
	Stage   string
	Message string
}
type WorkRequest struct {
	ID               string
	Operation        string
	InputPath        string
	OutputPath       string
	SourceOutputPath string
	Options          Options
	Resolution       Resolution
	PositionSeconds  float64
	DurationSeconds  float64
}
type Result struct {
	SourceWidth     int     `json:"sourceWidth,omitempty"`
	SourceHeight    int     `json:"sourceHeight,omitempty"`
	Width           int     `json:"width"`
	Height          int     `json:"height"`
	EngineVersion   string  `json:"engineVersion,omitempty"`
	DurationSeconds float64 `json:"durationSeconds,omitempty"`
}
type PreviewRequest struct {
	ID              string  `json:"id"`
	SourceAssetID   string  `json:"sourceAssetId"`
	Options         Options `json:"options"`
	PositionSeconds float64 `json:"positionSeconds"`
	DurationSeconds float64 `json:"durationSeconds"`
}
type PreviewResult struct {
	ID        string `json:"id"`
	URL       string `json:"url"`
	SourceURL string `json:"sourceUrl"`
	Width     int    `json:"width"`
	Height    int    `json:"height"`
}

func (p *PreviewRequest) Validate() error {
	if !p.Options.Enabled {
		return errors.New("请启用 DLSS5 后再预览")
	}
	if err := p.Options.Validate(); err != nil {
		return err
	}
	if p.DurationSeconds == 0 {
		p.DurationSeconds = 3
	}
	if math.IsNaN(p.PositionSeconds) || math.IsInf(p.PositionSeconds, 0) || p.PositionSeconds < 0 || p.PositionSeconds > 7*24*3600 || math.IsNaN(p.DurationSeconds) || math.IsInf(p.DurationSeconds, 0) || p.DurationSeconds <= 0 || p.DurationSeconds > 10 {
		return errors.New("预览起点无效或时长超过 10 秒")
	}
	return nil
}

type Runner interface {
	Probe(context.Context, Settings) (Capabilities, error)
	Process(context.Context, Settings, WorkRequest, func(Progress)) (Result, error)
}
