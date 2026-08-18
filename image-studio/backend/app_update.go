package backend

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/yuanhua/image-gptcodex/pkg/client"
)

const (
	defaultAppVersion       = "0.1.5"
	releasesPageURL         = "https://github.com/RoseKhlifa/Image-Studio/releases"
	latestReleaseAPIURL     = "https://api.github.com/repos/RoseKhlifa/Image-Studio/releases/latest"
	latestReleaseAPIURLEnv  = "IMAGE_STUDIO_LATEST_RELEASE_API_URL"
	latestReleaseAPIVersion = "2022-11-28"
	updateRequestTimeout    = 8 * time.Second
)

var semverPattern = regexp.MustCompile(`^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$`)

type AppUpdateInfo struct {
	CurrentVersion string `json:"currentVersion"`
	LatestVersion  string `json:"latestVersion"`
	ReleaseTag     string `json:"releaseTag"`
	ReleaseName    string `json:"releaseName,omitempty"`
	ReleaseURL     string `json:"releaseURL"`
	PublishedAt    string `json:"publishedAt,omitempty"`
	Body           string `json:"body,omitempty"`
	HasUpdate      bool   `json:"hasUpdate"`
}

type githubLatestRelease struct {
	TagName     string `json:"tag_name"`
	Name        string `json:"name"`
	HTMLURL     string `json:"html_url"`
	PublishedAt string `json:"published_at"`
	Body        string `json:"body"`
	Draft       bool   `json:"draft"`
	Prerelease  bool   `json:"prerelease"`
}

func (s *Service) CheckForAppUpdate() (AppUpdateInfo, error) {
	currentVersion, err := currentDesktopAppVersion()
	if err != nil {
		return AppUpdateInfo{}, err
	}

	ctx, cancel := context.WithTimeout(context.Background(), updateRequestTimeout)
	defer cancel()

	release, err := fetchLatestGitHubRelease(ctx)
	if err != nil {
		return AppUpdateInfo{}, err
	}
	if release.Draft {
		return AppUpdateInfo{}, errors.New("latest release is still a draft")
	}

	latestVersion := normalizeReleaseVersion(release.TagName)
	if latestVersion == "" {
		return AppUpdateInfo{}, fmt.Errorf("无法识别 release 版本: %q", release.TagName)
	}
	hasUpdate := compareSemver(latestVersion, currentVersion) > 0
	if semverCore(latestVersion) != "" && semverCore(latestVersion) == semverCore(currentVersion) {
		hasUpdate = false
	}

	return AppUpdateInfo{
		CurrentVersion: currentVersion,
		LatestVersion:  latestVersion,
		ReleaseTag:     strings.TrimSpace(release.TagName),
		ReleaseName:    strings.TrimSpace(release.Name),
		ReleaseURL:     chooseReleaseURL(strings.TrimSpace(release.HTMLURL)),
		PublishedAt:    strings.TrimSpace(release.PublishedAt),
		Body:           strings.TrimSpace(release.Body),
		HasUpdate:      hasUpdate,
	}, nil
}

func fetchLatestGitHubRelease(ctx context.Context) (githubLatestRelease, error) {
	apiURL := strings.TrimSpace(os.Getenv(latestReleaseAPIURLEnv))
	if apiURL == "" {
		apiURL = commandLineArgValue(os.Args[1:], latestReleaseAPIURLArg)
	}
	if apiURL == "" {
		apiURL = latestReleaseAPIURL
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL, nil)
	if err != nil {
		return githubLatestRelease{}, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", latestReleaseAPIVersion)

	client := &http.Client{Timeout: updateRequestTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return githubLatestRelease{}, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return githubLatestRelease{}, fmt.Errorf("GitHub releases 请求失败: %s %s", resp.Status, strings.TrimSpace(string(body)))
	}

	var release githubLatestRelease
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&release); err != nil {
		return githubLatestRelease{}, err
	}
	return release, nil
}

func currentDesktopAppVersion() (string, error) {
	if version := normalizeReleaseVersion(client.Version); version != "" {
		return version, nil
	}
	executable, err := os.Executable()
	if err != nil {
		return defaultAppVersion, nil
	}
	root := filepath.Dir(executable)
	for i := 0; i < 4; i++ {
		candidate := filepath.Join(root, "wails.json")
		if version, err := readProductVersionFromFile(candidate); err == nil && version != "" {
			return version, nil
		}
		root = filepath.Dir(root)
	}
	return defaultAppVersion, nil
}

