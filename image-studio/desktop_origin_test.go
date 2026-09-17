package main

import "testing"

func TestDesktopWindowURLsPreserveLegacyStorageOrigin(t *testing.T) {
	for _, item := range []struct{ platform, path, expected string }{
		{"windows", "/", "http://wails.localhost/"},
		{"windows", "/?window=settings", "http://wails.localhost/?window=settings"},
		{"darwin", "/", "wails://wails/"},
		{"darwin", "?window=settings", "wails://wails/?window=settings"},
		{"linux", "/", "wails://wails/"},
		{"linux", "/?window=settings", "wails://wails/?window=settings"},
	} {
		if got := desktopOriginURLForPlatform(item.platform, item.path); got != item.expected {
			t.Errorf("%s %s: got %s, want %s", item.platform, item.path, got, item.expected)
		}
	}
}
