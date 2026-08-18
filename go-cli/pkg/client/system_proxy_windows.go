//go:build windows

package client

import (
	"net/http"
	"net/url"
	"strings"
	"syscall"
	"unsafe"
)

var (
	winhttpDLL                                = syscall.NewLazyDLL("winhttp.dll")
	kernel32DLL                               = syscall.NewLazyDLL("kernel32.dll")
	procWinHTTPGetIEProxyConfigForCurrentUser = winhttpDLL.NewProc("WinHttpGetIEProxyConfigForCurrentUser")
	procWinHTTPOpen                           = winhttpDLL.NewProc("WinHttpOpen")
	procWinHTTPCloseHandle                    = winhttpDLL.NewProc("WinHttpCloseHandle")
	procWinHTTPGetProxyForURL                 = winhttpDLL.NewProc("WinHttpGetProxyForUrl")
	procGlobalFree                            = kernel32DLL.NewProc("GlobalFree")
)

const (
	winHTTPAccessTypeNoProxy    = 1
	winHTTPAccessTypeNamedProxy = 3
	winHTTPAutoProxyAutoDetect  = 0x00000001
	winHTTPAutoProxyConfigURL   = 0x00000002
	winHTTPAutoDetectTypeDHCP   = 0x00000001
	winHTTPAutoDetectTypeDNSA   = 0x00000002
)

type winHTTPCurrentUserProxyConfig struct {
	AutoDetect    uint32
	AutoConfigURL *uint16
	Proxy         *uint16
	ProxyBypass   *uint16
}

type winHTTPAutoProxyOptions struct {
	Flags                 uint32
	AutoDetectFlags       uint32
	AutoConfigURL         *uint16
	Reserved              uintptr
	Reserved2             uint32
	AutoLogonIfChallenged uint32
}

type winHTTPProxyInfo struct {
	AccessType  uint32
	Proxy       *uint16
	ProxyBypass *uint16
}

type currentUserProxyConfig struct {
	AutoDetect    bool
	AutoConfigURL string
	Proxy         string
	ProxyBypass   string
}

type resolvedProxyConfig struct {
	AccessType  uint32
	Proxy       string
	ProxyBypass string
}

func systemProxyFunc() func(*http.Request) (*url.URL, error) {
	fallback := http.ProxyFromEnvironment
	return func(req *http.Request) (*url.URL, error) {
		if req == nil || req.URL == nil {
			return fallback(req)
		}
		cfg, err := loadCurrentUserProxyConfig()
		if err != nil {
			return fallback(req)
		}
		if cfg.AutoDetect || strings.TrimSpace(cfg.AutoConfigURL) != "" {
			if proxyURL, decided := resolveAutoProxy(req.URL, cfg); decided {
				return proxyURL, nil
			}
		}
		selector, err := parseSystemProxySelector(cfg.Proxy, cfg.ProxyBypass)
		if err == nil {
			if proxyURL, decided := selector.resolve(req.URL); decided {
				return proxyURL, nil
			}
		}
		return nil, nil
	}
}

func resolveAutoProxy(target *url.URL, cfg currentUserProxyConfig) (*url.URL, bool) {
	resolved, err := winHTTPGetProxyForURL(target.String(), cfg)
	if err != nil {
		return nil, false
	}
	switch resolved.AccessType {
	case winHTTPAccessTypeNoProxy:
		return nil, true
	case winHTTPAccessTypeNamedProxy:
		selector, err := parseSystemProxySelector(resolved.Proxy, resolved.ProxyBypass)
		if err != nil {
			return nil, false
		}
		return selector.resolve(target)
	default:
		return nil, false
	}
}

