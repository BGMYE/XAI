//go:build darwin

package backend

import (
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"testing"
)

func TestTransformWithGPURotateWritesOutput(t *testing.T) {
	srcPath := filepath.Join(t.TempDir(), "source.png")
	writePNGForTest(t, srcPath, 2, 3)

	outPath := filepath.Join(t.TempDir(), "rotated.png")
	result, err := transformWithGPU(srcPath, transformOutput{
		Path:   outPath,
		Format: "png",
	}, gpuTransformRequest{
		Kind:    gpuTransformRotate,
		Degrees: 90,
	})
	if err != nil {
		if err.Error() == "metal device unavailable" {
			t.Skip("Metal device unavailable in current test environment")
		}
		t.Fatalf("transformWithGPU rotate failed: %v", err)
	}
	if result.Acceleration != "gpu-metal" {
		t.Fatalf("unexpected acceleration: %q", result.Acceleration)
	}

	f, err := os.Open(outPath)
	if err != nil {
		t.Fatalf("open transformed image: %v", err)
	}
	defer f.Close()

	img, err := png.Decode(f)
	if err != nil {
		t.Fatalf("decode transformed image: %v", err)
	}
	if got, want := img.Bounds().Dx(), 3; got != want {
		t.Fatalf("rotated width = %d, want %d", got, want)
	}
	if got, want := img.Bounds().Dy(), 2; got != want {
		t.Fatalf("rotated height = %d, want %d", got, want)
	}
}

func writePNGForTest(t *testing.T, path string, width, height int) {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			img.Set(x, y, color.RGBA{R: uint8(20 * (x + 1)), G: uint8(30 * (y + 1)), B: 120, A: 255})
		}
	}
	f, err := os.Create(path)
	if err != nil {
		t.Fatalf("create source image: %v", err)
	}
	defer f.Close()
	if err := png.Encode(f, img); err != nil {
		t.Fatalf("encode source image: %v", err)
	}
}
