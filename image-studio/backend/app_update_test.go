package backend

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/yuanhua/image-gptcodex/pkg/client"
)

func TestCompareSemver(t *testing.T) {
	cases := []struct {
		name string
		a    string
		b    string
		want int
	}{
		{name: "major newer", a: "1.1.6", b: "0.1.5", want: 1},
		{name: "same version", a: "1.1.6", b: "1.1.6", want: 0},
		{name: "older patch", a: "1.1.5", b: "1.1.6", want: -1},
		{name: "strip v prefix", a: "v1.2.0", b: "1.1.9", want: 1},
		{name: "release beats prerelease", a: "1.2.0", b: "1.2.0-beta.1", want: 1},
		{name: "prerelease lower than release", a: "1.2.0-beta.1", b: "1.2.0", want: -1},
		{name: "build metadata ignored", a: "1.1.12+abc123", b: "1.1.12+def456", want: 0},
		{name: "ci prerelease newer than old stable", a: "1.1.12-ci.37.1+f1b0c7428c17", b: "0.1.5", want: 1},
		{name: "numeric prerelease identifiers compare numerically", a: "1.1.12-ci.10", b: "1.1.12-ci.2", want: 1},
		{name: "same core release and ci build compare as same update generation", a: "1.1.13", b: "1.1.13-ci.49.1+4c4e3507d6ca", want: 1},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := compareSemver(tc.a, tc.b)
			switch {
			case tc.want > 0 && got <= 0:
				t.Fatalf("compareSemver(%q, %q) = %d, want > 0", tc.a, tc.b, got)
			case tc.want < 0 && got >= 0:
				t.Fatalf("compareSemver(%q, %q) = %d, want < 0", tc.a, tc.b, got)
			case tc.want == 0 && got != 0:
				t.Fatalf("compareSemver(%q, %q) = %d, want 0", tc.a, tc.b, got)
			}
		})
	}
}

func TestNormalizeReleaseVersion(t *testing.T) {
	if got := normalizeReleaseVersion(" v1.1.6 "); got != "1.1.6" {
		t.Fatalf("normalizeReleaseVersion() = %q, want 1.1.6", got)
	}
	if got := normalizeReleaseVersion("1.1.12-ci.37.1+f1b0c7428c17"); got != "1.1.12-ci.37.1+f1b0c7428c17" {
		t.Fatalf("normalizeReleaseVersion() = %q, want ci version", got)
	}
	if got := normalizeReleaseVersion("release-1.1.6"); got != "" {
		t.Fatalf("normalizeReleaseVersion() = %q, want empty", got)
	}
}

func TestSemverCore(t *testing.T) {
	if got := semverCore("v1.1.13"); got != "1.1.13" {
		t.Fatalf("semverCore() = %q, want 1.1.13", got)
	}
	if got := semverCore("1.1.13-ci.49.1+4c4e3507d6ca"); got != "1.1.13" {
		t.Fatalf("semverCore() = %q, want 1.1.13", got)
	}
	if got := semverCore("release-1.1.13"); got != "" {
		t.Fatalf("semverCore() = %q, want empty", got)
	}
}

func TestCheckForAppUpdateDoesNotFlagSameCoreReleaseForCIBuild(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{
			"tag_name":"v1.1.13",
			"name":"v1.1.13",
			"html_url":"https://example.com/releases/v1.1.13",
			"published_at":"2026-06-07T00:00:00Z",
			"body":"bugfixes",
			"draft":false,
			"prerelease":false
		}`)
	}))
	defer srv.Close()

	t.Setenv(latestReleaseAPIURLEnv, srv.URL)
	original := client.Version
	client.Version = "1.1.13-ci.49.1+4c4e3507d6ca"
	t.Cleanup(func() { client.Version = original })

	info, err := new(Service).CheckForAppUpdate()
	if err != nil {
		t.Fatalf("CheckForAppUpdate() error = %v", err)
	}
	if info.HasUpdate {
		t.Fatalf("HasUpdate = true, want false for same-core CI build vs release")
	}
	if info.CurrentVersion != "1.1.13-ci.49.1+4c4e3507d6ca" {
		t.Fatalf("CurrentVersion = %q", info.CurrentVersion)
	}
	if info.LatestVersion != "1.1.13" {
		t.Fatalf("LatestVersion = %q", info.LatestVersion)
	}
}

func TestCaptureAppUpdateProbeWritesNoUpdateForSameCoreCIBuild(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{
			"tag_name":"v1.1.13",
			"name":"v1.1.13",
			"html_url":"https://example.com/releases/v1.1.13",
			"published_at":"2026-06-07T00:00:00Z",
			"body":"bugfixes",
			"draft":false,
			"prerelease":false
		}`)
	}))
	defer srv.Close()

	tempDir := t.TempDir()
	probePath := filepath.Join(tempDir, "app-update-probe.json")
	t.Setenv(latestReleaseAPIURLEnv, srv.URL)
	t.Setenv(appUpdateProbePathEnv, probePath)
	original := client.Version
	client.Version = "1.1.13-ci.49.1+4c4e3507d6ca"
	t.Cleanup(func() { client.Version = original })

	new(Service).captureAppUpdateProbe()

	var data []byte
	var err error
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		data, err = os.ReadFile(probePath)
		if err == nil {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if err != nil {
		t.Fatalf("ReadFile(%q) error = %v", probePath, err)
	}

	var probe AppUpdateProbeResult
	if err := json.Unmarshal(data, &probe); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}
	if probe.AppVersion != "1.1.13-ci.49.1+4c4e3507d6ca" {
		t.Fatalf("AppVersion = %q", probe.AppVersion)
	}
	if probe.CurrentVersion != "1.1.13-ci.49.1+4c4e3507d6ca" {
		t.Fatalf("CurrentVersion = %q", probe.CurrentVersion)
	}
	if probe.LatestVersion != "1.1.13" {
		t.Fatalf("LatestVersion = %q", probe.LatestVersion)
	}
	if !probe.UpdateInfoAvailable {
		t.Fatal("UpdateInfoAvailable = false, want true")
	}
	if probe.HasUpdate {
		t.Fatal("HasUpdate = true, want false")
	}
	if probe.ShouldShowUpdate {
		t.Fatal("ShouldShowUpdate = true, want false")
	}
	if probe.AppUpdateModalOpen {
		t.Fatal("AppUpdateModalOpen = true, want false")
	}
}
