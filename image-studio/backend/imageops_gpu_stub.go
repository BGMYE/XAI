//go:build !darwin

package backend

import "errors"

type gpuTransformKind int

const (
	gpuTransformRotate gpuTransformKind = iota + 1
	gpuTransformFlip
	gpuTransformCrop
)

type gpuTransformRequest struct {
	Kind       gpuTransformKind
	Degrees    int
	Horizontal bool
	CropX      int
	CropY      int
	CropW      int
	CropH      int
}

var errGPUTransformUnavailable = errors.New("gpu transform unavailable")

func transformWithGPU(_ string, _ transformOutput, _ gpuTransformRequest) (ImageTransformResult, error) {
	return ImageTransformResult{}, errGPUTransformUnavailable
}
