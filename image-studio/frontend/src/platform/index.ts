import { useEffect, useState } from "react";

export type UIPlatform = "macos" | "windows" | "linux" | "ios" | "android" | "web";
export type UITargetPlatform = UIPlatform | "android-pad";
export type UIFamily = "apple" | "fluent" | "android" | "generic";
export type AndroidWindowClass = "compact" | "medium" | "expanded";

const ANDROID_MEDIUM_WIDTH_DP = 600;
const ANDROID_EXPANDED_WIDTH_DP = 840;
const ANDROID_METRICS_CACHE_KEY = "__imageStudioAndroidMetrics";

function fromOverride(raw?: string): UITargetPlatform | null {
  switch ((raw ?? "").trim().toLowerCase()) {
    case "mac":
    case "macos":
    case "darwin":
      return "macos";
    case "windows":
    case "win":
    case "win32":
      return "windows";
    case "linux":
      return "linux";
    case "ios":
      return "ios";
    case "android":
      return "android";
    case "android-pad":
    case "android_tablet":
    case "android-tablet":
    case "tablet":
    case "pad":
      return "android-pad";
    case "web":
      return "web";
    default:
      return null;
  }
}

function readTargetOverrideFromURL(): UITargetPlatform | null {
  if (typeof window === "undefined") return null;
  try {
    const params = new URLSearchParams(window.location.search);
    return fromOverride(params.get("target") ?? params.get("platform") ?? undefined);
  } catch {
    return null;
  }
}

type AndroidBridgeMetrics = {
  widthPx?: number;
  heightPx?: number;
  density?: number;
  densityDpi?: number;
  screenWidthDp?: number;
  screenHeightDp?: number;
  smallestScreenWidthDp?: number;
  orientation?: string;
};

function readAndroidBridgeMetrics(): AndroidBridgeMetrics | null {
  if (typeof window === "undefined") return null;
  const cached = (window as Window & { [ANDROID_METRICS_CACHE_KEY]?: AndroidBridgeMetrics })[ANDROID_METRICS_CACHE_KEY];
  if (cached) return cached;
  const bridge = (window as Window & {
    AndroidImageStudio?: { getDisplayMetricsJson?: () => string };
    Android?: { getDisplayMetricsJson?: () => string };
  }).AndroidImageStudio ?? (window as Window & {
    AndroidImageStudio?: { getDisplayMetricsJson?: () => string };
    Android?: { getDisplayMetricsJson?: () => string };
  }).Android;
  const raw = bridge?.getDisplayMetricsJson?.();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AndroidBridgeMetrics;
    (window as Window & { [ANDROID_METRICS_CACHE_KEY]?: AndroidBridgeMetrics })[ANDROID_METRICS_CACHE_KEY] = parsed;
    return parsed;
  } catch {
    return null;
  }
}

function detectRawTargetPlatform(): UITargetPlatform {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  const urlOverride = readTargetOverrideFromURL();
  if (urlOverride) return urlOverride;
  const override = fromOverride(env?.VITE_TARGET_PLATFORM);
  if (override) return override;
  if (typeof navigator === "undefined") return override ?? "web";

  const uaDataPlatform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? "";
  const platform = navigator.platform ?? "";
  const userAgent = navigator.userAgent ?? "";
  const source = `${uaDataPlatform} ${platform} ${userAgent}`.toLowerCase();

  if (/iphone|ipad|ipod|ios/.test(source)) return "ios";
  if (/android/.test(source)) return "android";
  if (/mac/.test(source)) return "macos";
  if (/win/.test(source)) return "windows";
  if (/linux|x11/.test(source)) return "linux";
  return "web";
}

function detectAndroidAdaptiveTarget(): UITargetPlatform {
  const widthClass = androidWidthClassForViewport();
  if (widthClass === "compact") return "android";
  if (widthClass === "medium") {
    return androidOrientationForViewport() === "landscape" ? "android-pad" : "android";
  }
  return "android-pad";
}

