package client

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net"
	"net/http"
	"net/netip"
	"net/textproto"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const MaxVideoResponseBytes = 16 * 1024 * 1024
const MaxVideoMediaBytes = 32 * 1024 * 1024
const DefaultVideoEndpointPath = "/v1/videos"
const DefaultVideoPollInterval = 5 * time.Second

// VideoProtocolError is a permanent invalid response, not a transport outage.
type VideoProtocolError struct{ Message string }

func (e *VideoProtocolError) Error() string { return e.Message }

type VideoStatus string

const (
	VideoStatusQueued     VideoStatus = "queued"
	VideoStatusInProgress VideoStatus = "in_progress"
	VideoStatusCompleted  VideoStatus = "completed"
	VideoStatusFailed     VideoStatus = "failed"
	VideoStatusCancelled  VideoStatus = "cancelled"
)

type VideoOptions struct {
	Protocol                string
	AspectRatio             string
	Resolution              string
	AllowInsecureConnection bool
	BaseURL                 string
	APIKey                  string
	VideoModelID            string
	EndpointPath            string
	Prompt                  string
	Seconds                 int
	Size                    string
	Quality                 string
	InputReference          []byte
	InputReferenceName      string
	HTTPClient              *http.Client
}

type VideoPollOptions struct {
	BaseURL      string
	APIKey       string
	VideoID      string
	EndpointPath string
	HTTPClient   *http.Client
}

type VideoResult struct {
	RespectModeration *bool          `json:"respect_moderation,omitempty"`
	Progress          int            `json:"progress"`
	ID                string         `json:"id"`
	Status            VideoStatus    `json:"status"`
	URL               string         `json:"url,omitempty"`
	B64JSON           string         `json:"b64_json,omitempty"`
	Error             string         `json:"error,omitempty"`
	Raw               map[string]any `json:"-"`
}

type videoResponse struct {
	RespectModeration *bool  `json:"respect_moderation"`
	RequestID         string `json:"request_id"`
	Progress          int    `json:"progress"`
	Video             struct {
		RespectModeration *bool  `json:"respect_moderation"`
		URL               string `json:"url"`
		B64JSON           string `json:"b64_json"`
	} `json:"video"`
	ID       string          `json:"id"`
	Status   string          `json:"status"`
	URL      string          `json:"url"`
	B64JSON  string          `json:"b64_json"`
	VideoURL string          `json:"video_url"`
	Error    json.RawMessage `json:"error"`
	Data     []struct {
		RespectModeration *bool  `json:"respect_moderation"`
		URL               string `json:"url"`
		B64JSON           string `json:"b64_json"`
	} `json:"data"`
}

func CreateVideo(ctx context.Context, opts VideoOptions) (VideoResult, error) {
	result, err := (VideoRunner{Options: opts}).Create(ctx)
	if err != nil {
		return result, err
	}
	return localizeCompletedVideo(ctx, result, opts.BaseURL)
}

func PollVideo(ctx context.Context, opts VideoPollOptions) (VideoResult, error) {
	result, err := (VideoRunner{Options: VideoOptions{BaseURL: opts.BaseURL, APIKey: opts.APIKey, EndpointPath: opts.EndpointPath, HTTPClient: opts.HTTPClient}}).Query(ctx, opts.VideoID)
	if err != nil {
		return result, err
	}
	return localizeCompletedVideo(ctx, result, opts.BaseURL)
}

func buildVideoMultipart(opts VideoOptions) (io.Reader, string, error) {
	var buf bytes.Buffer
	form := multipart.NewWriter(&buf)
	fields := map[string]string{"model": strings.TrimSpace(opts.VideoModelID), "prompt": opts.Prompt}
	if opts.Seconds > 0 {
		fields["seconds"] = strconv.Itoa(opts.Seconds)
	}
	if strings.TrimSpace(opts.Size) != "" {
		fields["size"] = strings.TrimSpace(opts.Size)
	}
	if strings.TrimSpace(opts.Quality) != "" {
		fields["quality"] = strings.TrimSpace(opts.Quality)
	}
	for k, v := range fields {
		if err := form.WriteField(k, v); err != nil {
			return nil, "", err
		}
	}
	if len(opts.InputReference) > 0 {
		name := opts.InputReferenceName
		if name == "" {
			name = "input-reference.png"
		}
		header := textproto.MIMEHeader{}
		header.Set("Content-Disposition", fmt.Sprintf(`form-data; name="input_reference"; filename=%q`, name))
		header.Set("Content-Type", http.DetectContentType(opts.InputReference))
		part, err := form.CreatePart(header)
		if err != nil {
			return nil, "", err
		}
		if _, err = part.Write(opts.InputReference); err != nil {
			return nil, "", err
		}
	}
	if err := form.Close(); err != nil {
		return nil, "", err
	}
	return &buf, form.FormDataContentType(), nil
}

