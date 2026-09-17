//go:build windows

package main

import (
	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
	"unsafe"
)

var systemParametersInfo = windows.NewLazySystemDLL("user32.dll").NewProc("SystemParametersInfoW")

func readSystemPreferences() SystemPreferences {
	var result SystemPreferences
	if key, err := registry.OpenKey(registry.CURRENT_USER, `Software\Microsoft\Windows\CurrentVersion\Themes\Personalize`, registry.QUERY_VALUE); err == nil {
		defer key.Close()
		if light, _, err := key.GetIntegerValue("AppsUseLightTheme"); err == nil {
			result.Dark = boolRef(light == 0)
		}
		if transparent, _, err := key.GetIntegerValue("EnableTransparency"); err == nil {
			result.ReduceTransparency = boolRef(transparent == 0)
		}
	}
	contrast := struct {
		Size   uint32
		Flags  uint32
		Scheme *uint16
	}{}
	contrast.Size = uint32(unsafe.Sizeof(contrast))
	if ok, _, _ := systemParametersInfo.Call(0x0042, uintptr(contrast.Size), uintptr(unsafe.Pointer(&contrast)), 0); ok != 0 {
		result.HighContrast = boolRef(contrast.Flags&1 != 0)
	}
	var animation int32
	if ok, _, _ := systemParametersInfo.Call(0x1042, 0, uintptr(unsafe.Pointer(&animation)), 0); ok != 0 {
		result.ReduceMotion = boolRef(animation == 0)
	}
	return result
}