function androidWidthDpForViewport(): number {
  if (typeof window === "undefined") return 0;
  const bridgeMetrics = readAndroidBridgeMetrics();
  const widthPx = Math.max(0, bridgeMetrics?.widthPx ?? window.innerWidth ?? 0);
  const bridgeDensity = bridgeMetrics?.density;
  const bridgeDensityFromDpi = bridgeMetrics?.densityDpi ? bridgeMetrics.densityDpi / 160 : undefined;
  const density = Math.max(1, bridgeDensity ?? bridgeDensityFromDpi ?? window.devicePixelRatio ?? 1);
  const widthDp = Math.max(0, bridgeMetrics?.screenWidthDp ?? widthPx / density);
  return widthDp;
}

function androidHeightDpForViewport(): number {
  if (typeof window === "undefined") return 0;
  const bridgeMetrics = readAndroidBridgeMetrics();
  const heightPx = Math.max(0, bridgeMetrics?.heightPx ?? window.innerHeight ?? 0);
  const bridgeDensity = bridgeMetrics?.density;
  const bridgeDensityFromDpi = bridgeMetrics?.densityDpi ? bridgeMetrics.densityDpi / 160 : undefined;
  const density = Math.max(1, bridgeDensity ?? bridgeDensityFromDpi ?? window.devicePixelRatio ?? 1);
  return Math.max(0, bridgeMetrics?.screenHeightDp ?? heightPx / density);
}

function androidOrientationForViewport(): "landscape" | "portrait" {
  if (typeof window === "undefined") return "portrait";
  const bridgeMetrics = readAndroidBridgeMetrics();
  if (bridgeMetrics?.orientation === "landscape") return "landscape";
  if (bridgeMetrics?.orientation === "portrait") return "portrait";
  return androidWidthDpForViewport() >= androidHeightDpForViewport() ? "landscape" : "portrait";
}

function androidWindowClassFromDp(valueDp: number): AndroidWindowClass {
  if (valueDp < ANDROID_MEDIUM_WIDTH_DP) return "compact";
  if (valueDp < ANDROID_EXPANDED_WIDTH_DP) return "medium";
  return "expanded";
}

function androidWidthClassForViewport(): AndroidWindowClass {
  return androidWindowClassFromDp(androidWidthDpForViewport());
}

function androidHeightClassForViewport(): AndroidWindowClass {
  return androidWindowClassFromDp(androidHeightDpForViewport());
}

function normalizeRuntimePlatform(value: UITargetPlatform): UIPlatform {
  if (value === "android-pad") return "android";
  return value;
}

function familyForTarget(value: UITargetPlatform): UIFamily {
  switch (value) {
    case "macos":
    case "ios":
      return "apple";
    case "android":
    case "android-pad":
      return "android";
    case "windows":
    case "linux":
      return "fluent";
    default:
      return "generic";
  }
}

const rawTargetPlatform = detectRawTargetPlatform();

export function targetPlatformForViewport(): UITargetPlatform {
  if (rawTargetPlatform !== "android") return rawTargetPlatform;
  return detectAndroidAdaptiveTarget();
}

export function readRuntimePlatformState() {
  const target = targetPlatformForViewport();
  const platform = normalizeRuntimePlatform(target);
  const uiFamily = familyForTarget(target);
  const androidWidthClass = platform === "android" ? androidWidthClassForViewport() : undefined;
  const androidHeightClass = platform === "android" ? androidHeightClassForViewport() : undefined;
  const androidOrientation = platform === "android" ? androidOrientationForViewport() : undefined;
  return {
    targetPlatform: target,
    platform,
    uiFamily,
    androidWidthClass,
    androidHeightClass,
    androidOrientation,
    isAndroid: platform === "android",
    isAndroidPad: target === "android-pad",
    isAndroidPhone: target === "android",
    isMac: platform === "macos" || platform === "ios",
    isWindows: platform === "windows",
    isLinux: platform === "linux",
    usesAppleUI: uiFamily === "apple",
    usesFluentUI: uiFamily === "fluent",
    usesAndroidUI: uiFamily === "android",
  };
}

