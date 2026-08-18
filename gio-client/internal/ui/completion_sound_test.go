package ui

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	sharedCompat "image-studio/shared/compat"
)

func TestShouldPlayCompletionSoundOnlyOnFinalResult(t *testing.T) {
	config := sharedCompat.CompletionSoundSettings{Enabled: true, Mode: "default"}
	if shouldPlayCompletionSound(config, 1, 3) {
		t.Fatal("should not play before final result")
	}
	if !shouldPlayCompletionSound(config, 3, 3) {
		t.Fatal("should play on final result")
	}
}

func TestShouldPlayCompletionSoundHonoursDisabledState(t *testing.T) {
	config := sharedCompat.CompletionSoundSettings{Enabled: false, Mode: "default"}
	if shouldPlayCompletionSound(config, 1, 1) {
		t.Fatal("disabled completion sound should not play")
	}
}

func TestImportCompletionSoundFileRejectsOversizedInput(t *testing.T) {
	path := filepath.Join(t.TempDir(), "too-large.wav")
	if err := os.WriteFile(path, make([]byte, maxCompletionSoundBytes+1), 0o600); err != nil {
		t.Fatalf("write oversized audio: %v", err)
	}
	if _, _, err := importCompletionSoundFile(path); err == nil {
		t.Fatal("expected oversized audio to be rejected")
	}
}

func TestImportCompletionSoundFileReturnsDataURL(t *testing.T) {
	path := filepath.Join(t.TempDir(), "ding.wav")
	if err := os.WriteFile(path, []byte{1, 2, 3, 4}, 0o600); err != nil {
		t.Fatalf("write audio: %v", err)
	}
	name, dataURL, err := importCompletionSoundFile(path)
	if err != nil {
		t.Fatalf("importCompletionSoundFile: %v", err)
	}
	if name != "ding.wav" {
		t.Fatalf("name=%q want ding.wav", name)
	}
	if got, want := dataURL[:22], "data:audio/wav;base64,"; len(dataURL) < len(want) || got != want {
		t.Fatalf("dataURL=%q want prefix %q", dataURL, want)
	}
}

func TestPreviewCompletionSoundForcesPlayback(t *testing.T) {
	app := &App{
		completionSound: sharedCompat.CompletionSoundSettings{Enabled: false, Mode: "default"},
	}
	called := make(chan bool, 1)
	orig := playCompletionSoundFunc
	playCompletionSoundFunc = func(config sharedCompat.CompletionSoundSettings, force bool) error {
		called <- force
		return nil
	}
	defer func() { playCompletionSoundFunc = orig }()

	app.previewCompletionSound()

	select {
	case force := <-called:
		if !force {
			t.Fatal("preview should force playback")
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for preview playback")
	}
}

func TestMaybePlayCompletionSoundOnlyTriggersOnFinalResult(t *testing.T) {
	app := &App{
		completionSound: sharedCompat.CompletionSoundSettings{Enabled: true, Mode: "default"},
	}
	calls := make(chan bool, 2)
	orig := playCompletionSoundFunc
	playCompletionSoundFunc = func(config sharedCompat.CompletionSoundSettings, force bool) error {
		calls <- force
		return nil
	}
	defer func() { playCompletionSoundFunc = orig }()

	app.maybePlayCompletionSound(1, 2)
	select {
	case <-calls:
		t.Fatal("should not play before final result")
	case <-time.After(200 * time.Millisecond):
	}

	app.maybePlayCompletionSound(2, 2)
	select {
	case force := <-calls:
		if force {
			t.Fatal("final settlement playback should not be forced")
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for final completion playback")
	}
}
