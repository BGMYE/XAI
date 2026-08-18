package ui

import (
	"bytes"
	_ "embed"
	"image"
	_ "image/png"
	"sync"
)

//go:embed appicon.png
var appIconPNG []byte

var (
	appIconOnce  sync.Once
	appIconImage image.Image
)

func appLogoImage() image.Image {
	appIconOnce.Do(func() {
		img, _, err := image.Decode(bytes.NewReader(appIconPNG))
		if err == nil {
			appIconImage = img
		}
	})
	return appIconImage
}
