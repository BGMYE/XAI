package ui

import "testing"

func TestRepositoryLinksUseBGMYEXAI(t *testing.T) {
	wantRepo := "https://github.com/BGMYE/XAI"
	if repoURL != wantRepo {
		t.Fatalf("repoURL = %q, want %q", repoURL, wantRepo)
	}
	if issuesURL != wantRepo+"/issues" {
		t.Fatalf("issuesURL = %q, want %q", issuesURL, wantRepo+"/issues")
	}
	if releasesPageURL != wantRepo+"/releases" {
		t.Fatalf("releasesPageURL = %q, want %q", releasesPageURL, wantRepo+"/releases")
	}
	if latestReleaseAPIURL != "https://api.github.com/repos/BGMYE/XAI/releases/latest" {
		t.Fatalf("latestReleaseAPIURL = %q", latestReleaseAPIURL)
	}
}
