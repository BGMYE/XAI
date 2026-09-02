package backend

import (
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	xdraw "golang.org/x/image/draw"
)

func TestUpscaleImageSupportsTwoAndFourTimes(t *testing.T) {
	for _, scale := range []int{2, 4} {
		t.Run(string(rune('0'+scale))+"x", func(t *testing.T) {
			svc, source := newUpscaleTestService(t, 3, 2)

			result, err := svc.UpscaleImage(source, scale)
			if err != nil {
				t.Fatalf("UpscaleImage(%d): %v", scale, err)
			}
			if result.Width != 3*scale || result.Height != 2*scale {
				t.Fatalf("dimensions = %dx%d, want %dx%d", result.Width, result.Height, 3*scale, 2*scale)
			}
			if result.Acceleration != "cpu-catmullrom" {
				t.Fatalf("acceleration = %q", result.Acceleration)
			}
			if filepath.Ext(result.Path) != ".png" || result.Path == source {
				t.Fatalf("output path = %q, source = %q", result.Path, source)
			}
			if result.MediaAssetRef.SavedPath != result.Path || result.MediaAssetRef.FullURL == "" || result.MediaAssetRef.PreviewURL == "" {
				t.Fatalf("media asset ref was not registered: %+v", result.MediaAssetRef)
			}

			f, err := os.Open(result.Path)
			if err != nil {
				t.Fatal(err)
			}
			got, err := png.Decode(f)
			_ = f.Close()
			if err != nil {
				t.Fatalf("decode output PNG: %v", err)
			}
			if got.Bounds().Dx() != result.Width || got.Bounds().Dy() != result.Height {
				t.Fatalf("PNG dimensions = %v, result = %dx%d", got.Bounds(), result.Width, result.Height)
			}

			req := httptest.NewRequest(http.MethodGet, result.MediaAssetRef.FullURL, nil)
			rr := httptest.NewRecorder()
			svc.MediaHandler(http.NotFoundHandler()).ServeHTTP(rr, req)
			if rr.Code != http.StatusOK || rr.Header().Get("Content-Type") != "image/png" {
				t.Fatalf("registered full media response = %d, content-type %q", rr.Code, rr.Header().Get("Content-Type"))
			}
		})
	}
}

func TestUpscaleImageRejectsUnsupportedScale(t *testing.T) {
	svc, source := newUpscaleTestService(t, 2, 2)
	for _, scale := range []int{-1, 0, 1, 3, 8} {
		if _, err := svc.UpscaleImage(source, scale); err == nil || !strings.Contains(err.Error(), "2x or 4x") {
			t.Fatalf("scale %d error = %v, want supported-scale error", scale, err)
		}
	}
}

func TestUpscaleImageRejectsUnmanagedPath(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	svc := NewService()
	outside := filepath.Join(t.TempDir(), "outside.png")
	writeUpscaleSource(t, outside, 2, 2)

	if _, err := svc.UpscaleImage(outside, 2); err == nil || !strings.Contains(err.Error(), "托管目录之外") {
		t.Fatalf("unmanaged path error = %v", err)
	}
}

func TestValidateUpscaleDimensionsEnforcesTargetLimits(t *testing.T) {
	if _, _, err := validateUpscaleDimensions(upscaleMaxTargetEdge/2+1, 1, 2); err == nil || !strings.Contains(err.Error(), "edge") {
		t.Fatalf("oversized edge error = %v", err)
	}

	width := upscaleMaxTargetEdge / 2
	height := upscaleMaxTargetPixels/(width*4) + 1
	if height*2 > upscaleMaxTargetEdge {
		t.Fatalf("test dimensions unexpectedly hit edge limit first: %dx%d", width*2, height*2)
	}
	if _, _, err := validateUpscaleDimensions(width, height, 2); err == nil || !strings.Contains(err.Error(), "pixel") {
		t.Fatalf("oversized pixel count error = %v", err)
	}

	if width, height, err := validateUpscaleDimensions(7, 11, 4); err != nil || width != 28 || height != 44 {
		t.Fatalf("valid dimensions = %dx%d, %v", width, height, err)
	}
}

func TestEstimateUpscaleMemoryIncludesDestinationSnapshotAndOverhead(t *testing.T) {
	got, err := estimateUpscaleMemoryBytes(10, 20, 40)
	if err != nil {
		t.Fatal(err)
	}
	const targetHeight = 80
	want := uint64(10*20*8+40*targetHeight*4+40*20*32) + maxImageSnapshotBytes + upscaleRuntimeOverheadBytes
	if got != want {
		t.Fatalf("memory=%d want=%d", got, want)
	}
}

