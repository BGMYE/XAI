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

// lookupIPAddr resolves names for the address checks. Tests replace it.
var lookupIPAddr = net.DefaultResolver.LookupIPAddr

// fakeIPNetwork is where proxy tools in "fake-IP" mode put every name they
// answer for; such an address says nothing about where the name leads.
var fakeIPNetwork = &net.IPNet{IP: net.IPv4(198, 18, 0, 0).To4(), Mask: net.CIDRMask(15, 32)}

// privateSuffixes are name spaces that exist only inside a site or are
// reserved; no public upstream or CDN uses them.
var privateSuffixes = []string{".local", ".localdomain", ".lan", ".home", ".internal", ".intranet", ".corp", ".private", ".arpa", ".test", ".invalid"}

type requestKind int

const (
	apiRequest        requestKind = iota // creation, polling and model lists
	generationRequest                    // streamed generations, bounded by the job
	mediaRequest                         // downloads of upstream-provided links
)

// newClient builds the HTTP client for one upstream.
//
// A direct connection resolves the target and dials only checked addresses,
// which also defeats DNS rebinding. Through a proxy the proxy resolves names
// again, so the target is checked as well as possible beforehand (see
// checkProxiedHost); the proxy itself may be local. Redirects are never
// followed automatically.
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
			if err := checkProxiedHost(r.Context(), r.URL.Hostname(), p); err != nil {
				return nil, err
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
	ips, err := lookupIPAddr(ctx, host)
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

// checkProxiedHost decides whether a request to host may go through a proxy.
// The proxy resolves the name itself and may see networks this machine does
// not, so the check is best effort:
//   - literal addresses and localhost names are checked as for a direct dial;
//   - a name this machine resolves must resolve to public addresses only;
//   - a name it cannot resolve, or resolves only to fake IPs, must look public
//     (dotted, outside private name spaces) unless it is the upstream's own
//     host, which the user chose.
//
// Upstream-supplied links (results, redirects) therefore cannot point the
// proxy at a router or an intranet name.
func checkProxiedHost(ctx context.Context, host string, p Profile) error {
	if ip := net.ParseIP(host); ip != nil {
		if !allowedIP(ip, p.AllowLocal) {
			return errBlockedAddress
		}
		return nil
	}
	name := strings.ToLower(strings.TrimSuffix(host, "."))
	if name == "localhost" || strings.HasSuffix(name, ".localhost") {
		if !p.AllowLocal {
			return errBlockedAddress
		}
		return nil
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	ips, err := lookupIPAddr(ctx, name)
	resolved := false // to an address that says where the name leads
	for _, a := range ips {
		if !allowedIP(a.IP, p.AllowLocal) {
			return errBlockedAddress
		}
		if !fakeIPNetwork.Contains(a.IP) {
			resolved = true
		}
	}
	if err == nil && resolved {
		return nil
	}
	if publicName(name) || name == upstreamHost(p) {
		return nil
	}
	return errBlockedAddress
}

// publicName reports whether a name can belong to the public DNS.
func publicName(name string) bool {
	if !strings.Contains(name, ".") {
		return false
	}
	for _, suffix := range privateSuffixes {
		if strings.HasSuffix(name, suffix) {
			return false
		}
	}
	return true
}

func upstreamHost(p Profile) string {
	u, err := url.Parse(p.BaseURL)
	if err != nil {
		return ""
	}
	return strings.ToLower(strings.TrimSuffix(u.Hostname(), "."))
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
