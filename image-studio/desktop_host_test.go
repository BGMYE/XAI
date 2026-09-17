package main

import (
	"sync"
	"testing"

	"github.com/wailsapp/wails/v3/pkg/application"
)

func TestSettingsCloseDelegatesToReadyFrontendBeforeDirtyNotification(t *testing.T) {
	window := &application.WebviewWindow{}
	host := &DesktopHost{settings: window, settingsReady: true, workspaceReady: true}
	if host.allowSettingsClose(window) {
		t.Fatal("ready settings must check its draft even before dirty notification arrives")
	}
	if action := host.nextQuitAction(); action != desktopQuitResolveSettings {
		t.Fatalf("application quit skipped settings: %v", action)
	}
	host.CancelSettingsCloseRequest()
	_, quit := host.approveSettingsClose()
	if quit {
		t.Fatal("closing settings after cancelling application quit must not exit the application")
	}
	host.SetSettingsDirty(true)
	if !host.allowSettingsClose(window) || host.settings != nil {
		t.Fatal("late dirty notification blocked an already-approved close")
	}
}

func TestApplicationQuitResolvesSettingsThenFlushesWorkspaceOnce(t *testing.T) {
	window := &application.WebviewWindow{}
	host := &DesktopHost{settings: window, settingsReady: true, dirty: true, workspaceReady: true}
	if host.nextQuitAction() != desktopQuitResolveSettings {
		t.Fatal("quit must resolve settings first")
	}
	closed, quit := host.approveSettingsClose()
	if closed != window || !quit {
		t.Fatal("saving or discarding settings must resume the original application quit")
	}
	if !host.allowSettingsClose(window) {
		t.Fatal("approved settings did not close")
	}
	if host.nextQuitAction() != desktopQuitFlushWorkspace || host.nextQuitAction() != desktopQuitAwaitFlush {
		t.Fatal("repeated quit requests must emit one workspace flush")
	}
	if host.acceptWorkspaceFlush(false) || host.nextQuitAction() != desktopQuitFlushWorkspace {
		t.Fatal("failed persistence must leave the application open and allow retry")
	}
	if !host.acceptWorkspaceFlush(true) || host.nextQuitAction() != desktopQuitNow {
		t.Fatal("successful persistence must allow application shutdown")
	}
	if host.acceptWorkspaceFlush(true) {
		t.Fatal("duplicate acknowledgements must not trigger shutdown twice")
	}
}

func TestCancelledQuitIgnoresLateWorkspaceFlush(t *testing.T) {
	host := &DesktopHost{workspaceReady: true}
	if host.nextQuitAction() != desktopQuitFlushWorkspace {
		t.Fatal("expected pending flush")
	}
	host.CancelSettingsCloseRequest()
	if host.acceptWorkspaceFlush(true) {
		t.Fatal("late flush completion must not override the user's cancelled quit")
	}
	if host.nextQuitAction() != desktopQuitFlushWorkspace {
		t.Fatal("new quit must save the latest workspace state again")
	}
}

func TestClosedSettingsHooksDoNotClearNewWindow(t *testing.T) {
	oldWindow, newWindow := &application.WebviewWindow{}, &application.WebviewWindow{}
	host := &DesktopHost{settings: newWindow, settingsReady: true}
	if !host.allowSettingsClose(oldWindow) || host.settings != newWindow {
		t.Fatal("old close event affected the current settings window")
	}
	initializing := &DesktopHost{settings: oldWindow}
	if !initializing.allowSettingsClose(oldWindow) {
		t.Fatal("settings without a ready frontend must remain closable")
	}
}

type testDesktopEventWindow struct{ events []*application.CustomEvent }

func (w *testDesktopEventWindow) DispatchWailsEvent(event *application.CustomEvent) {
	w.events = append(w.events, event)
}

func TestDesktopCommandsOnlyReachTheTargetWindow(t *testing.T) {
	mainWindow, settingsWindow := &testDesktopEventWindow{}, &testDesktopEventWindow{}
	dispatchDesktopWindowEvent(settingsWindow, "desktop-edit-command", map[string]string{"command": "undo"})
	if len(mainWindow.events) != 0 || len(settingsWindow.events) != 1 {
		t.Fatal("settings undo leaked into the main workspace")
	}
	if settingsWindow.events[0].Data.(map[string]string)["command"] != "undo" {
		t.Fatal("command payload was not preserved")
	}
	dispatchDesktopWindowEvent(mainWindow, "desktop-workspace-flush-request")
	if len(mainWindow.events) != 1 || len(settingsWindow.events) != 1 {
		t.Fatal("workspace flush leaked into the lightweight settings window")
	}
}

func TestDesktopCloseStateCanHandleConcurrentNotifications(t *testing.T) {
	window := &application.WebviewWindow{}
	host := &DesktopHost{settings: window, workspaceReady: true}
	var group sync.WaitGroup
	for range 20 {
		group.Add(1)
		go func() {
			defer group.Done()
			host.SettingsWindowReady()
			host.SetSettingsDirty(true)
			host.nextQuitAction()
			host.CancelSettingsCloseRequest()
		}()
	}
	group.Wait()
	host.approveSettingsClose()
	if !host.allowSettingsClose(window) {
		t.Fatal("approved settings must close after concurrent notifications")
	}
}