func TestValidateUpscaleDimensionsRejectsMemoryBoundary(t *testing.T) {
	// This narrow 4x case fits the edge and pixel caps. Correctly accounting
	// for the full destination, encoded snapshot, and runtime headroom puts it
	// just over the 512 MiB process budget.
	if _, _, err := validateUpscaleDimensions(4080, 522, 4); err == nil || !strings.Contains(err.Error(), "memory") {
		t.Fatalf("memory-boundary error = %v", err)
	}
}

func TestValidateDecodedImageDimensionsRejectsDecompressionBombs(t *testing.T) {
	for _, tc := range []struct {
		name          string
		width, height int
	}{
		{name: "edge", width: maxDecodedImageEdge + 1, height: 1},
		{name: "pixels", width: 8192, height: 8193},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if err := validateDecodedImageDimensions(tc.width, tc.height); err == nil {
				t.Fatalf("dimensions %dx%d should be rejected", tc.width, tc.height)
			}
		})
	}
	if err := validateDecodedImageDimensions(4096, 4096); err != nil {
		t.Fatalf("ordinary image rejected: %v", err)
	}
}

func TestUpscaleImageWritesCatmullRomPixelsAndPreservesTransparency(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	root := t.TempDir()
	svc := NewService()
	if err := svc.SetOutputDir(root); err != nil {
		t.Fatal(err)
	}
	imagesDir := imagesSubdir(root)
	if err := os.MkdirAll(imagesDir, secureDirMode); err != nil {
		t.Fatal(err)
	}

	src := image.NewNRGBA(image.Rect(0, 0, 2, 2))
	src.SetNRGBA(0, 0, color.NRGBA{R: 255, A: 255})
	src.SetNRGBA(1, 0, color.NRGBA{G: 255, A: 255})
	src.SetNRGBA(0, 1, color.NRGBA{B: 255, A: 128})
	src.SetNRGBA(1, 1, color.NRGBA{R: 200, G: 100, B: 50, A: 0})
	source := filepath.Join(imagesDir, "pixels.png")
	writeUpscalePNG(t, source, src)

	result, err := svc.UpscaleImage(source, 2)
	if err != nil {
		t.Fatal(err)
	}
	f, err := os.Open(result.Path)
	if err != nil {
		t.Fatal(err)
	}
	actual, err := png.Decode(f)
	_ = f.Close()
	if err != nil {
		t.Fatal(err)
	}

	expected := image.NewNRGBA(image.Rect(0, 0, 4, 4))
	xdraw.CatmullRom.Scale(expected, expected.Bounds(), src, src.Bounds(), draw.Src, nil)
	for y := 0; y < 4; y++ {
		for x := 0; x < 4; x++ {
			if got, want := color.NRGBAModel.Convert(actual.At(x, y)), color.NRGBAModel.Convert(expected.At(x, y)); got != want {
				t.Fatalf("pixel (%d,%d) = %v, want CatmullRom %v", x, y, got, want)
			}
		}
	}
	if got := color.NRGBAModel.Convert(actual.At(3, 3)).(color.NRGBA).A; got != 0 {
		t.Fatalf("transparent corner alpha = %d, want 0", got)
	}
}

func newUpscaleTestService(t *testing.T, width, height int) (*Service, string) {
	t.Helper()
	t.Setenv("HOME", t.TempDir())
	root := t.TempDir()
	svc := NewService()
	if err := svc.SetOutputDir(root); err != nil {
		t.Fatal(err)
	}
	imagesDir := imagesSubdir(root)
	if err := os.MkdirAll(imagesDir, secureDirMode); err != nil {
		t.Fatal(err)
	}
	source := filepath.Join(imagesDir, "source.png")
	writeUpscaleSource(t, source, width, height)
	return svc, source
}

func writeUpscaleSource(t *testing.T, path string, width, height int) {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			img.SetNRGBA(x, y, color.NRGBA{R: uint8(31*x + 7), G: uint8(47*y + 11), B: uint8(13*(x+y) + 19), A: uint8(255 - 17*((x+y)%4))})
		}
	}
	writeUpscalePNG(t, path, img)
}

func writeUpscalePNG(t *testing.T, path string, img image.Image) {
	t.Helper()
	f, err := os.OpenFile(path, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, secureFileMode)
	if err != nil {
		t.Fatal(err)
	}
	if err := png.Encode(f, img); err != nil {
		_ = f.Close()
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
}
