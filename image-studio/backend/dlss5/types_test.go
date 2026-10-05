package dlss5

import (
	"math"
	"testing"
)

func TestOptionsValidateActualBounds(t *testing.T) {
	for _, edit := range []func(*Options){func(o *Options) { o.Intensity = 1.1 }, func(o *Options) { o.OutputMix = -.01 }, func(o *Options) { o.LocalTone = math.NaN() }, func(o *Options) { o.Style = 3 }, func(o *Options) { o.FlowBackend = "fake" }, func(o *Options) { o.FlowIterations = 33 }, func(o *Options) { o.FlowWidth = 127 }, func(o *Options) { o.PreviewResolution = Resolution{Mode: "custom", Width: 4096, Height: 4096} }, func(o *Options) { o.ExportResolution = Resolution{Mode: "custom", Width: 1921, Height: 1080} }} {
		o := DefaultOptions()
		edit(&o)
		if o.Validate() == nil {
			t.Fatalf("invalid options accepted %+v", o)
		}
	}
	o := DefaultOptions()
	o.PreviewResolution = Resolution{Mode: "custom", Width: 3840, Height: 2160}
	o.ExportResolution = Resolution{Mode: "custom", Width: 7680, Height: 4320}
	if err := o.Validate(); err != nil {
		t.Fatal(err)
	}
	if (Capabilities{Available: true, SupportsFlow: []string{"off"}}).Check(Options{FlowBackend: "nvofa"}) == nil {
		t.Fatal("unverified flow accepted")
	}
}
func TestPreviewLimits(t *testing.T) {
	p := PreviewRequest{Options: DefaultOptions(), DurationSeconds: 10}
	if err := p.Validate(); err != nil {
		t.Fatal(err)
	}
	p.DurationSeconds = 11
	if p.Validate() == nil {
		t.Fatal("long preview allowed")
	}
	p.DurationSeconds = 1
	p.PositionSeconds = math.Inf(1)
	if p.Validate() == nil {
		t.Fatal("infinite seek allowed")
	}
}
