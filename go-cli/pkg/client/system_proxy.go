package client

import (
	"fmt"
	"net"
	"net/url"
	"regexp"
	"strings"
)

type systemProxySelector struct {
	defaultProxy    *url.URL
	proxiesByScheme map[string]*url.URL
	bypassRules     []systemProxyBypassRule
}

type systemProxyBypassRule struct {
	matchLocal    bool
	matchHostPort bool
	pattern       *regexp.Regexp
}

func parseSystemProxySelector(proxyList, bypassList string) (*systemProxySelector, error) {
	selector := &systemProxySelector{
		proxiesByScheme: map[string]*url.URL{},
	}
	for _, token := range splitSystemProxyList(proxyList) {
		scheme, endpoint := splitSystemProxyToken(token)
		if scheme != "" && scheme != "http" && scheme != "https" {
			continue
		}
		if strings.TrimSpace(endpoint) == "" {
			continue
		}
		proxyURL, err := normalizeSystemProxyURL(endpoint)
		if err != nil {
			return nil, err
		}
		if scheme == "" {
			if selector.defaultProxy == nil {
				selector.defaultProxy = proxyURL
			}
			continue
		}
		if selector.proxiesByScheme[scheme] == nil {
			selector.proxiesByScheme[scheme] = proxyURL
		}
	}
	for _, token := range splitSystemProxyList(bypassList) {
		rule, err := compileSystemProxyBypassRule(token)
		if err != nil {
			return nil, err
		}
		if rule == nil {
			continue
		}
		selector.bypassRules = append(selector.bypassRules, *rule)
	}
	if selector.defaultProxy == nil && len(selector.proxiesByScheme) == 0 && len(selector.bypassRules) == 0 {
		return nil, nil
	}
	return selector, nil
}

func (s *systemProxySelector) resolve(target *url.URL) (*url.URL, bool) {
	if s == nil {
		return nil, false
	}
	if target == nil {
		return nil, true
	}
	if s.shouldBypass(target) {
		return nil, true
	}
	scheme := strings.ToLower(strings.TrimSpace(target.Scheme))
	if proxyURL := s.proxiesByScheme[scheme]; proxyURL != nil {
		return cloneProxyURL(proxyURL), true
	}
	if s.defaultProxy != nil {
		return cloneProxyURL(s.defaultProxy), true
	}
	return nil, true
}

func (s *systemProxySelector) shouldBypass(target *url.URL) bool {
	host := strings.ToLower(strings.TrimSpace(target.Hostname()))
	if host == "" {
		return false
	}
	hostPort := strings.ToLower(strings.TrimSpace(target.Host))
	for _, rule := range s.bypassRules {
		if rule.matches(host, hostPort) {
			return true
		}
	}
	return false
}

func (r systemProxyBypassRule) matches(host, hostPort string) bool {
	if r.matchLocal {
		return host != "" && !strings.Contains(host, ".") && net.ParseIP(host) == nil
	}
	candidate := host
	if r.matchHostPort {
		candidate = hostPort
	}
	return r.pattern != nil && r.pattern.MatchString(candidate)
}

func splitSystemProxyList(raw string) []string {
	return strings.FieldsFunc(raw, func(r rune) bool {
		return r == ';' || r == ' ' || r == '\t' || r == '\r' || r == '\n'
	})
}

func splitSystemProxyToken(token string) (scheme string, endpoint string) {
	name, value, ok := strings.Cut(token, "=")
	if !ok {
		return "", strings.TrimSpace(token)
	}
	return strings.ToLower(strings.TrimSpace(name)), strings.TrimSpace(value)
}

func normalizeSystemProxyURL(raw string) (*url.URL, error) {
	cleaned := strings.TrimSpace(raw)
	if cleaned == "" {
		return nil, nil
	}
	if !strings.Contains(cleaned, "://") {
		cleaned = "http://" + cleaned
	}
	parsed, err := url.Parse(cleaned)
	if err != nil {
		return nil, err
	}
	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "http" && scheme != "https" {
		return nil, fmt.Errorf("系统代理地址仅支持 http:// 或 https://")
	}
	if parsed.Host == "" {
		return nil, fmt.Errorf("系统代理地址必须包含主机")
	}
	if parsed.RawQuery != "" || parsed.Fragment != "" {
		return nil, fmt.Errorf("系统代理地址不能包含 query 或 fragment")
	}
	if parsed.Path != "" && parsed.Path != "/" {
		return nil, fmt.Errorf("系统代理地址不能包含路径")
	}
	parsed.Scheme = scheme
	parsed.Path = ""
	return parsed, nil
}

func compileSystemProxyBypassRule(raw string) (*systemProxyBypassRule, error) {
	token := strings.TrimSpace(raw)
	if token == "" {
		return nil, nil
	}
	if strings.EqualFold(token, "<local>") {
		return &systemProxyBypassRule{matchLocal: true}, nil
	}
	regex, err := wildcardPatternToRegexp(token)
	if err != nil {
		return nil, err
	}
	return &systemProxyBypassRule{
		matchHostPort: looksLikeHostPortPattern(token),
		pattern:       regex,
	}, nil
}

func wildcardPatternToRegexp(raw string) (*regexp.Regexp, error) {
	var builder strings.Builder
	builder.WriteString("(?i)^")
	for _, r := range raw {
		switch r {
		case '*':
			builder.WriteString(".*")
		case '?':
			builder.WriteString(".")
		default:
			builder.WriteString(regexp.QuoteMeta(string(r)))
		}
	}
	builder.WriteString("$")
	return regexp.Compile(builder.String())
}

func looksLikeHostPortPattern(raw string) bool {
	if strings.HasPrefix(raw, "[") {
		return strings.Contains(raw, "]:")
	}
	return strings.Count(raw, ":") == 1
}

func cloneProxyURL(raw *url.URL) *url.URL {
	if raw == nil {
		return nil
	}
	cloned := *raw
	return &cloned
}