func decodeVideoResponseForBase(resp *http.Response, base string) (VideoResult, error) {
	result, err := decodeVideoResponse(resp, base, "")
	if err == nil && result.Status == VideoStatusCompleted && result.URL == "" && result.B64JSON == "" {
		err = errors.New("completed video response missing URL or b64_json")
	}
	return result, err
}
func decodeVideoResponse(resp *http.Response, base, fallbackID string) (VideoResult, error) {
	body, err := io.ReadAll(io.LimitReader(resp.Body, MaxVideoResponseBytes+1))
	if err != nil {
		return VideoResult{}, err
	}
	if len(body) > MaxVideoResponseBytes {
		return VideoResult{}, &VideoProtocolError{"video response exceeds body limit"}
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		var parsed videoResponse
		_ = json.Unmarshal(body, &parsed)
		return VideoResult{}, &HTTPStatusError{StatusCode: resp.StatusCode, Message: fmt.Sprintf("video API returned HTTP %d: %s", resp.StatusCode, videoErrorText(parsed.Error, body)), RetryAfter: resp.Header.Get("Retry-After")}
	}
	var parsed videoResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return VideoResult{}, &VideoProtocolError{fmt.Sprintf("decode video response: %v", err)}
	}
	if parsed.ID == "" {
		parsed.ID = parsed.RequestID
	}
	if parsed.ID == "" {
		parsed.ID = fallbackID
	}
	if !videoIDPattern.MatchString(parsed.ID) {
		return VideoResult{}, &VideoProtocolError{"video response missing or invalid id"}
	}
	if parsed.Status == "" && fallbackID == "" {
		parsed.Status = "queued"
	}
	switch parsed.Status {
	case "pending":
		parsed.Status = "queued"
	case "running", "processing":
		parsed.Status = "in_progress"
	case "done", "succeeded":
		parsed.Status = "completed"
	case "expired":
		parsed.Status = "failed"
	case "canceled":
		parsed.Status = "cancelled"
	}
	if parsed.URL == "" {
		parsed.URL = parsed.Video.URL
	}
	if parsed.B64JSON == "" {
		parsed.B64JSON = parsed.Video.B64JSON
	}
	result := VideoResult{Progress: parsed.Progress, ID: parsed.ID, Status: VideoStatus(strings.ToLower(strings.TrimSpace(parsed.Status))), URL: parsed.URL, B64JSON: parsed.B64JSON}
	if result.URL == "" {
		result.URL = parsed.VideoURL
	}
	if len(parsed.Data) > 0 {
		if result.URL == "" {
			result.URL = parsed.Data[0].URL
		}
		if result.B64JSON == "" {
			result.B64JSON = parsed.Data[0].B64JSON
		}
	}
	for _, moderation := range []*bool{parsed.RespectModeration, parsed.Video.RespectModeration} {
		if moderation != nil && (result.RespectModeration == nil || !*moderation) {
			result.RespectModeration = moderation
		}
	}
	if len(parsed.Data) > 0 && parsed.Data[0].RespectModeration != nil {
		if result.RespectModeration == nil || !*parsed.Data[0].RespectModeration {
			result.RespectModeration = parsed.Data[0].RespectModeration
		}
	}
	if result.RespectModeration != nil && !*result.RespectModeration {
		result.Status = VideoStatusFailed
		return result, errors.New("视频未通过上游内容审核")
	}
	if parsed.Error != nil {
		result.Error = videoErrorText(parsed.Error, nil)
	}
	if result.Status == VideoStatusFailed || result.Status == VideoStatusCancelled {
		return result, fmt.Errorf("video %s: %s", result.Status, result.Error)
	}
	if result.URL != "" {
		validatedURL, err := validateVideoMediaURLForBase(result.URL, base)
		if err != nil {
			return VideoResult{}, err
		}
		result.URL = validatedURL
	}
	return result, nil
}