func readProductVersionFromFile(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	var payload struct {
		Info struct {
			ProductVersion string `json:"productVersion"`
		} `json:"info"`
	}
	if err := json.Unmarshal(data, &payload); err != nil {
		return "", err
	}
	version := normalizeReleaseVersion(payload.Info.ProductVersion)
	if version == "" {
		return "", errors.New("empty productVersion")
	}
	return version, nil
}

func normalizeReleaseVersion(input string) string {
	value := strings.TrimSpace(input)
	value = strings.TrimPrefix(value, "v")
	value = strings.TrimPrefix(value, "V")
	if value == "" || !semverPattern.MatchString(value) {
		return ""
	}
	return value
}

func chooseReleaseURL(raw string) string {
	if strings.TrimSpace(raw) == "" {
		return releasesPageURL
	}
	return raw
}

func compareSemver(a, b string) int {
	pa, oka := parseSemver(a)
	pb, okb := parseSemver(b)
	if !oka && !okb {
		return strings.Compare(a, b)
	}
	if !oka {
		return -1
	}
	if !okb {
		return 1
	}
	if pa.major != pb.major {
		if pa.major > pb.major {
			return 1
		}
		return -1
	}
	if pa.minor != pb.minor {
		if pa.minor > pb.minor {
			return 1
		}
		return -1
	}
	if pa.patch != pb.patch {
		if pa.patch > pb.patch {
			return 1
		}
		return -1
	}
	return compareSemverSuffix(pa.prerelease, pb.prerelease)
}

type parsedSemver struct {
	major      int
	minor      int
	patch      int
	prerelease []string
}

func parseSemver(input string) (parsedSemver, bool) {
	value := normalizeReleaseVersion(input)
	if value == "" {
		return parsedSemver{}, false
	}
	withoutBuild := value
	if idx := strings.Index(withoutBuild, "+"); idx >= 0 {
		withoutBuild = withoutBuild[:idx]
	}
	core := withoutBuild
	var prerelease []string
	if idx := strings.Index(core, "-"); idx >= 0 {
		prerelease = strings.Split(core[idx+1:], ".")
		core = core[:idx]
	}
	parts := strings.Split(core, ".")
	if len(parts) != 3 {
		return parsedSemver{}, false
	}
	major, err := strconv.Atoi(parts[0])
	if err != nil {
		return parsedSemver{}, false
	}
	minor, err := strconv.Atoi(parts[1])
	if err != nil {
		return parsedSemver{}, false
	}
	patch, err := strconv.Atoi(parts[2])
	if err != nil {
		return parsedSemver{}, false
	}
	return parsedSemver{
		major:      major,
		minor:      minor,
		patch:      patch,
		prerelease: prerelease,
	}, true
}

func semverCore(input string) string {
	value := normalizeReleaseVersion(input)
	if value == "" {
		return ""
	}
	if idx := strings.Index(value, "+"); idx >= 0 {
		value = value[:idx]
	}
	if idx := strings.Index(value, "-"); idx >= 0 {
		value = value[:idx]
	}
	return value
}

func compareSemverSuffix(a, b []string) int {
	if len(a) == 0 && len(b) == 0 {
		return 0
	}
	if len(a) == 0 {
		return 1
	}
	if len(b) == 0 {
		return -1
	}
	limit := len(a)
	if len(b) < limit {
		limit = len(b)
	}
	for i := 0; i < limit; i++ {
		if a[i] == b[i] {
			continue
		}
		aNum, aNumOK := parseNumericPrereleaseIdentifier(a[i])
		bNum, bNumOK := parseNumericPrereleaseIdentifier(b[i])
		switch {
		case aNumOK && bNumOK:
			if aNum > bNum {
				return 1
			}
			return -1
		case aNumOK:
			return -1
		case bNumOK:
			return 1
		default:
			if a[i] > b[i] {
				return 1
			}
			return -1
		}
	}
	if len(a) > len(b) {
		return 1
	}
	if len(a) < len(b) {
		return -1
	}
	return 0
}

func parseNumericPrereleaseIdentifier(input string) (int, bool) {
	if input == "" {
		return 0, false
	}
	for _, ch := range input {
		if ch < '0' || ch > '9' {
			return 0, false
		}
	}
	value, err := strconv.Atoi(input)
	if err != nil {
		return 0, false
	}
	return value, true
}
