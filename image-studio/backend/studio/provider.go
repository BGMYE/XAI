package studio

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
	"net/textproto"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"time"
)

// UncertainError deliberately contains no upstream body, URL or bearer token.
// Its presence forbids automatic retries of a potentially accepted paid POST.
type UncertainError struct{}

func (*UncertainError) Error() string {
	return "上游可能已受理，但未获得可靠结果；请在服务商控制台核对。未自动重发请求"
}

type ResumeError struct{}

func (*ResumeError) Error() string {
	return "远端任务已提交，但暂时无法读取结果；可恢复查询，不重新提交"
}

var remoteIDPattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$`)

func validRemoteID(id string) bool { return remoteIDPattern.MatchString(id) }

type HTTPProvider struct{ PollInterval time.Duration }
type mediaResult struct {
	URL               string `json:"url"`
	B64               string `json:"b64_json"`
	RespectModeration *bool  `json:"respect_moderation,omitempty"`
}
type upstreamResult struct {
	ID        string        `json:"id"`
	RequestID string        `json:"request_id"`
	Status    string        `json:"status"`
	Progress  int           `json:"progress"`
	Data      []mediaResult `json:"data"`
	Video     mediaResult   `json:"video"`
	URL       string        `json:"url"`
	B64       string        `json:"b64_json"`
}

func allowedIP(ip net.IP, allowLocal bool) bool {
	if ip.IsLoopback() {
		return allowLocal
	}
	for _, cidr := range []string{"0.0.0.0/8", "100.64.0.0/10", "192.0.0.0/24", "192.0.2.0/24", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "240.0.0.0/4", "2001:db8::/32", "64:ff9b::/96"} {
		_, network, _ := net.ParseCIDR(cidr)
		if network.Contains(ip) {
			return false
		}
	}
	return ip.IsGlobalUnicast() && !ip.IsPrivate() && !ip.IsLinkLocalUnicast() && !ip.IsLinkLocalMulticast() && !ip.IsUnspecified()
}
func secureClient(allowLocal bool) *http.Client {
	transport := &http.Transport{
		// Resolve and pin the checked address at connection time to prevent DNS
		// rebinding. Environment HTTP proxies are intentionally not inherited.
		DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
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
					return nil, errors.New("拒绝访问本地、私有或链路本地地址")
				}
			}
			dialer := net.Dialer{Timeout: 20 * time.Second, KeepAlive: 30 * time.Second}
			for _, a := range ips {
				conn, err := dialer.DialContext(ctx, network, net.JoinHostPort(a.IP.String(), port))
				if err == nil {
					return conn, nil
				}
			}
			return nil, errors.New("无法连接上游")
		}, TLSHandshakeTimeout: 15 * time.Second, ResponseHeaderTimeout: 3 * time.Minute, IdleConnTimeout: 30 * time.Second, MaxIdleConns: 4,
	}
	return &http.Client{Transport: transport, Timeout: 5 * time.Minute, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
}
func closeClient(c *http.Client) { c.CloseIdleConnections() }
func request(ctx context.Context, client *http.Client, p Profile, key, method, path, contentType string, body io.Reader) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, method, p.BaseURL+path, body)
	if err != nil {
		return nil, errors.New("无法建立上游请求")
	}
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Accept", "application/json")
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	resp, err := client.Do(req)
	if err != nil {
		if method == "POST" {
			return nil, &UncertainError{}
		}
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, &ResumeError{}
	}
	return resp, nil
}
func readJSON(resp *http.Response, post bool) (upstreamResult, error) {
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		if post && resp.StatusCode >= 500 {
			return upstreamResult{}, &UncertainError{}
		}
		return upstreamResult{}, upstreamError(resp.StatusCode)
	}
	b, err := io.ReadAll(io.LimitReader(resp.Body, 96*1024*1024+1))
	if err != nil || len(b) > 96*1024*1024 {
		if post {
			return upstreamResult{}, &UncertainError{}
		}
		return upstreamResult{}, errors.New("上游 JSON 无法读取或超过 96 MB")
	}
	var r upstreamResult
	if json.Unmarshal(b, &r) != nil {
		if post {
			return r, &UncertainError{}
		}
		return r, errors.New("上游返回了无效 JSON")
	}
	return r, nil
}
func (p *HTTPProvider) Models(ctx context.Context, profile Profile, key string) ([]string, error) {
	c := secureClient(profile.AllowLocal)
	defer closeClient(c)
	response, err := request(ctx, c, profile, key, "GET", "/models", "", nil)
	if err != nil {
		return nil, errors.New("无法读取模型列表，请检查地址、证书与网络")
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return nil, upstreamError(response.StatusCode)
	}
	b, err := io.ReadAll(io.LimitReader(response.Body, 8*1024*1024+1))
	if err != nil || len(b) > 8*1024*1024 {
		return nil, errors.New("模型列表响应过大或不可读")
	}
	var payload struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if json.Unmarshal(b, &payload) != nil || payload.Data == nil {
		return nil, errors.New("上游未提供标准 /models 列表；连接未标记为成功")
	}
	result := []string{}
	for _, m := range payload.Data {
		if m.ID != "" {
			result = append(result, m.ID)
		}
	}
	sort.Strings(result)
	return result, nil
}
func (p *HTTPProvider) Run(ctx context.Context, j Job, key string, reference *Output, checkpoint Checkpoint) (Output, error) {
	client := secureClient(j.Profile.AllowLocal)
	defer closeClient(client)
	remoteID := j.RemoteID
	if remoteID != "" && !validRemoteID(remoteID) {
		return Output{}, errors.New("已存任务 ID 无效，拒绝查询")
	}
	if remoteID == "" {
		endpoint, contentType, body, err := buildPayload(j, reference)
		if err != nil {
			return Output{}, err
		}
		response, err := request(ctx, client, j.Profile, key, "POST", endpoint, contentType, body)
		if err != nil {
			return Output{}, err
		}
		result, err := readJSON(response, true)
		if err != nil {
			return Output{}, err
		}
		if j.Request.Kind == "image" {
			if len(result.Data) == 0 {
				return Output{}, errors.New("上游未返回图片；没有自动重试")
			}
			return fetchResult(ctx, client, j.Profile, result.Data[0])
		}
		remoteID = result.ID
		if j.Profile.Protocol == "xai" {
			remoteID = result.RequestID
		}
		if !validRemoteID(remoteID) {
			return Output{}, &UncertainError{}
		}
		if err = checkpoint(remoteID, max(0, min(result.Progress, 99))); err != nil {
			return Output{}, &UncertainError{}
		}
	}
	interval := p.PollInterval
	if interval <= 0 {
		interval = 5 * time.Second
	}
	delay := interval
	for {
		if err := wait(ctx, delay); err != nil {
			return Output{}, err
		}
		response, err := request(ctx, client, j.Profile, key, "GET", "/videos/"+remoteID, "", nil)
		if err != nil {
			if ctx.Err() != nil {
				return Output{}, ctx.Err()
			}
			delay = min(delay*2, 30*time.Second)
			continue
		}
		if response.StatusCode == 429 || response.StatusCode >= 500 {
			retry, _ := strconv.Atoi(response.Header.Get("Retry-After"))
			response.Body.Close()
			delay = min(max(delay*2, time.Duration(retry)*time.Second), 60*time.Second)
			continue
		}
		result, err := readJSON(response, false)
		if err != nil {
			return Output{}, err
		}
		delay = interval
		if err = checkpoint(remoteID, result.Progress); err != nil {
			return Output{}, err
		}
		switch result.Status {
		case "pending", "queued", "in_progress", "processing", "running":
			continue
		case "failed", "expired", "cancelled", "canceled":
			return Output{}, errors.New("上游视频任务失败、过期或已取消；请在上游核对原因")
		case "done", "completed", "succeeded":
			media := result.Video
			if media.URL == "" && media.B64 == "" && len(result.Data) > 0 {
				media = result.Data[0]
			}
			if media.URL == "" && media.B64 == "" {
				media.URL = result.URL
				media.B64 = result.B64
			}
			if media.URL != "" || media.B64 != "" {
				return fetchResult(ctx, client, j.Profile, media)
			}
			if j.Profile.Protocol == "xai" {
				return Output{}, errors.New("上游标记完成，但没有提供视频文件")
			}
			// OpenAI-compatible jobs can expose authenticated content instead of URLs.
			response, err := request(ctx, client, j.Profile, key, "GET", "/videos/"+remoteID+"/content", "", nil)
			if err != nil {
				return Output{}, &ResumeError{}
			}
			if response.StatusCode >= 300 && response.StatusCode < 400 {
				location, err := response.Location()
				response.Body.Close()
				if err != nil {
					return Output{}, errors.New("视频下载重定向无效")
				}
				// Bearer token is NEVER sent to a CDN, even for a subdomain of the API.
				return fetchMedia(ctx, client, j.Profile, location.String(), 0)
			}
			return readMedia(response)
		default:
			return Output{}, errors.New("上游返回未知的视频任务状态，未猜测成功")
		}
	}
}
func wait(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}
func buildPayload(j Job, reference *Output) (string, string, io.Reader, error) {
	r := j.Request
	fields := map[string]any{"model": j.model(), "prompt": r.Prompt}
	endpoint := "/images/generations"
	if r.Kind == "video" {
		if j.Profile.Protocol == "xai" {
			endpoint = "/videos/generations"
			if r.Parameters.Seconds != 0 {
				fields["duration"] = r.Parameters.Seconds
			}
		} else {
			endpoint = "/videos"
			if r.Parameters.Seconds != 0 {
				fields["seconds"] = strconv.Itoa(r.Parameters.Seconds)
			}
		}
	}
	if j.Profile.Protocol == "xai" {
		if r.Parameters.AspectRatio != "" {
			fields["aspect_ratio"] = r.Parameters.AspectRatio
		}
		if r.Kind == "video" && r.Parameters.Resolution != "" {
			fields["resolution"] = r.Parameters.Resolution
		}
		if reference != nil {
			fields["image"] = map[string]string{"url": "data:" + reference.MIME + ";base64," + base64.StdEncoding.EncodeToString(reference.Data)}
			if r.Kind == "image" {
				endpoint = "/images/edits"
			}
		}
	} else {
		if r.Parameters.Size != "" {
			fields["size"] = r.Parameters.Size
		}
		if r.Kind == "video" || reference != nil {
			if r.Kind == "image" {
				endpoint = "/images/edits"
			}
			buf := &bytes.Buffer{}
			writer := multipart.NewWriter(buf)
			for _, name := range []string{"model", "prompt", "size", "seconds"} {
				if value, ok := fields[name]; ok {
					if err := writer.WriteField(name, fmt.Sprint(value)); err != nil {
						return "", "", nil, err
					}
				}
			}
			if reference != nil {
				field := "input_reference"
				if r.Kind == "image" {
					field = "image"
				}
				header := textproto.MIMEHeader{}
				header.Set("Content-Disposition", `form-data; name="`+field+`"; filename="reference"`)
				header.Set("Content-Type", reference.MIME)
				part, err := writer.CreatePart(header)
				if err != nil {
					return "", "", nil, err
				}
				if _, err = part.Write(reference.Data); err != nil {
					return "", "", nil, err
				}
			}
			if err := writer.Close(); err != nil {
				return "", "", nil, err
			}
			return endpoint, writer.FormDataContentType(), buf, nil
		}
	}
	b, err := json.Marshal(fields)
	return endpoint, "application/json", bytes.NewReader(b), err
}
func fetchResult(ctx context.Context, c *http.Client, profile Profile, result mediaResult) (Output, error) {
	if result.RespectModeration != nil && !*result.RespectModeration {
		return Output{}, errors.New("上游未通过内容审核，未保存输出")
	}
	if result.B64 != "" {
		if len(result.B64) > 224*1024*1024 {
			return Output{}, errors.New("base64 素材超过大小上限")
		}
		b, err := base64.StdEncoding.DecodeString(result.B64)
		if err != nil {
			return Output{}, errors.New("上游 base64 素材无效")
		}
		return Output{Data: b}, nil
	}
	return fetchMedia(ctx, c, profile, result.URL, 0)
}
func fetchMedia(ctx context.Context, c *http.Client, p Profile, rawURL string, redirects int) (Output, error) {
	u, err := url.Parse(rawURL)
	if err != nil || u.Hostname() == "" || u.User != nil || u.Fragment != "" {
		return Output{}, errors.New("上游媒体地址无效")
	}
	if u.Scheme != "https" && !(p.AllowLocal && u.Scheme == "http" && isLoopbackHost(u.Hostname())) {
		return Output{}, errors.New("媒体下载仅允许 HTTPS，或已启用的本地回环服务")
	}
	if redirects > 3 {
		return Output{}, errors.New("媒体下载重定向次数过多")
	}
	req, err := http.NewRequestWithContext(ctx, "GET", u.String(), nil)
	if err != nil {
		return Output{}, errors.New("无法建立媒体请求")
	}
	// No Authorization, cookies, referrer, or API headers on external media.
	response, err := c.Do(req)
	if err != nil {
		return Output{}, &ResumeError{}
	}
	if response.StatusCode >= 300 && response.StatusCode < 400 {
		location, err := response.Location()
		response.Body.Close()
		if err != nil {
			return Output{}, errors.New("媒体重定向无效")
		}
		return fetchMedia(ctx, c, p, location.String(), redirects+1)
	}
	return readMedia(response)
}
func readMedia(response *http.Response) (Output, error) {
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return Output{}, &ResumeError{}
	}
	if response.ContentLength > 160*1024*1024 {
		return Output{}, errors.New("媒体文件超过 160 MB")
	}
	b, err := io.ReadAll(io.LimitReader(response.Body, 160*1024*1024+1))
	if err != nil {
		return Output{}, &ResumeError{}
	}
	if len(b) > 160*1024*1024 {
		return Output{}, errors.New("媒体文件超过 160 MB")
	}
	return Output{Data: b, MIME: response.Header.Get("Content-Type")}, nil
}
