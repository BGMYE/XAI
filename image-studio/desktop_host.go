package main

import (
	"errors"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
	bridge "image-studio/internal/desktopruntime"
	"runtime"
	"sync"
)

// DesktopHost owns window lifetimes. The settings view never starts a workspace.
type DesktopHost struct {
	app                   *application.App
	main                  *application.WebviewWindow
	settings              *application.WebviewWindow
	mu                    sync.Mutex
	dirty                 bool
	settingsReady         bool
	settingsCloseApproved bool
	quitAfterSettings     bool
	workspaceReady        bool
	flushPending          bool
	quitApproved          bool
}

func (h *DesktopHost) OpenSettings() {
	application.InvokeSync(func() {
		h.mu.Lock()
		if h.settings != nil {
			window := h.settings
			h.mu.Unlock()
			window.Show()
			window.Focus()
			return
		}
		options := windowOptions("settings", "设置", "/?window=settings", 1060, 820, 720, 560)
		options.MinimiseButtonState = application.ButtonDisabled
		options.MaximiseButtonState = application.ButtonDisabled
		options.FullscreenButtonState = application.ButtonDisabled
		window := h.app.Window.NewWithOptions(options)
		h.settings = window
		h.dirty, h.settingsReady, h.settingsCloseApproved = false, false, false
		h.mu.Unlock()
		window.RegisterHook(events.Common.WindowClosing, func(event *application.WindowEvent) {
			if !h.allowSettingsClose(window) {
				event.Cancel()
				dispatchDesktopWindowEvent(window, "desktop-settings-close-request")
			}
		})
	})
}

func (h *DesktopHost) allowSettingsClose(window *application.WebviewWindow) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.settings != window {
		return true
	}
	// Once the frontend is ready it must decide, even if its latest dirty
	// notification is still in flight after the user typed into a field.
	if (h.settingsReady || h.dirty) && !h.settingsCloseApproved {
		return false
	}
	h.settings = nil
	h.dirty, h.settingsReady, h.settingsCloseApproved = false, false, false
	return true
}
func (h *DesktopHost) SettingsWindowReady() {
	h.mu.Lock()
	if h.settings != nil {
		h.settingsReady = true
	}
	h.mu.Unlock()
}
func (h *DesktopHost) SetSettingsDirty(dirty bool) {
	h.mu.Lock()
	if h.settings != nil && !h.settingsCloseApproved {
		h.dirty = dirty
	}
	h.mu.Unlock()
}
func (h *DesktopHost) CancelSettingsCloseRequest() {
	h.mu.Lock()
	h.quitAfterSettings = false
	h.quitApproved = false
	h.flushPending = false
	h.mu.Unlock()
}
func (h *DesktopHost) RequestCloseSettingsWindow() {
	application.InvokeSync(func() {
		h.mu.Lock()
		window := h.settings
		h.mu.Unlock()
		if window != nil {
			window.Close()
		}
	})
}
func (h *DesktopHost) CloseSettingsWindow() {
	window, quit := h.approveSettingsClose()
	if window != nil {
		window.Close()
	}
	if quit {
		h.app.Quit()
	}
}
func (h *DesktopHost) approveSettingsClose() (*application.WebviewWindow, bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.dirty = false
	h.settingsCloseApproved = true
	quit := h.quitAfterSettings
	h.quitAfterSettings = false
	return h.settings, quit
}

type desktopQuitAction uint8

const (
	desktopQuitNow desktopQuitAction = iota
	desktopQuitResolveSettings
	desktopQuitFlushWorkspace
	desktopQuitAwaitFlush
)

func (h *DesktopHost) nextQuitAction() desktopQuitAction {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.settings != nil && (h.settingsReady || h.dirty) && !h.settingsCloseApproved {
		h.quitAfterSettings = true
		h.quitApproved = false
		return desktopQuitResolveSettings
	}
	if !h.workspaceReady || h.quitApproved {
		return desktopQuitNow
	}
	if h.flushPending {
		return desktopQuitAwaitFlush
	}
	h.flushPending = true
	return desktopQuitFlushWorkspace
}
func (h *DesktopHost) canQuit() bool {
	switch h.nextQuitAction() {
	case desktopQuitNow:
		return true
	case desktopQuitResolveSettings:
		h.OpenSettings()
		h.emitSettingsEvent("desktop-settings-close-request")
	case desktopQuitFlushWorkspace:
		dispatchDesktopWindowEvent(h.main, "desktop-workspace-flush-request")
	}
	return false
}
func (h *DesktopHost) WorkspacePersistenceReady() {
	h.mu.Lock()
	h.workspaceReady = true
	h.mu.Unlock()
}
func (h *DesktopHost) CompleteWorkspaceFlush(success bool) {
	if h.acceptWorkspaceFlush(success) {
		h.app.Quit()
	}
}
func (h *DesktopHost) acceptWorkspaceFlush(success bool) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	if !h.flushPending {
		return false
	}
	h.flushPending = false
	h.quitApproved = success
	return success
}
func (h *DesktopHost) RequestWorkspaceCommand(command, requestID string) error {
	switch command {
	case "export-history", "import-history", "clear-history", "prune-history-3", "prune-history-7":
	default:
		return errors.New("不支持的作品操作")
	}
	dispatchDesktopWindowEvent(h.main, "desktop-workspace-command", map[string]string{"command": command, "requestId": requestID})
	return nil
}
func (h *DesktopHost) CompleteWorkspaceCommand(requestID string, success bool, message string) {
	h.emitSettingsEvent("desktop-workspace-command-result", map[string]any{"requestId": requestID, "success": success, "message": message})
}
func (h *DesktopHost) emitSettingsEvent(name string, data ...any) {
	h.mu.Lock()
	window := h.settings
	h.mu.Unlock()
	if window != nil {
		dispatchDesktopWindowEvent(window, name, data...)
	}
}

