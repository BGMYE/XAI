package studio

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

var catalogSources = map[string]bool{
	"banana-prompt-quicker": true, "davidwu-gpt-image2-prompts": true,
	"freestylefly-gpt-image-2": true, "awesome-gpt-image": true,
	"awesome-gpt4o-image-prompts": true, "youmind-gpt-image-2": true, "youmind-nano-banana-pro": true,
}
var catalogImageHosts = map[string]bool{
	"raw.githubusercontent.com": true, "cdn.jsdelivr.net": true, "cms-assets.youmind.com": true,
	"pbs.twimg.com": true, "cdn.imgedify.com": true, "camo.githubusercontent.com": true,
	"github.com": true, "linux.do": true, "i.mji.rip": true, "storage.googleapis.com": true,
}
var catalogSuffix = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,120}$`)
var publicDNSName = regexp.MustCompile(`^[a-zA-Z0-9.-]+$`)

func catalogAddress(id string) (string, error) {
	if !catalogSources[id] {
		return "", errors.New("未知的公共图库来源")
	}
	return "https://raw.githubusercontent.com/yukkcat/image-prompts/main/dist/sources/" + id + ".json", nil
}
func validatePublicLink(raw string, image bool) error {
	if raw == "" {
		return nil
	}
	u, err := url.Parse(raw)
	if err != nil || len(raw) > 8192 || u.Scheme != "https" || u.User != nil || u.Port() != "" || !publicDNSName.MatchString(u.Hostname()) || !strings.Contains(u.Hostname(), ".") || net.ParseIP(u.Hostname()) != nil {
		return errors.New("来源仅允许公开 HTTPS 链接")
	}
	h := strings.ToLower(u.Hostname())
	last := strings.LastIndex(h, ".")
	if !regexp.MustCompile(`^[a-z][a-z0-9-]*$`).MatchString(h[last+1:]) {
		return errors.New("来源需使用公开域名")
	}
	for _, suffix := range []string{"localhost", "local", "internal", "test", "invalid"} {
		if h == suffix || strings.HasSuffix(h, "."+suffix) {
			return errors.New("不允许本地来源地址")
		}
	}
	if image && !catalogImageHosts[h] {
		return errors.New("预览图片来源未在允许列表中")
	}
	return nil
}
func validateCatalogMetadata(p PromptCard) error {
	if p.CatalogKey != "" {
		source, suffix, ok := strings.Cut(p.CatalogKey, ":")
		if !ok || !catalogSources[source] || !catalogSuffix.MatchString(suffix) {
			return errors.New("图库来源标识无效")
		}
	}
	if err := validatePublicLink(p.PreviewURL, true); err != nil {
		return err
	}
	if err := validatePublicLink(p.SourceURL, false); err != nil {
		return err
	}
	if len(p.ReferenceImageURLs) > 8 {
		return errors.New("参考图链接过多")
	}
	for _, raw := range p.ReferenceImageURLs {
		if err := validatePublicLink(raw, true); err != nil {
			return err
		}
	}
	return nil
}

// FetchPublicCatalog accepts an opaque allowlisted source ID, NEVER a URL,
// profile ID or API key. No cookies, Authorization or user prompt are transmitted.
func FetchPublicCatalog(ctx context.Context, sourceID string) (string, error) {
	address, err := catalogAddress(sourceID)
	if err != nil {
		return "", err
	}
	c := secureClient(false)
	defer c.CloseIdleConnections()
	return readPublicCatalog(ctx, c, address)
}
func readPublicCatalog(ctx context.Context, c *http.Client, address string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, address, nil)
	if err != nil {
		return "", errors.New("无法建立图库请求")
	}
	req.Header.Set("Accept", "application/json")
	resp, err := c.Do(req)
	if err != nil {
		return "", errors.New("无法连接公共图库；已保存的提示词仍可使用")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", errors.New("公共图库暂不可用，请稍后刷新")
	}
	if resp.ContentLength > 8*1024*1024 {
		return "", errors.New("图库响应超过 8 MB")
	}
	b, err := io.ReadAll(io.LimitReader(resp.Body, 8*1024*1024+1))
	if err != nil || len(b) > 8*1024*1024 {
		return "", errors.New("图库响应无法读取或过大")
	}
	var records []json.RawMessage
	if json.Unmarshal(b, &records) != nil || records == nil || len(records) > 5000 {
		return "", errors.New("公共图库格式无效")
	}
	return string(b), nil
}
