package backend

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type codexAuthFile struct {
	OpenAIAPIKey string `json:"OPENAI_API_KEY"`
}

// LoadCodexAPIConfig reads the local Codex desktop config so the frontend can
// import the same upstream into Image Studio with one click.
func (s *Service) LoadCodexAPIConfig() (CodexAPIConfig, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return CodexAPIConfig{}, fmt.Errorf("无法定位用户目录: %w", err)
	}
	return loadCodexAPIConfigFromDir(filepath.Join(home, ".codex"))
}

func loadCodexAPIConfigFromDir(dir string) (CodexAPIConfig, error) {
	configPath := filepath.Join(dir, "config.toml")
	authPath := filepath.Join(dir, "auth.json")

	configData, err := os.ReadFile(configPath)
	if err != nil {
		return CodexAPIConfig{}, fmt.Errorf("读取 Codex 配置失败(%s): %w", configPath, err)
	}
	provider, baseURL, wireAPI, err := parseCodexConfigTOML(string(configData))
	if err != nil {
		return CodexAPIConfig{}, err
	}

	authData, err := os.ReadFile(authPath)
	if err != nil {
		return CodexAPIConfig{}, fmt.Errorf("读取 Codex 凭据失败(%s): %w", authPath, err)
	}
	var auth codexAuthFile
	if err := json.Unmarshal(authData, &auth); err != nil {
		return CodexAPIConfig{}, fmt.Errorf("解析 Codex 凭据失败: %w", err)
	}
	apiKey := strings.TrimSpace(auth.OpenAIAPIKey)
	if apiKey == "" {
		return CodexAPIConfig{}, fmt.Errorf("Codex 凭据里未找到 OPENAI_API_KEY")
	}

	return CodexAPIConfig{
		Provider: provider,
		BaseURL:  baseURL,
		APIKey:   apiKey,
		WireAPI:  wireAPI,
	}, nil
}

func parseCodexConfigTOML(raw string) (provider string, baseURL string, wireAPI string, err error) {
	lines := strings.Split(raw, "\n")
	provider = findCodexRootString(lines, "model_provider")
	if provider == "" {
		return "", "", "", fmt.Errorf("Codex config.toml 缺少 model_provider")
	}

	baseURL = findCodexProviderString(lines, provider, "base_url")
	if baseURL == "" {
		return "", "", "", fmt.Errorf("Codex provider %q 缺少 base_url", provider)
	}
	baseURL = normalizeCodexBaseURL(baseURL)
	if baseURL == "" {
		return "", "", "", fmt.Errorf("Codex provider %q 的 base_url 无效", provider)
	}

	wireAPI = strings.TrimSpace(findCodexProviderString(lines, provider, "wire_api"))
	if wireAPI == "" {
		wireAPI = "responses"
	}

	return provider, baseURL, wireAPI, nil
}

func findCodexRootString(lines []string, targetKey string) string {
	currentSection := ""
	for _, rawLine := range lines {
		line := strings.TrimSpace(stripTOMLComment(rawLine))
		if line == "" {
			continue
		}
		if section, ok := parseTOMLSection(line); ok {
			currentSection = section
			continue
		}
		if currentSection != "" {
			continue
		}
		key, value, ok := parseTOMLKeyValue(line)
		if !ok || key != targetKey {
			continue
		}
		return value
	}
	return ""
}

func findCodexProviderString(lines []string, provider string, targetKey string) string {
	currentSection := ""
	for _, rawLine := range lines {
		line := strings.TrimSpace(stripTOMLComment(rawLine))
		if line == "" {
			continue
		}
		if section, ok := parseTOMLSection(line); ok {
			currentSection = section
			continue
		}
		if !sectionMatchesModelProvider(currentSection, provider) {
			continue
		}
		key, value, ok := parseTOMLKeyValue(line)
		if !ok || key != targetKey {
			continue
		}
		return value
	}
	return ""
}

func stripTOMLComment(line string) string {
	var out strings.Builder
	inDouble := false
	inSingle := false
	escaped := false
	for _, r := range line {
		if escaped {
			out.WriteRune(r)
			escaped = false
			continue
		}
		switch r {
		case '\\':
			if inDouble {
				escaped = true
			}
			out.WriteRune(r)
		case '"':
			if !inSingle {
				inDouble = !inDouble
			}
			out.WriteRune(r)
		case '\'':
			if !inDouble {
				inSingle = !inSingle
			}
			out.WriteRune(r)
		case '#':
			if !inDouble && !inSingle {
				return out.String()
			}
			out.WriteRune(r)
		default:
			out.WriteRune(r)
		}
	}
	return out.String()
}

func parseTOMLSection(line string) (string, bool) {
	if !strings.HasPrefix(line, "[") || !strings.HasSuffix(line, "]") {
		return "", false
	}
	section := strings.TrimSpace(line[1 : len(line)-1])
	if section == "" {
		return "", false
	}
	return section, true
}

func parseTOMLKeyValue(line string) (string, string, bool) {
	eq := strings.IndexRune(line, '=')
	if eq <= 0 {
		return "", "", false
	}
	key := strings.TrimSpace(line[:eq])
	if key == "" {
		return "", "", false
	}
	value, ok := parseTOMLStringValue(line[eq+1:])
	if !ok {
		return "", "", false
	}
	return key, value, true
}

func parseTOMLStringValue(raw string) (string, bool) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return "", false
	}
	if len(value) >= 2 && value[0] == '"' && value[len(value)-1] == '"' {
		decoded, err := strconv.Unquote(value)
		if err != nil {
			return "", false
		}
		return decoded, true
	}
	if len(value) >= 2 && value[0] == '\'' && value[len(value)-1] == '\'' {
		return value[1 : len(value)-1], true
	}
	return value, true
}

func sectionMatchesModelProvider(section string, provider string) bool {
	const prefix = "model_providers."
	if !strings.HasPrefix(section, prefix) {
		return false
	}
	name := strings.TrimSpace(strings.TrimPrefix(section, prefix))
	if len(name) >= 2 && ((name[0] == '"' && name[len(name)-1] == '"') || (name[0] == '\'' && name[len(name)-1] == '\'')) {
		name = name[1 : len(name)-1]
	}
	return name == provider
}

func normalizeCodexBaseURL(raw string) string {
	trimmed := strings.TrimRight(strings.TrimSpace(raw), "/")
	if trimmed == "" {
		return ""
	}
	return strings.TrimSuffix(trimmed, "/v1")
}
