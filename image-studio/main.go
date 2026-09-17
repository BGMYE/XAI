package main

import (
	"embed"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
	"image-studio/backend"
	bridge "image-studio/internal/desktopruntime"
	"io/fs"
	"log/slog"
	"os"
	"runtime"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	svc := backend.NewService()
	settings := backend.NewDesktopSettingsService(svc)
	host := &DesktopHost{}
	frontend, err := fs.Sub(assets, "frontend/dist")
	if err != nil {
		panic(err)
	}
	options := application.Options{
		Name: "Image Studio", Description: "XAI 图像工作室", LogLevel: slog.LevelError,
		Services:       []application.Service{application.NewService(svc), application.NewService(settings), application.NewService(host)},
		Assets:         application.AssetOptions{Handler: application.BundledAssetFileServer(frontend), Middleware: svc.MediaHandler, DisableLogging: true},
		SingleInstance: &application.SingleInstanceOptions{UniqueID: "top.gptcodex.imagestudio", OnSecondInstanceLaunch: func(data application.SecondInstanceData) { svc.HandlePromptImportArgs(data.Args); host.ShowMain() }},
		OnShutdown:     func() { backend.ShutdownDesktopService(svc, nil) },
		ShouldQuit:     host.canQuit,
	}
	if runtime.GOOS == "darwin" {
		if err := backend.MigrateMacWebkitDataDir(); err != nil {
			slog.Warn("WebKit data migration", "error", err)
		}
	}
	if runtime.GOOS == "windows" {
		dataPath, err := backend.WindowsWebviewUserDataPath()
		if err != nil {
			panic(err)
		}
		legacyPaths, err := backend.WindowsLegacyWebviewUserDataPaths()
		if err != nil {
			panic(err)
		}
		if err := backend.MigrateWindowsWebviewDataDirs(dataPath, legacyPaths); err != nil {
			slog.Warn("WebView data migration", "error", err)
		}
		browserPath, err := backend.WindowsPortableWebviewBrowserPath()
		if err != nil {
			slog.Warn("WebView runtime", "error", err)
		}
		if browserPath != "" {
			if err := backend.EnsureWindowsFixedWebviewRuntimePermissions(browserPath); err != nil {
				slog.Warn("WebView permissions", "error", err)
			}
		}
		options.Windows = application.WindowsOptions{WebviewUserDataPath: dataPath, WebviewBrowserPath: browserPath}
	}
	app := application.New(options)
	host.app = app
	host.main = app.Window.NewWithOptions(windowOptions("main", "Image Studio", "/", 1440, 980, 960, 640))
	host.main.OnWindowEvent(events.Common.WindowFilesDropped, func(event *application.WindowEvent) {
		result := backend.ImportDesktopDroppedImages(event.Context().DroppedFiles())
		dispatchDesktopWindowEvent(host.main, "desktop-images-dropped", result)
	})
	host.main.RegisterHook(events.Common.WindowClosing, func(event *application.WindowEvent) { event.Cancel(); app.Quit() })
	backend.ConfigureDesktopSettingsEvents(settings, func(revision int64) {
		app.Event.Emit("desktop-settings-changed", map[string]int64{"revision": revision})
	})
	backend.StartDesktopService(svc, bridge.WithDriver(app.Context(), host))
	app.Event.OnApplicationEvent(events.Common.ApplicationOpenedWithFile, func(event *application.ApplicationEvent) { svc.HandlePromptImportArgs(event.Context().OpenedFiles()) })
	app.Event.OnApplicationEvent(events.Common.ApplicationLaunchedWithUrl, func(event *application.ApplicationEvent) { svc.HandlePromptImportURL(event.Context().URL()) })
	host.installMenu()
	if err := app.Run(); err != nil {
		slog.Error("Desktop startup failed", "error", err)
		os.Exit(1)
	}
}

func windowOptions(name, title, url string, width, height, minWidth, minHeight int) application.WebviewWindowOptions {
	return application.WebviewWindowOptions{Name: name, Title: title, URL: desktopOriginURL(url), Width: width, Height: height, MinWidth: minWidth, MinHeight: minHeight,
		Frameless: runtime.GOOS != "darwin", EnableFileDrop: name == "main", BackgroundColour: application.NewRGB(245, 245, 247),
		Mac:     application.MacWindow{TitleBar: application.MacTitleBarHiddenInset, Appearance: application.NSAppearanceNameAqua, Backdrop: application.MacBackdropNormal},
		Windows: application.WindowsWindow{Theme: application.Light, BackdropType: application.None},
	}
}
