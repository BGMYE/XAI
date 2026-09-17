import type { RuntimeBinding, ServiceBinding } from "./hostBindings";

type WailsRuntime = typeof import("@wailsio/runtime");
let native: WailsRuntime | null = null;

export function hasDesktopSettingsHost(): boolean { return native !== null; }

export async function installDesktopRuntime(): Promise<void> {
  if (typeof window === "undefined") return;
  const isDesktopOrigin = window.location.hostname === "wails.localhost" || window.location.protocol === "wails:";
  const bridge = window as Window & { _wails?: { invoke?: unknown }; go?: { backend?: { Service?: ServiceBinding } }; runtime?: RuntimeBinding };
  if (!isDesktopOrigin && !bridge._wails?.invoke) return;
  native = await import("@wailsio/runtime");
  const runtime = native;
  runtime.Events.On("desktop-edit-command", (event) => {
    const command = event.data?.command;
    if (command !== "undo" && command !== "redo") return;
    const active = document.activeElement as HTMLElement | null;
    if (active && (active.matches("input, textarea") || active.isContentEditable)) {
      document.execCommand(command);
    } else {
      window.dispatchEvent(new CustomEvent("studio:edit-command", { detail: { command } }));
    }
  });
  bridge.go = { ...bridge.go, backend: { ...bridge.go?.backend, Service: new Proxy({} as ServiceBinding, {
    get: (_target, name) => typeof name === "string" ? (...args: unknown[]) => runtime.Call.ByName(`image-studio/backend.Service.${name}`, ...args) : undefined,
  }) } };
  bridge.runtime = {
    EventsOnMultiple: (name, callback, count = -1) => runtime.Events.OnMultiple(name, (event) => callback(event.data), count),
    EventsOff: (name, ...names) => runtime.Events.Off(name, ...names),
    WindowSetSystemDefaultTheme: () => {},
    WindowFullscreen: () => { void runtime.Window.Fullscreen(); },
    WindowUnfullscreen: () => { void runtime.Window.UnFullscreen(); },
    WindowIsFullscreen: () => runtime.Window.IsFullscreen(),
    WindowMinimise: () => { void runtime.Window.Minimise(); },
    WindowToggleMaximise: () => { void runtime.Window.ToggleMaximise(); },
    WindowClose: () => { void runtime.Window.Close(); },
    Quit: () => { void runtime.Application.Quit(); },
    OpenSettings: () => { void invokeDesktopHost("OpenSettings"); },
  };
}

export function invokeDesktopSettings<T>(method: string, ...args: unknown[]): Promise<T> {
  if (!native) return Promise.reject(new Error("请在桌面应用中管理连接与模型"));
  return native.Call.ByName(`image-studio/backend.DesktopSettingsService.${method}`, ...args) as Promise<T>;
}
export function invokeDesktopHost<T = void>(method: string, ...args: unknown[]): Promise<T> {
  if (!native) return Promise.reject(new Error("此操作需要桌面窗口"));
  return native.Call.ByName(`main.DesktopHost.${method}`, ...args) as Promise<T>;
}
export function invokeDesktopService<T>(method: string, ...args: unknown[]): Promise<T> {
  if (!native) return Promise.reject(new Error("此操作需要桌面应用"));
  return native.Call.ByName(`image-studio/backend.Service.${method}`, ...args) as Promise<T>;
}
export function subscribeDesktopSettings(callback: (event: { revision: number }) => void): () => void {
  return native?.Events.On("desktop-settings-changed", (event) => callback(event.data)) ?? (() => {});
}
export function closeDesktopSettingsWindow(): Promise<void> { return invokeDesktopHost("CloseSettingsWindow"); }
export function setDesktopSettingsDirty(dirty: boolean): Promise<void> { return invokeDesktopHost("SetSettingsDirty", dirty); }
export function setDesktopWindowTitle(title: string): Promise<void> { return native?.Window.SetTitle(title) ?? Promise.resolve(); }