func videoErrorText(raw json.RawMessage, body []byte) string {
	var obj struct {
		Message string `json:"message"`
	}
	if len(raw) > 0 && json.Unmarshal(raw, &obj) == nil && obj.Message != "" {
		return obj.Message
	}
	var message string
	if len(raw) > 0 && json.Unmarshal(raw, &message) == nil && strings.TrimSpace(message) != "" {
		return strings.TrimSpace(message)
	}
	if len(body) > 256 {
		body = body[:256]
	}
	return strings.TrimSpace(string(body))
}

type videoIPResolver interface {
	LookupIPAddr(context.Context, string) ([]net.IPAddr, error)
}

func localizeCompletedVideo(ctx context.Context, result VideoResult, base string) (VideoResult, error) {
	if result.Status != VideoStatusCompleted {
		return result, nil
	}
	if strings.TrimSpace(result.B64JSON) != "" {
		result.URL = ""
		return result, nil
	}
	payload, err := fetchVideoMedia(ctx, result.URL, base, net.DefaultResolver, &net.Dialer{Timeout: 30 * time.Second})
	if err != nil {
		return VideoResult{}, fmt.Errorf("download completed video: %w", err)
	}
	result.URL = ""
	result.B64JSON = base64.StdEncoding.EncodeToString(payload)
	return result, nil
}

func fetchVideoMedia(ctx context.Context, raw, base string, resolver videoIPResolver, dialer *net.Dialer) ([]byte, error) {
	if _, err := validateVideoMediaURLForBase(raw, base); err != nil {
		return nil, err
	}
	allowPrivate := isLoopbackBaseURL(base)
	transport := &http.Transport{
		Proxy:              nil,
		DisableCompression: true,
		DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(address)
			if err != nil {
				return nil, err
			}
			ip, err := resolvePinnedVideoIP(ctx, resolver, host, allowPrivate)
			if err != nil {
				return nil, err
			}
			return dialer.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
		},
	}
	defer transport.CloseIdleConnections()
	mediaClient := &http.Client{
		Transport: transport,
		Timeout:   8 * time.Minute,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return errors.New("video media redirect limit exceeded")
			}
			if _, err := validateVideoMediaURLForBase(req.URL.String(), base); err != nil {
				return fmt.Errorf("unsafe video media redirect: %w", err)
			}
			_, err := resolvePinnedVideoIP(req.Context(), resolver, req.URL.Hostname(), allowPrivate)
			return err
		},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, raw, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "video/*,application/octet-stream;q=0.9,*/*;q=0.1")
	req.Header.Set("User-Agent", UserAgent())
	resp, err := mediaClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("video media returned HTTP %d", resp.StatusCode)
	}
	if resp.ContentLength > MaxVideoMediaBytes {
		return nil, errors.New("video media exceeds body limit")
	}
	payload, err := io.ReadAll(io.LimitReader(resp.Body, MaxVideoMediaBytes+1))
	if err != nil {
		return nil, err
	}
	if len(payload) > MaxVideoMediaBytes {
		return nil, errors.New("video media exceeds body limit")
	}
	if len(payload) == 0 {
		return nil, errors.New("video media response is empty")
	}
	return payload, nil
}

func resolvePinnedVideoIP(ctx context.Context, resolver videoIPResolver, host string, allowPrivate bool) (net.IP, error) {
	if ip := net.ParseIP(host); ip != nil {
		if err := validateResolvedVideoIP(ip, allowPrivate); err != nil {
			return nil, err
		}
		return ip, nil
	}
	addresses, err := resolver.LookupIPAddr(ctx, host)
	if err != nil {
		return nil, fmt.Errorf("resolve video media host: %w", err)
	}
	if len(addresses) == 0 {
		return nil, errors.New("video media host resolved to no addresses")
	}
	for _, address := range addresses {
		if err := validateResolvedVideoIP(address.IP, allowPrivate); err != nil {
			return nil, err
		}
	}
	return addresses[0].IP, nil
}

