package backend

import (
	"errors"
	"fmt"
	"image"
	"image/draw"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	xdraw "golang.org/x/image/draw"
)

const (
	// The pixel cap bounds the NRGBA destination allocation to about 256 MiB.
	upscaleMaxTargetEdge        = 16_384
	upscaleMaxTargetPixels      = 64 * 1024 * 1024
	upscaleMaxMemoryBytes       = 512 * 1024 * 1024
	upscaleRuntimeOverheadBytes = 64 * 1024 * 1024
	upscaleAcceleration         = "cpu-catmullrom"
)

var upscaleMu sync.Mutex

// UpscaleResult describes a local, interpolation-based upscale. This is not a
// neural super-resolution result; Acceleration reports the actual CPU scaler.
type UpscaleResult struct {
	Path          string        `json:"path"`
	Acceleration  string        `json:"acceleration"`
	Width         int           `json:"width"`
	Height        int           `json:"height"`
	MediaAssetRef MediaAssetRef `json:"mediaAssetRef"`
}

// UpscaleImage enlarges a managed local image by 2x or 4x using the CPU
// Catmull-Rom resampler and writes a new PNG under the managed images output.
func (s *Service) UpscaleImage(path string, scale int) (UpscaleResult, error) {
	upscaleMu.Lock()
	defer upscaleMu.Unlock()
	if scale != 2 && scale != 4 {
		return UpscaleResult{}, errors.New("upscale factor must be 2x or 4x")
	}

	allowed, err := s.ensureManagedReadablePath(path, managedImageFile)
	if err != nil {
		return UpscaleResult{}, err
	}
	cfg, err := imageConfig(allowed)
	if err != nil {
		return UpscaleResult{}, fmt.Errorf("read image dimensions for %s: %w", filepath.Base(allowed), err)
	}
	targetWidth, targetHeight, err := validateUpscaleDimensions(cfg.Width, cfg.Height, scale)
	if err != nil {
		return UpscaleResult{}, err
	}

	src, err := loadImage(allowed)
	if err != nil {
		return UpscaleResult{}, err
	}
	// DecodeConfig and Decode should agree. Validate the decoded bounds again so
	// a malformed or changing input cannot bypass the allocation limits.
	targetWidth, targetHeight, err = validateUpscaleDimensions(src.Bounds().Dx(), src.Bounds().Dy(), scale)
	if err != nil {
		return UpscaleResult{}, err
	}
	dst := image.NewNRGBA(image.Rect(0, 0, targetWidth, targetHeight))
	xdraw.CatmullRom.Scale(dst, dst.Bounds(), src, src.Bounds(), draw.Src, nil)

	outputPath, err := s.writeUpscalePNG(allowed, dst, scale)
	if err != nil {
		return UpscaleResult{}, err
	}
	mediaRef, err := s.RegisterMediaAsset(outputPath, "")
	if err != nil {
		_ = os.Remove(outputPath)
		return UpscaleResult{}, fmt.Errorf("register upscaled media: %w", err)
	}
	return UpscaleResult{
		Path:          outputPath,
		Acceleration:  upscaleAcceleration,
		Width:         targetWidth,
		Height:        targetHeight,
		MediaAssetRef: mediaRef,
	}, nil
}

func estimateUpscaleMemoryBytes(sourceWidth, sourceHeight, targetWidth int) (uint64, error) {
	if sourceWidth <= 0 || sourceHeight <= 0 || targetWidth <= 0 || targetWidth%sourceWidth != 0 {
		return 0, errors.New("invalid image dimensions")
	}
	targetHeight := sourceHeight * (targetWidth / sourceWidth)
	// Budget the encoded snapshot retained by loadImage, decoded source pixels,
	// full NRGBA destination, Catmull-Rom scratch, and runtime/decoder headroom.
	return uint64(maxImageSnapshotBytes) + uint64(upscaleRuntimeOverheadBytes) +
		uint64(sourceWidth)*uint64(sourceHeight)*8 +
		uint64(targetWidth)*uint64(targetHeight)*4 +
		uint64(targetWidth)*uint64(sourceHeight)*32, nil
}

func validateUpscaleDimensions(sourceWidth, sourceHeight, scale int) (int, int, error) {
	if scale != 2 && scale != 4 {
		return 0, 0, errors.New("upscale factor must be 2x or 4x")
	}
	if sourceWidth <= 0 || sourceHeight <= 0 {
		return 0, 0, errors.New("invalid image dimensions")
	}
	if sourceWidth > upscaleMaxTargetEdge/scale || sourceHeight > upscaleMaxTargetEdge/scale {
		return 0, 0, fmt.Errorf("upscaled image would exceed maximum target edge of %d pixels", upscaleMaxTargetEdge)
	}
	targetWidth := sourceWidth * scale
	targetHeight := sourceHeight * scale
	if targetWidth > upscaleMaxTargetPixels/targetHeight {
		return 0, 0, fmt.Errorf("upscaled image would exceed maximum target pixel count of %d", upscaleMaxTargetPixels)
	}
	memory, _ := estimateUpscaleMemoryBytes(sourceWidth, sourceHeight, targetWidth)
	if memory > upscaleMaxMemoryBytes {
		return 0, 0, fmt.Errorf("upscaled image would exceed memory limit of %d bytes", upscaleMaxMemoryBytes)
	}
	return targetWidth, targetHeight, nil
}

func (s *Service) writeUpscalePNG(sourcePath string, img image.Image, scale int) (string, error) {
	root, err := s.resolvedOutputDir()
	if err != nil {
		return "", err
	}
	imagesDir := imagesSubdir(root)
	if err := os.MkdirAll(imagesDir, secureDirMode); err != nil {
		return "", fmt.Errorf("create upscale output directory: %w", err)
	}

	stem := strings.TrimSuffix(filepath.Base(sourcePath), filepath.Ext(sourcePath))
	name := fmt.Sprintf("%s-upscale-%dx-%d.png", sanitiseName(stem), scale, time.Now().UnixNano())
	finalPath, err := filepath.Abs(filepath.Join(imagesDir, name))
	if err != nil {
		return "", err
	}
	tmp, err := os.CreateTemp(imagesDir, ".upscale-*.png")
	if err != nil {
		return "", fmt.Errorf("create upscale output: %w", err)
	}
	tmpPath := tmp.Name()
	keep := false
	defer func() {
		_ = tmp.Close()
		if !keep {
			_ = os.Remove(tmpPath)
		}
	}()
	if err := tmp.Chmod(secureFileMode); err != nil {
		return "", err
	}
	if err := png.Encode(tmp, img); err != nil {
		return "", fmt.Errorf("encode upscaled PNG: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return "", fmt.Errorf("close upscaled PNG: %w", err)
	}
	if err := os.Rename(tmpPath, finalPath); err != nil {
		return "", fmt.Errorf("publish upscaled PNG: %w", err)
	}
	keep = true
	return finalPath, nil
}