func loadCurrentUserProxyConfig() (currentUserProxyConfig, error) {
	var raw winHTTPCurrentUserProxyConfig
	ok, _, err := procWinHTTPGetIEProxyConfigForCurrentUser.Call(uintptr(unsafe.Pointer(&raw)))
	if ok == 0 {
		return currentUserProxyConfig{}, normalizeWindowsCallError(err)
	}
	defer globalFreeUTF16(raw.AutoConfigURL)
	defer globalFreeUTF16(raw.Proxy)
	defer globalFreeUTF16(raw.ProxyBypass)
	return currentUserProxyConfig{
		AutoDetect:    raw.AutoDetect != 0,
		AutoConfigURL: utf16PtrToString(raw.AutoConfigURL),
		Proxy:         utf16PtrToString(raw.Proxy),
		ProxyBypass:   utf16PtrToString(raw.ProxyBypass),
	}, nil
}

func winHTTPGetProxyForURL(rawURL string, cfg currentUserProxyConfig) (resolvedProxyConfig, error) {
	session, err := winHTTPOpenSession()
	if err != nil {
		return resolvedProxyConfig{}, err
	}
	defer winHTTPCloseHandle(session)

	autoProxyOptions, err := buildAutoProxyOptions(cfg)
	if err != nil {
		return resolvedProxyConfig{}, err
	}
	targetPtr, err := syscall.UTF16PtrFromString(rawURL)
	if err != nil {
		return resolvedProxyConfig{}, err
	}

	var info winHTTPProxyInfo
	ok, _, callErr := procWinHTTPGetProxyForURL.Call(
		session,
		uintptr(unsafe.Pointer(targetPtr)),
		uintptr(unsafe.Pointer(&autoProxyOptions)),
		uintptr(unsafe.Pointer(&info)),
	)
	if ok == 0 {
		return resolvedProxyConfig{}, normalizeWindowsCallError(callErr)
	}
	defer globalFreeUTF16(info.Proxy)
	defer globalFreeUTF16(info.ProxyBypass)
	return resolvedProxyConfig{
		AccessType:  info.AccessType,
		Proxy:       utf16PtrToString(info.Proxy),
		ProxyBypass: utf16PtrToString(info.ProxyBypass),
	}, nil
}

func buildAutoProxyOptions(cfg currentUserProxyConfig) (winHTTPAutoProxyOptions, error) {
	var opts winHTTPAutoProxyOptions
	if cfg.AutoDetect {
		opts.Flags |= winHTTPAutoProxyAutoDetect
		opts.AutoDetectFlags = winHTTPAutoDetectTypeDHCP | winHTTPAutoDetectTypeDNSA
	}
	if strings.TrimSpace(cfg.AutoConfigURL) != "" {
		ptr, err := syscall.UTF16PtrFromString(cfg.AutoConfigURL)
		if err != nil {
			return winHTTPAutoProxyOptions{}, err
		}
		opts.Flags |= winHTTPAutoProxyConfigURL
		opts.AutoConfigURL = ptr
	}
	opts.AutoLogonIfChallenged = 1
	return opts, nil
}

func winHTTPOpenSession() (uintptr, error) {
	agent, err := syscall.UTF16PtrFromString(UserAgent())
	if err != nil {
		return 0, err
	}
	handle, _, callErr := procWinHTTPOpen.Call(
		uintptr(unsafe.Pointer(agent)),
		winHTTPAccessTypeNoProxy,
		0,
		0,
		0,
	)
	if handle == 0 {
		return 0, normalizeWindowsCallError(callErr)
	}
	return handle, nil
}

func winHTTPCloseHandle(handle uintptr) {
	if handle == 0 {
		return
	}
	procWinHTTPCloseHandle.Call(handle)
}

func utf16PtrToString(ptr *uint16) string {
	if ptr == nil {
		return ""
	}
	return syscall.UTF16ToString((*[1 << 20]uint16)(unsafe.Pointer(ptr))[:])
}

func globalFreeUTF16(ptr *uint16) {
	if ptr == nil {
		return
	}
	procGlobalFree.Call(uintptr(unsafe.Pointer(ptr)))
}

func normalizeWindowsCallError(err error) error {
	if err == nil {
		return syscall.EINVAL
	}
	if errno, ok := err.(syscall.Errno); ok && errno == 0 {
		return syscall.EINVAL
	}
	return err
}
