package promptimport

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/yuanhua/image-gptcodex/pkg/client"
)

const (
	DefaultBaseURL = "https://prompts.sorry.ink"
	TokenLength    = 8
)

var retryBackoffs = []time.Duration{
	500 * time.Millisecond,
	1 * time.Second,
	2 * time.Second,
}

type ImportErrorCode string

const (
	TokenNotFound    ImportErrorCode = "TOKEN_NOT_FOUND"
	TokenUsed        ImportErrorCode = "TOKEN_USED"
	TokenExpired     ImportErrorCode = "TOKEN_EXPIRED"
	TokenUnavailable ImportErrorCode = "TOKEN_UNAVAILABLE"
	TokenInvalid     ImportErrorCode = "TOKEN_INVALID"
)

type ImportError struct {
	Code       ImportErrorCode
	StatusCode int
	Cause      error
}

func (e *ImportError) Error() string {
	if e == nil {
		return ""
	}
	return string(e.Code)
}

func (e *ImportError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Cause
}

type BilingualText struct {
	Zh string `json:"zh,omitempty"`
	En string `json:"en,omitempty"`
}

type ImportPayload struct {
	Prompt         BilingualText  `json:"prompt"`
	NegativePrompt *BilingualText `json:"negative_prompt,omitempty"`
	AspectRatio    string         `json:"aspect_ratio,omitempty"`
	ResolvedSize   string         `json:"resolvedSize,omitempty"`
}

type FetchOptions struct {
	BaseURL   string
	UserAgent string
	Client    *http.Client
}

func IsValidToken(token string) bool {
	if len(token) != TokenLength {
		return false
	}
	for _, r := range token {
		switch {
		case r >= '0' && r <= '9':
		case r >= 'A' && r <= 'Z':
		case r >= 'a' && r <= 'z':
		default:
			return false
		}
	}
	return true
}

func RedactToken(token string) string {
	if strings.TrimSpace(token) == "" {
		return ""
	}
	token = strings.TrimSpace(token)
	if len(token) <= 3 {
		return token + "***"
	}
	return token[:3] + "***"
}

func ParseTokenFromURL(rawURL string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return "", &ImportError{Code: TokenInvalid, Cause: err}
	}
	if parsed.Scheme != "image-studio" || parsed.Host != "import" {
		return "", &ImportError{Code: TokenInvalid}
	}
	token := parsed.Query().Get("token")
	if !IsValidToken(token) {
		return "", &ImportError{Code: TokenInvalid}
	}
	return token, nil
}

func ExtractFirstTokenFromArgs(args []string) string {
	for _, arg := range args {
		token, err := ParseTokenFromURL(arg)
		if err == nil && token != "" {
			return token
		}
	}
	return ""
}

func PreferChinese(text *BilingualText) string {
	if text == nil {
		return ""
	}
	if zh := strings.TrimSpace(text.Zh); zh != "" {
		return zh
	}
	return strings.TrimSpace(text.En)
}

func ResolvedSizeForAspectRatio(aspectRatio string) string {
	switch strings.TrimSpace(aspectRatio) {
	case "", "auto":
		return "auto"
	case "1:1":
		return "1024x1024"
	case "3:2":
		return "1536x1024"
	case "2:3":
		return "1024x1536"
	case "16:9":
		return "1536x864"
	case "9:16":
		return "864x1536"
	case "4:3":
		return "1360x1024"
	case "3:4":
		return "1024x1360"
	case "21:9":
		return "1792x768"
	case "9:21":
		return "768x1792"
	default:
		return "auto"
	}
}

func Fetch(ctx context.Context, token string, options FetchOptions) (*ImportPayload, error) {
	if !IsValidToken(token) {
		return nil, &ImportError{Code: TokenInvalid}
	}
	baseURL := strings.TrimSpace(options.BaseURL)
	if baseURL == "" {
		baseURL = DefaultBaseURL
	}
	validatedBaseURL, err := client.ValidateBaseURL(baseURL)
	if err != nil {
		return nil, &ImportError{Code: TokenUnavailable, Cause: err}
	}
	httpClient := options.Client
	if httpClient == nil {
		transport, transportErr := client.NewHTTPTransport(client.ProxyConfig{Mode: client.ProxyModeSystem})
		if transportErr != nil {
			return nil, &ImportError{Code: TokenUnavailable, Cause: transportErr}
		}
		httpClient = &http.Client{
			Timeout:   10 * time.Second,
			Transport: transport,
		}
	}
	userAgent := strings.TrimSpace(options.UserAgent)
	if userAgent == "" {
		userAgent = client.UserAgent()
	}
	requestURL := fmt.Sprintf("%s/api/import-tokens/%s", strings.TrimRight(validatedBaseURL, "/"), token)
	var lastErr error
	attempts := len(retryBackoffs) + 1
	for attempt := 0; attempt < attempts; attempt++ {
		payload, retryable, fetchErr := fetchOnce(ctx, httpClient, requestURL, userAgent)
		if fetchErr == nil {
			payload.ResolvedSize = ResolvedSizeForAspectRatio(payload.AspectRatio)
			return payload, nil
		}
		lastErr = fetchErr
		if !retryable || attempt == attempts-1 {
			return nil, fetchErr
		}
		if sleepErr := sleepWithContext(ctx, retryBackoffs[attempt]); sleepErr != nil {
			return nil, sleepErr
		}
	}
	if lastErr != nil {
		return nil, lastErr
	}
	return nil, &ImportError{Code: TokenUnavailable}
}

func fetchOnce(ctx context.Context, httpClient *http.Client, requestURL string, userAgent string) (*ImportPayload, bool, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, requestURL, nil)
	if err != nil {
		return nil, false, &ImportError{Code: TokenUnavailable, Cause: err}
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "application/json")

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, true, &ImportError{Code: TokenUnavailable, Cause: err}
	}
	defer resp.Body.Close()

	body, readErr := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	if readErr != nil {
		return nil, true, &ImportError{Code: TokenUnavailable, StatusCode: resp.StatusCode, Cause: readErr}
	}

	var decoded struct {
		ImportPayload
		Error string `json:"error,omitempty"`
	}
	decodeErr := json.Unmarshal(body, &decoded)

	switch resp.StatusCode {
	case http.StatusOK:
		if decodeErr != nil {
			return nil, true, &ImportError{Code: TokenUnavailable, StatusCode: resp.StatusCode, Cause: decodeErr}
		}
		return &decoded.ImportPayload, false, nil
	case http.StatusNotFound:
		return nil, false, &ImportError{Code: TokenNotFound, StatusCode: resp.StatusCode}
	case http.StatusGone:
		if strings.TrimSpace(decoded.Error) == "token_expired" {
			return nil, false, &ImportError{Code: TokenExpired, StatusCode: resp.StatusCode}
		}
		return nil, false, &ImportError{Code: TokenUsed, StatusCode: resp.StatusCode}
	default:
		if resp.StatusCode >= 500 {
			return nil, true, &ImportError{Code: TokenUnavailable, StatusCode: resp.StatusCode}
		}
		return nil, false, &ImportError{Code: TokenUnavailable, StatusCode: resp.StatusCode}
	}
}

func ErrorCode(err error) ImportErrorCode {
	var importErr *ImportError
	if errors.As(err, &importErr) {
		return importErr.Code
	}
	return ""
}

func sleepWithContext(ctx context.Context, delay time.Duration) error {
	if delay <= 0 {
		return nil
	}
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