const initialState = readRuntimePlatformState();

export const targetPlatform = initialState.targetPlatform;
export const platform = initialState.platform;
export const uiFamily = initialState.uiFamily;
export const isAndroid = initialState.isAndroid;
export const isAndroidPad = initialState.isAndroidPad;
export const isAndroidPhone = initialState.isAndroidPhone;
export const usesAppleUI = initialState.usesAppleUI;
export const usesFluentUI = initialState.usesFluentUI;
export const usesAndroidUI = initialState.usesAndroidUI;
export const isMac = initialState.isMac;
export const isWindows = initialState.isWindows;
export const isLinux = initialState.isLinux;

export function applyPlatformAttributes(root: HTMLElement = document.documentElement) {
  if (!root) return;
  const state = readRuntimePlatformState();
  root.dataset.platform = state.platform;
  root.dataset.targetPlatform = state.targetPlatform;
  root.dataset.uiFamily = state.uiFamily;
  if (state.androidWidthClass) root.dataset.androidWindowWidth = state.androidWidthClass;
  else delete root.dataset.androidWindowWidth;
  if (state.androidHeightClass) root.dataset.androidWindowHeight = state.androidHeightClass;
  else delete root.dataset.androidWindowHeight;
  if (state.androidOrientation) root.dataset.androidOrientation = state.androidOrientation;
  else delete root.dataset.androidOrientation;
}

export function useRuntimePlatform() {
  const [state, setState] = useState(() => readRuntimePlatformState());

  useEffect(() => {
    if (rawTargetPlatform !== "android") return;

    const update = () => {
      delete (window as Window & { [ANDROID_METRICS_CACHE_KEY]?: AndroidBridgeMetrics })[ANDROID_METRICS_CACHE_KEY];
      applyPlatformAttributes();
      setState(readRuntimePlatformState());
    };

    const viewport = window.visualViewport;
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    viewport?.addEventListener("resize", update);

    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      viewport?.removeEventListener("resize", update);
    };
  }, []);

  return state;
}

export const primaryModifierLabel = isMac ? "⌘" : "Ctrl";
export const redoShortcutLabel = isMac ? "⇧⌘Z" : "Ctrl+Shift+Z";
export const newTabShortcutLabel = isMac ? "⌘N" : "Ctrl+N";
export const closeTabShortcutLabel = isMac ? "⌘W" : "Ctrl+W";
export const submitShortcutLabel = isMac ? "⌘Enter" : "Ctrl+Enter";
export const copyShortcutLabel = isMac ? "⌘C" : "Ctrl+C";
export const pasteShortcutLabel = isMac ? "⌘V" : "Ctrl+V";
export const undoShortcutLabel = isMac ? "⌘Z" : "Ctrl+Z";
export const fullscreenShortcutLabel = isMac ? "⌃⌘F" : "F11";

export function platformOutputRootLabel() {
  const state = readRuntimePlatformState();
  if (state.isAndroidPad) return "应用图片目录 / MediaStore Pictures";
  if (state.isAndroidPhone) return "系统下载 / 分享面板";
  if (state.isMac) return "~/Pictures/Image Studio";
  if (state.isWindows) return "%USERPROFILE%\\Documents\\Image Studio";
  return "~/Pictures/Image Studio";
}

export function platformRuntimeLabel() {
  const state = readRuntimePlatformState();
  if (state.isAndroidPad) return "Android Pad WebView / Material 3 adaptive frontend";
  if (state.isAndroidPhone) return "Android WebView / Material 3 phone frontend";
  if (state.isMac) return "Wails v2 / WKWebView";
  if (state.isWindows) return "Wails v2 / WebView2";
  return "Wails v2 / WebKitGTK";
}
