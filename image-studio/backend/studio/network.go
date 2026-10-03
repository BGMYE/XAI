package studio

import (
	"context"
	"crypto/tls"
	"errors"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/yuanhua/image-gptcodex/pkg/client"
)

// NetworkSettings chooses how upstream requests leave this machine. It is the
// proxy setting the classic editor exposes; the default follows the system.
type NetworkSettings struct {
	ProxyMode string `json:"proxyMode,omitempty"`
	ProxyURL  string `json:"proxyUrl,omitempty"`
}

// Validate normalizes the settings in place.
func (n *NetworkSettings) Validate() error {
	c, err := client.NormalizeProxyConfig(n.ProxyMode, n.ProxyURL)
	if err != nil {
		return err
	}
	n.ProxyMode, n.ProxyURL = c.Mode, c.URL
	return nil
}

// blockedNetworks are reserved ranges a public upstream never uses. The
// benchmarking range 198.18.0.0/15 is deliberately absent: proxy tools in
// "fake-IP" mode answer every DNS query with an address from it.
var blockedNetworks = func() []*net.IPNet {
	nets := []*net.IPNet{}
	for _, cidr := range []string{"0.0.0.0/8", "100.64.0.0/10", "192.0.0.0/24", "192.0.2.0/24", "198.51.100.0/24", "203.0.113.0/24", "240.0.0.0/4", "2001:db8::/32", "64:ff9b::/96"} {
		_, network, _ := net.ParseCIDR(cidr)
		nets = append(nets, network)
	}
	return nets
}()

func allowedIP(ip net.IP, allowLocal bool) bool {
	if ip.IsLoopback() {
		return allowLocal
	}
	for _, network := range blockedNetworks {
		if network.Contains(ip) {
			return false
		}
	}
	return ip.IsGlobalUnicast() && !ip.IsPrivate() && !ip.IsLinkLocalUnicast() && !ip.IsLinkLocalMulticast() && !ip.IsUnspecified()
}

var errBlockedAddress = errors.New("拒绝访问本地、私有或链路本地地址")

type requestKind int

const (
	apiRequest        requestKind = iota // creation, polling and model lists
	generationRequest                    // streamed generations, bounded by the job
	mediaRequest                         // downloads of upstream-provided links
)

// newClient builds the HTTP client for one upstream.
//
// A direct connection resolves the target and dials only checked addresses,
// which also defeats DNS rebinding. Through a proxy the proxy resolves names,
// so only literal addresses and localhost names can be checked here; the
// proxy itself may be local. Redirects are never followed automatically.
func newClient(p Profile, n NetworkSettings, kind requestKind) (*http.Client, error) {
	config, err := client.NormalizeProxyConfig(n.ProxyMode, n.ProxyURL)
	if err != nil {
		return nil, err
	}
	selectProxy, err := client.ProxyFunc(config)
	if err != nil {
		return nil, err
	}
	dialer := &net.Dialer{Timeout: 20 * time.Second, KeepAlive: 30 * time.Second}
	var proxies sync.Map
	transport := &http.Transport{
		DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
			if _, ok := proxies.Load(address); ok {
				return dialer.DialContext(ctx, network, address)
			}
			return dialChecked(ctx, dialer, network, address, p.AllowLocal)
		},
		ForceAttemptHTTP2:   true,
		TLSHandshakeTimeout: 15 * time.Second,
		IdleConnTimeout:     30 * time.Second,
		MaxIdleConns:        4,
	}
	if selectProxy != nil {
		transport.Proxy = func(r *http.Request) (*url.URL, error) {
			proxyURL, err := selectProxy(r)
			if err != nil || proxyURL == nil {
				return proxyURL, err
			}
			if !allowedName(r.URL.Hostname(), p.AllowLocal) {
				return nil, errBlockedAddress
			}
			proxies.Store(proxyAddress(proxyURL), true)
			return proxyURL, nil
		}
	}
	if p.AllowInsecure {
		// #nosec G402 -- an explicit opt-in for this one upstream.
		transport.TLSClientConfig = &tls.Config{InsecureSkipVerify: true}
	}
	c := &http.Client{Transport: transport, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	switch kind {
	case apiRequest:
		transport.ResponseHeaderTimeout = 3 * time.Minute
		c.Timeout = 5 * time.Minute
	case generationRequest:
		// Non-streaming relays answer only when the image is done.
		transport.ResponseHeaderTimeout = 10 * time.Minute
	case mediaRequest:
		transport.ResponseHeaderTimeout = 2 * time.Minute
	}
	return c, nil
}

// secureClient is a direct client that ignores proxy settings.
func secureClient(allowLocal bool) *http.Client {
	c, err := newClient(Profile{AllowLocal: allowLocal}, NetworkSettings{ProxyMode: client.ProxyModeNone}, apiRequest)
	if err != nil {
		panic(err) // unreachable: the direct mode has no configuration to reject
	}
	return c
}

func closeClient(c *http.Client) { c.CloseIdleConnections() }

func dialChecked(ctx context.Context, dialer *net.Dialer, network, address string, allowLocal bool) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, errors.New("无效网络地址")
	}
	ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil || len(ips) == 0 {
		return nil, errors.New("无法解析上游域名")
	}
	for _, a := range ips {
		if !allowedIP(a.IP, allowLocal) {
			return nil, errBlockedAddress
		}
	}
	for _, a := range ips {
		conn, err := dialer.DialContext(ctx, network, net.JoinHostPort(a.IP.String(), port))
		if err == nil {
			return conn, nil
		}
	}
	return nil, errors.New("无法连接上游")
}

// allowedName checks what can be checked without resolving a name.
func allowedName(host string, allowLocal bool) bool {
	if ip := net.ParseIP(host); ip != nil {
		return allowedIP(ip, allowLocal)
	}
	lower := strings.ToLower(strings.TrimSuffix(host, "."))
	if lower == "localhost" || strings.HasSuffix(lower, ".localhost") {
		return allowLocal
	}
	return true
}

// proxyAddress is the host:port http.Transport dials for a proxy URL.
func proxyAddress(u *url.URL) string {
	port := u.Port()
	if port == "" {
		port = "80"
		if u.Scheme == "https" {
			port = "443"
		}
	}
	return net.JoinHostPort(u.Hostname(), port)
}