// EmitEvent broadcasts to every Wails window, including when called on a
// window. UI commands instead use the public per-window dispatcher.
func dispatchDesktopWindowEvent(window interface {
	DispatchWailsEvent(*application.CustomEvent)
}, name string, data ...any) {
	event := &application.CustomEvent{Name: name}
	if len(data) == 1 {
		event.Data = data[0]
	} else if len(data) > 1 {
		event.Data = data
	}
	window.DispatchWailsEvent(event)
}
func (h *DesktopHost) ShowMain() {
	if h.main != nil {
		h.main.UnMinimise()
		h.main.Show()
		h.main.Focus()
	}
}
func (h *DesktopHost) Quit() { h.app.Quit() }
func (h *DesktopHost) Emit(name string, data ...any) {
	dispatchDesktopWindowEvent(h.main, name, data...)
}
func (h *DesktopHost) Open(options bridge.OpenDialogOptions, multiple, directory bool) ([]string, error) {
	dialog := h.app.Dialog.OpenFile().SetTitle(options.Title).SetDirectory(options.DefaultDirectory).CanChooseFiles(!directory).CanChooseDirectories(directory)
	if owner := h.app.Window.Current(); owner != nil {
		dialog.AttachToWindow(owner)
	}
	for _, filter := range options.Filters {
		dialog.AddFilter(filter.DisplayName, filter.Pattern)
	}
	if multiple {
		return dialog.PromptForMultipleSelection()
	}
	path, err := dialog.PromptForSingleSelection()
	if path == "" || err != nil {
		return nil, err
	}
	return []string{path}, nil
}
func (h *DesktopHost) Save(options bridge.SaveDialogOptions) (string, error) {
	dialog := h.app.Dialog.SaveFileWithOptions(&application.SaveFileDialogOptions{Title: options.Title, Filename: options.DefaultFilename, Directory: options.DefaultDirectory})
	if owner := h.app.Window.Current(); owner != nil {
		dialog.AttachToWindow(owner)
	}
	for _, filter := range options.Filters {
		dialog.AddFilter(filter.DisplayName, filter.Pattern)
	}
	return dialog.PromptForSingleSelection()
}
func (h *DesktopHost) command(command string) {
	h.ShowMain()
	dispatchDesktopWindowEvent(h.main, "desktop-command", map[string]string{"command": command})
}
func (h *DesktopHost) installMenu() {
	menu := application.NewMenu()
	if runtime.GOOS == "darwin" {
		appMenu := menu.AddSubmenu("Image Studio")
		appMenu.AddRole(application.About)
		appMenu.AddSeparator()
		appMenu.Add("设置…").SetAccelerator("CmdOrCtrl+,").OnClick(func(*application.Context) { h.OpenSettings() })
		appMenu.AddSeparator()
		appMenu.AddRole(application.ServicesMenu)
		appMenu.AddSeparator()
		appMenu.AddRole(application.Hide)
		appMenu.AddRole(application.HideOthers)
		appMenu.AddRole(application.UnHide)
		appMenu.AddSeparator()
		appMenu.AddRole(application.Quit)
	}
	file := menu.AddSubmenu("文件")
	file.Add("新建工作区").SetAccelerator("CmdOrCtrl+N").OnClick(func(*application.Context) { h.command("new-workspace") })
	file.Add("添加素材…").SetAccelerator("CmdOrCtrl+O").OnClick(func(*application.Context) { h.command("add-material") })
	file.Add("导出所选图片…").SetAccelerator("CmdOrCtrl+Shift+S").OnClick(func(*application.Context) { h.command("save") })
	if runtime.GOOS != "darwin" {
		file.AddSeparator()
		file.Add("设置…").SetAccelerator("CmdOrCtrl+,").OnClick(func(*application.Context) { h.OpenSettings() })
	}
	edit := menu.AddSubmenu("编辑")
	for _, item := range []struct{ label, command, key string }{{"撤销", "undo", "CmdOrCtrl+Z"}, {"重做", "redo", "CmdOrCtrl+Shift+Z"}} {
		command := item.command
		edit.Add(item.label).SetAccelerator(item.key).OnClick(func(*application.Context) {
			if current := h.app.Window.Current(); current != nil {
				dispatchDesktopWindowEvent(current, "desktop-edit-command", map[string]string{"command": command})
			}
		})
	}
	edit.AddSeparator()
	edit.AddRole(application.Cut)
	edit.AddRole(application.Copy)
	edit.AddRole(application.Paste)
	edit.AddRole(application.SelectAll)
	view := menu.AddSubmenu("视图")
	for _, item := range []struct{ label, command, key string }{{"简洁模式", "simple", "CmdOrCtrl+1"}, {"专业模式", "pro", "CmdOrCtrl+2"}, {"作品", "library", "CmdOrCtrl+3"}, {"适配画布", "fit", ""}, {"放大", "zoom-in", ""}, {"缩小", "zoom-out", ""}} {
		command := item.command
		entry := view.Add(item.label).OnClick(func(*application.Context) { h.command(command) })
		if item.key != "" {
			entry.SetAccelerator(item.key)
		}
	}
	menu.AddRole(application.WindowMenu)
	h.app.Menu.Set(menu)
	h.main.RegisterKeyBinding("CmdOrCtrl+,", func(application.Window) { h.OpenSettings() })
}
