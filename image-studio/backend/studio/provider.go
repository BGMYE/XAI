package studio

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net"
	"net/http"
	"net/http/httptrace"
	"net/textproto"
	"net/url"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/yuanhua/image-gptcodex/pkg/client"
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

// NotSentError reports a failure before the request left this machine (DNS,
// connection, TLS or a blocked address). Such a request was certainly not
// accepted or billed, so it is reported as a plain failure and may be resent.
type NotSentError struct{ Reason string }

func (e *NotSentError) Error() string { return e.Reason }

var remoteIDPattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$`)

func validRemoteID(id string) bool { return remoteIDPattern.MatchString(id) }

// validResultURL checks the shape of a result link before it is persisted as a
// recovery handle. fetchMedia applies the network policy when it is used.
func validResultURL(raw string) bool {
	if len(raw) > 8192 {
		return false
	}
	u, err := url.Parse(raw)
	return err == nil && (u.Scheme == "https" || u.Scheme == "http") && u.Hostname() != "" && u.User == nil
}

type HTTPProvider struct {
	PollInterval time.Duration
	// MediaDir, when set, receives downloaded and decoded results as temporary
	// files, so large media is streamed to disk instead of held in memory.
	MediaDir string
	// Network returns the current proxy settings. Without it, connections are
	// direct.
	Network func() NetworkSettings
}

func (p *HTTPProvider) network() NetworkSettings {
	if p.Network == nil {
		return NetworkSettings{ProxyMode: client.ProxyModeNone}
	}
	return p.Network()
}

// clients builds the API and media clients for one job. Media downloads are
// not bounded by the API client's total timeout.
func (p *HTTPProvider) clients(profile Profile) (api, media *http.Client, err error) {
	network := p.network()
	if api, err = newClient(profile, network, apiRequest); err != nil {
		return nil, nil, &NotSentError{Reason: "网络代理设置无效：" + err.Error()}
	}
	if media, err = newClient(profile, network, mediaRequest); err != nil {
		return nil, nil, &NotSentError{Reason: "网络代理设置无效：" + err.Error()}
	}
	return api, media, nil
}

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

// connected marks a context so that a failed call reports whether a connection
// to the upstream (or the proxy) was established. Before that, nothing can
// have been written: the request was certainly not accepted. The hook runs on
// the calling goroutine before any byte is written, so unlike WroteRequest it
// cannot be outrun by a cancellation that returns first.
func connected(ctx context.Context) (context.Context, func() bool) {
	var got atomic.Bool
	ctx = httptrace.WithClientTrace(ctx, &httptrace.ClientTrace{GotConn: func(httptrace.GotConnInfo) { got.Store(true) }})
	return ctx, got.Load
}

func request(ctx context.Context, c *http.Client, p Profile, key, method, path, contentType string, body io.Reader) (*http.Response, error) {
	// Whether the request may have been written decides between "certainly
	// not sent" and "may have been accepted" when the call fails.
	ctx, mayHaveSent := connected(ctx)
	req, err := http.NewRequestWithContext(ctx, method, client.OpenAIAPIEndpoint(p.BaseURL, path), body)
	if err != nil {
		return nil, &NotSentError{Reason: "无法建立上游请求"}
	}
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Accept", "application/json")
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	resp, err := c.Do(req)
	if err != nil {
		if method == "POST" {
			if mayHaveSent() {
				return nil, &UncertainError{}
			}
			return nil, &NotSentError{Reason: describeSendFailure(ctx, err)}
		}
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, &ResumeError{}
	}
	return resp, nil
}

// describeSendFailure explains a failure that happened before any request
// bytes were written. Messages contain no URL query or credential.
func describeSendFailure(ctx context.Context, err error) string {
	if ctx.Err() != nil {
		return "请求未发出：已取消或超时"
	}
	var urlErr *url.Error
	if errors.As(err, &urlErr) {
		err = urlErr.Err
	}
	var certErr *tls.CertificateVerificationError
	var unknownAuthority x509.UnknownAuthorityError
	var hostname x509.HostnameError
	switch {
	case errors.As(err, &certErr), errors.As(err, &unknownAuthority), errors.As(err, &hostname):
		return "请求未发出：上游 HTTPS 证书无效"
	case errors.Is(err, context.DeadlineExceeded):
		return "请求未发出：连接上游超时"
	}
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return "请求未发出：连接上游超时"
	}
	return "请求未发出：" + err.Error()
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
	if profile.BaseURL == "" {
		return nil, errors.New("请先填写上游地址")
	}
	c, err := newClient(profile, p.network(), apiRequest)
	if err != nil {
		return nil, errors.New("网络代理设置无效：" + err.Error())
	}
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
	api, media, err := p.clients(j.Profile)
	if err != nil {
		return Output{}, err
	}
	defer closeClient(api)
	defer closeClient(media)
	if j.ResultURL != "" {
		// The upstream already produced this result; only the download remains.
		out, err := p.fetchMedia(ctx, media, j.Profile, j.ResultURL, 0)
		return out, expiredLink(err)
	}
	if j.Request.Kind == "image" && j.Profile.Protocol == "openai" {
		return p.runOpenAIImage(ctx, j, key, reference, media, checkpoint)
	}
	remoteID := j.RemoteID
	if remoteID != "" && !validRemoteID(remoteID) {
		return Output{}, errors.New("已存任务 ID 无效，拒绝查询")
	}
	if remoteID == "" {
		endpoint, contentType, body, err := buildPayload(j, reference)
		if err != nil {
			return Output{}, err
		}
		response, err := request(ctx, api, j.Profile, key, "POST", endpoint, contentType, body)
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
			return p.imageResult(ctx, media, j.Profile, result.Data[0], checkpoint)
		}
		remoteID = result.ID
		if j.Profile.Protocol == "xai" {
			remoteID = result.RequestID
		}
		if !validRemoteID(remoteID) {
			return Output{}, &UncertainError{}
		}
		if err = checkpoint(Progress{RemoteID: remoteID, Percent: result.Progress}); err != nil {
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
		response, err := request(ctx, api, j.Profile, key, "GET", "/videos/"+remoteID, "", nil)
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
		if err = checkpoint(Progress{RemoteID: remoteID, Percent: result.Progress}); err != nil {
			return Output{}, err
		}
		switch result.Status {
		case "pending", "queued", "in_progress", "processing", "running":
			continue
		case "failed", "expired", "cancelled", "canceled":
			return Output{}, errors.New("上游视频任务失败、过期或已取消；请在上游核对原因")
		case "done", "completed", "succeeded":
			file := result.Video
			if file.URL == "" && file.B64 == "" && len(result.Data) > 0 {
				file = result.Data[0]
			}
			if file.URL == "" && file.B64 == "" {
				file.URL = result.URL
				file.B64 = result.B64
			}
			if file.URL != "" || file.B64 != "" {
				return p.fetchResult(ctx, media, j.Profile, file)
			}
			if j.Profile.Protocol == "xai" {
				return Output{}, errors.New("上游标记完成，但没有提供视频文件")
			}
			// OpenAI-compatible jobs can expose authenticated content instead of
			// URLs. The download is not bounded by the API client's timeout.
			response, err := request(ctx, media, j.Profile, key, "GET", "/videos/"+remoteID+"/content", "", nil)
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
				return p.fetchMedia(ctx, media, j.Profile, location.String(), 0)
			}
			return p.readMedia(response)
		default:
			return Output{}, errors.New("上游返回未知的视频任务状态，未猜测成功")
		}
	}
}

// imageResult turns a finished image response into output. A result link is
// persisted before the download starts, so a failed download can be resumed
// without generating (and paying for) the image again.
func (p *HTTPProvider) imageResult(ctx context.Context, client *http.Client, profile Profile, media mediaResult, checkpoint Checkpoint) (Output, error) {
	if media.RespectModeration != nil && !*media.RespectModeration {
		return Output{}, errors.New("上游未通过内容审核，未保存输出")
	}
	if media.B64 != "" {
		return p.decodeBase64(media.B64)
	}
	if media.URL == "" {
		return Output{}, errors.New("上游未返回图片；没有自动重试")
	}
	if !validResultURL(media.URL) {
		return Output{}, errors.New("上游返回的图片地址无效")
	}
	if err := checkpoint(Progress{ResultURL: media.URL}); err != nil {
		if errors.Is(err, context.Canceled) {
			return Output{}, err
		}
		return Output{}, &UncertainError{}
	}
	out, err := p.fetchMedia(ctx, client, profile, media.URL, 0)
	return out, expiredLink(err)
}

// expiredLink turns a client error from a saved image link into a final
// failure: retrying the same expired or missing link cannot succeed. Other
// download failures stay resumable.
func expiredLink(err error) error {
	var status *mediaStatusError
	if errors.As(err, &status) && status.status >= 400 && status.status < 500 && status.status != 408 && status.status != 429 {
		return fmt.Errorf("结果链接已失效（HTTP %d），无法再下载；如需该图片请重新生成", status.status)
	}
	return err
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
func (p *HTTPProvider) fetchResult(ctx context.Context, c *http.Client, profile Profile, result mediaResult) (Output, error) {
	if result.RespectModeration != nil && !*result.RespectModeration {
		return Output{}, errors.New("上游未通过内容审核，未保存输出")
	}
	if result.B64 != "" {
		return p.decodeBase64(result.B64)
	}
	return p.fetchMedia(ctx, c, profile, result.URL, 0)
}

// decodeBase64 decodes an inline result, streaming it to a temporary file when
// a media directory is configured.
func (p *HTTPProvider) decodeBase64(b64 string) (Output, error) {
	if len(b64) > 224*1024*1024 {
		return Output{}, errors.New("base64 素材超过大小上限")
	}
	if p.MediaDir == "" {
		b, err := base64.StdEncoding.DecodeString(b64)
		if err != nil {
			return Output{}, errors.New("上游 base64 素材无效")
		}
		return Output{Data: b}, nil
	}
	out, err := p.writeTemp(base64.NewDecoder(base64.StdEncoding, strings.NewReader(b64)))
	if err != nil {
		var tooLarge *mediaTooLargeError
		if errors.As(err, &tooLarge) {
			return Output{}, err
		}
		return Output{}, errors.New("上游 base64 素材无效")
	}
	return out, nil
}

func (p *HTTPProvider) fetchMedia(ctx context.Context, c *http.Client, profile Profile, rawURL string, redirects int) (Output, error) {
	u, err := url.Parse(rawURL)
	if err != nil || u.Hostname() == "" || u.User != nil || u.Fragment != "" {
		return Output{}, errors.New("上游媒体地址无效")
	}
	if u.Scheme != "https" && !(u.Scheme == "http" && (profile.AllowInsecure || (profile.AllowLocal && isLoopbackHost(u.Hostname())))) {
		return Output{}, errors.New("媒体下载仅允许 HTTPS；HTTP 需启用本地回环服务或不安全连接")
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
		if ctx.Err() != nil {
			return Output{}, ctx.Err()
		}
		return Output{}, &ResumeError{}
	}
	if response.StatusCode >= 300 && response.StatusCode < 400 {
		location, err := response.Location()
		response.Body.Close()
		if err != nil {
			return Output{}, errors.New("媒体重定向无效")
		}
		return p.fetchMedia(ctx, c, profile, location.String(), redirects+1)
	}
	return p.readMedia(response)
}

// mediaStatusError is a non-200 media response. It unwraps to ResumeError, so
// a failed download is resumable unless a caller decides otherwise.
type mediaStatusError struct{ status int }

func (e *mediaStatusError) Error() string { return (&ResumeError{}).Error() }
func (e *mediaStatusError) Unwrap() error { return &ResumeError{} }

type mediaTooLargeError struct{}

func (*mediaTooLargeError) Error() string { return "媒体文件超过 160 MB" }

func (p *HTTPProvider) readMedia(response *http.Response) (Output, error) {
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return Output{}, &mediaStatusError{status: response.StatusCode}
	}
	if response.ContentLength > maxMediaBytes {
		return Output{}, &mediaTooLargeError{}
	}
	mime := response.Header.Get("Content-Type")
	if p.MediaDir == "" {
		b, err := io.ReadAll(io.LimitReader(response.Body, maxMediaBytes+1))
		if err != nil {
			return Output{}, &ResumeError{}
		}
		if len(b) > maxMediaBytes {
			return Output{}, &mediaTooLargeError{}
		}
		return Output{Data: b, MIME: mime}, nil
	}
	out, err := p.writeTemp(response.Body)
	if err != nil {
		var tooLarge *mediaTooLargeError
		if errors.As(err, &tooLarge) {
			return Output{}, err
		}
		return Output{}, &ResumeError{}
	}
	out.MIME = mime
	return out, nil
}

// writeTemp streams r into a synced temporary file in the media directory.
// The engine renames it into place, so results never pass through memory.
func (p *HTTPProvider) writeTemp(r io.Reader) (Output, error) {
	f, err := os.CreateTemp(p.MediaDir, ".incoming-*")
	if err != nil {
		return Output{}, err
	}
	name := f.Name()
	n, err := io.Copy(f, io.LimitReader(r, maxMediaBytes+1))
	if err == nil && n > maxMediaBytes {
		err = &mediaTooLargeError{}
	}
	if err == nil {
		err = f.Chmod(0600)
	}
	if err == nil {
		err = f.Sync()
	}
	if closeErr := f.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		_ = os.Remove(name)
		return Output{}, err
	}
	return Output{Path: name}, nil
}
