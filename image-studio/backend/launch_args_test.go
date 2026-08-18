package backend

import "testing"

func TestCommandLineArgValue(t *testing.T) {
	args := []string{
		"image-studio",
		"--image-studio-latest-release-api-url=https://example.com/latest.json",
		"--image-studio-app-update-probe-path",
		"/tmp/probe.json",
	}

	if got := commandLineArgValue(args, latestReleaseAPIURLArg); got != "https://example.com/latest.json" {
		t.Fatalf("commandLineArgValue() = %q, want https://example.com/latest.json", got)
	}
	if got := commandLineArgValue(args, appUpdateProbePathArg); got != "/tmp/probe.json" {
		t.Fatalf("commandLineArgValue() = %q, want /tmp/probe.json", got)
	}
	if got := commandLineArgValue(args, "--missing"); got != "" {
		t.Fatalf("commandLineArgValue() = %q, want empty", got)
	}
}

func TestCommandLineBoolFlag(t *testing.T) {
	if !commandLineBoolFlag([]string{"image-studio", appUpdateProbeQuitArg}, appUpdateProbeQuitArg) {
		t.Fatal("commandLineBoolFlag() = false, want true for bare flag")
	}
	if !commandLineBoolFlag([]string{"image-studio", appUpdateProbeQuitArg + "=1"}, appUpdateProbeQuitArg) {
		t.Fatal("commandLineBoolFlag() = false, want true for =1")
	}
	if commandLineBoolFlag([]string{"image-studio", appUpdateProbeQuitArg + "=false"}, appUpdateProbeQuitArg) {
		t.Fatal("commandLineBoolFlag() = true, want false for =false")
	}
}
