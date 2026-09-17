package main

import (
	"runtime"
	"strings"
)

// Keep the v2 origin: IndexedDB and localStorage are scoped to it. Wails v3
// accepts an absolute wails:// URL through WebviewWindowOptions.URL.
func desktopOriginURL(path string) string { return desktopOriginURLForPlatform(runtime.GOOS, path) }

func desktopOriginURLForPlatform(platform, path string) string {
	origin := "wails://wails/"
	if platform == "windows" {
		origin = "http://wails.localhost/"
	}
	return origin + strings.TrimLeft(path, "/")
}
