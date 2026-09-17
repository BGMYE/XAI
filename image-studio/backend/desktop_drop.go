package backend

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

type DesktopDroppedImages struct {
	Images []BatchInputImage `json:"images"`
	Errors []string          `json:"errors"`
}

// ImportDesktopDroppedImages accepts paths supplied by the native window drop
// event. It deliberately isn't a Service method: web content cannot call it to
// read arbitrary paths. Only validated copies in the imports directory cross
// back to the frontend.
func ImportDesktopDroppedImages(paths []string) DesktopDroppedImages {
	result := DesktopDroppedImages{Images: []BatchInputImage{}, Errors: []string{}}
	seen := make(map[string]bool, len(paths))
	for _, path := range paths {
		clean := filepath.Clean(path)
		key := clean
		if runtime.GOOS == "windows" {
			key = strings.ToLower(key)
		}
		if seen[key] {
			continue
		}
		seen[key] = true
		item, err := importDesktopDroppedImage(clean)
		if err != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("%s：%s", filepath.Base(clean), err))
			continue
		}
		result.Images = append(result.Images, item)
	}
	return result
}

func importDesktopDroppedImage(path string) (BatchInputImage, error) {
	if !filepath.IsAbs(path) {
		return BatchInputImage{}, errors.New("无法读取所选文件")
	}
	f, err := os.Open(path)
	if err != nil {
		return BatchInputImage{}, errors.New("无法读取所选文件")
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() == 0 {
		return BatchInputImage{}, errors.New("请选择有效的图片文件")
	}
	if info.Size() > maxImageSnapshotBytes {
		return BatchInputImage{}, errors.New("图片不能超过 50MB")
	}
	data, err := io.ReadAll(io.LimitReader(f, maxImageSnapshotBytes+1))
	if err != nil {
		return BatchInputImage{}, errors.New("无法读取所选文件")
	}
	if len(data) > maxImageSnapshotBytes {
		return BatchInputImage{}, errors.New("图片不能超过 50MB")
	}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(data))
	ext := map[string]string{"png": ".png", "jpeg": ".jpg", "webp": ".webp"}[format]
	if err != nil || ext == "" {
		return BatchInputImage{}, errors.New("仅支持 PNG、JPG 和 WebP 图片")
	}
	if err := validateDecodedImageDimensions(cfg.Width, cfg.Height); err != nil {
		return BatchInputImage{}, errors.New("图片尺寸过大")
	}
	if _, _, err := image.Decode(bytes.NewReader(data)); err != nil {
		return BatchInputImage{}, errors.New("图片内容已损坏")
	}
	dir, err := importsDir()
	if err != nil {
		return BatchInputImage{}, errors.New("无法访问素材目录")
	}
	if err := os.MkdirAll(dir, secureDirMode); err != nil {
		return BatchInputImage{}, errors.New("无法创建素材目录")
	}
	out, err := os.CreateTemp(dir, "drop-"+sanitiseName(filepath.Base(path))+"-*"+ext)
	if err != nil {
		return BatchInputImage{}, errors.New("无法保存素材")
	}
	_, writeErr := out.Write(data)
	closeErr := out.Close()
	if writeErr != nil || closeErr != nil {
		_ = os.Remove(out.Name())
		return BatchInputImage{}, errors.New("无法保存素材")
	}
	return BatchInputImage{Path: out.Name(), Name: filepath.Base(path), Size: int64(len(data)), Width: cfg.Width, Height: cfg.Height}, nil
}