var blockedVideoMediaPrefixes = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"),
	netip.MustParsePrefix("10.0.0.0/8"),
	netip.MustParsePrefix("100.64.0.0/10"),
	netip.MustParsePrefix("127.0.0.0/8"),
	netip.MustParsePrefix("169.254.0.0/16"),
	netip.MustParsePrefix("172.16.0.0/12"),
	netip.MustParsePrefix("192.0.0.0/24"),
	netip.MustParsePrefix("192.0.2.0/24"),
	netip.MustParsePrefix("192.88.99.0/24"),
	netip.MustParsePrefix("192.168.0.0/16"),
	netip.MustParsePrefix("198.18.0.0/15"),
	netip.MustParsePrefix("198.51.100.0/24"),
	netip.MustParsePrefix("203.0.113.0/24"),
	netip.MustParsePrefix("224.0.0.0/4"),
	netip.MustParsePrefix("240.0.0.0/4"),
	netip.MustParsePrefix("64:ff9b::/96"),
	netip.MustParsePrefix("64:ff9b:1::/48"),
	netip.MustParsePrefix("100::/64"),
	netip.MustParsePrefix("2001::/23"),
	netip.MustParsePrefix("2001:db8::/32"),
	netip.MustParsePrefix("2002::/16"),
	netip.MustParsePrefix("3fff::/20"),
	netip.MustParsePrefix("5f00::/16"),
	netip.MustParsePrefix("fc00::/7"),
	netip.MustParsePrefix("fe80::/10"),
	netip.MustParsePrefix("ff00::/8"),
}

func validateResolvedVideoIP(ip net.IP, allowLoopback bool) error {
	if ip == nil || ip.IsUnspecified() {
		return errors.New("video media resolves to an unspecified address")
	}
	if ip.IsLoopback() {
		if allowLoopback {
			return nil
		}
		return errors.New("video media resolves to a private address")
	}
	if ip.IsPrivate() || ip.IsLinkLocalUnicast() {
		return errors.New("video media resolves to a private address")
	}
	addr, ok := netip.AddrFromSlice(ip)
	if !ok {
		return errors.New("video media resolves to an invalid address")
	}
	addr = addr.Unmap()
	if !addr.IsGlobalUnicast() {
		return errors.New("video media resolves to a non-public address")
	}
	for _, prefix := range blockedVideoMediaPrefixes {
		if prefix.Contains(addr) {
			if prefix.String() == "100.64.0.0/10" {
				return errors.New("video media resolves to carrier-grade NAT")
			}
			return errors.New("video media resolves to a non-public address")
		}
	}
	return nil
}

func videoHTTPClient(c *http.Client) *http.Client {
	copy := http.Client{Timeout: 8 * time.Minute}
	if c != nil {
		copy = *c
	}
	copy.CheckRedirect = func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }
	return &copy
}

func videoEndpoint(base, path, id string) (string, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		path = DefaultVideoEndpointPath
	}
	if !strings.HasPrefix(path, "/") || strings.HasPrefix(path, "//") {
		return "", errors.New("video endpoint path must be an absolute same-origin path")
	}
	parsed, err := url.ParseRequestURI(path)
	if err != nil || parsed.IsAbs() || parsed.Host != "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", errors.New("video endpoint path must not contain a scheme, host, query, fragment, or userinfo")
	}
	decodedPath, err := url.PathUnescape(parsed.EscapedPath())
	if err != nil || strings.Contains(decodedPath, "\\") {
		return "", errors.New("invalid video endpoint path")
	}
	for _, segment := range strings.Split(decodedPath, "/") {
		if segment == "." || segment == ".." {
			return "", errors.New("video endpoint path must not contain dot segments")
		}
	}
	path = "/" + strings.Trim(parsed.EscapedPath(), "/")
	if id != "" {
		path += "/" + url.PathEscape(id)
	}
	return strings.TrimRight(base, "/") + path, nil
}

func validateVideoMediaURLForBase(raw, base string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" || len(raw) > 8192 {
		return "", errors.New("video response contains an invalid media URL")
	}
	parsed, err := url.Parse(raw)
	if err != nil || !parsed.IsAbs() || parsed.Host == "" || parsed.User != nil {
		return "", errors.New("video response contains an invalid media URL")
	}
	allowLoopback := base != "" && isLoopbackBaseURL(base)
	loopbackTarget := isLoopbackHost(parsed.Hostname())
	if ip := net.ParseIP(parsed.Hostname()); ip != nil {
		if err := validateResolvedVideoIP(ip, allowLoopback); err != nil {
			return "", fmt.Errorf("video response media URL targets an unsafe address: %w", err)
		}
		loopbackTarget = ip.IsLoopback()
	} else if loopbackTarget && !allowLoopback {
		return "", errors.New("video response media URL targets a private address")
	}
	switch parsed.Scheme {
	case "https":
		return parsed.String(), nil
	case "http":
		if allowLoopback && loopbackTarget {
			return parsed.String(), nil
		}
	}
	return "", errors.New("video response media URL must use HTTPS (HTTP is allowed only for loopback)")
}

func isLoopbackBaseURL(raw string) bool {
	u, err := url.Parse(raw)
	return err == nil && isLoopbackHost(u.Hostname())
}
