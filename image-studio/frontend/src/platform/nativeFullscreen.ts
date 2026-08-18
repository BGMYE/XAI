import { readRuntimePlatformState } from ".";
import { hasAndroidInvokeBridge, invokeAndroidNative } from "./android/nativeInvoke";
import { getRuntime } from "./runtime/hostBindings";

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

export async function setNativeFullscreen(enabled: boolean): Promise<void> {
  if (typeof window === "undefined") return;
  const platform = readRuntimePlatformState();

  if (platform.isAndroid && hasAndroidInvokeBridge()) {
    await invokeAndroidNative("SetFullscreen", enabled);
    dispatchFullscreenResize();
    return;
  }

  const runtime = getRuntime();
  if (runtime?.WindowFullscreen && runtime.WindowUnfullscreen) {
    if (enabled) runtime.WindowFullscreen();
    else runtime.WindowUnfullscreen();
    dispatchFullscreenResize();
    return;
  }

  await setBrowserElementFullscreen(enabled);
  dispatchFullscreenResize();
}

export async function isNativeFullscreen(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const platform = readRuntimePlatformState();
  if (platform.isAndroid) {
    try {
      return await invokeAndroidNative<boolean>("IsFullscreen");
    } catch {
      return false;
    }
  }

  const runtime = getRuntime();
  if (runtime?.WindowIsFullscreen) {
    try {
      return await runtime.WindowIsFullscreen();
    } catch {
      return false;
    }
  }

  const doc = document as FullscreenDocument;
  return !!(document.fullscreenElement || doc.webkitFullscreenElement);
}

export function dispatchFullscreenResize() {
  if (typeof window === "undefined") return;
  const notify = () => {
    window.dispatchEvent(new Event("resize"));
    window.visualViewport?.dispatchEvent(new Event("resize"));
  };
  notify();
  window.requestAnimationFrame?.(notify);
  window.setTimeout(notify, 120);
}

async function setBrowserElementFullscreen(enabled: boolean) {
  const doc = document as FullscreenDocument;
  const root = document.documentElement as FullscreenElement;
  const active = document.fullscreenElement || doc.webkitFullscreenElement;

  if (enabled && !active) {
    const request = root.requestFullscreen?.bind(root) ?? root.webkitRequestFullscreen?.bind(root);
    await request?.();
  } else if (!enabled && active) {
    const exit = document.exitFullscreen?.bind(document) ?? doc.webkitExitFullscreen?.bind(doc);
    await exit?.();
  }
}
