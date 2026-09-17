import type { StudioState } from "./studioStore.types";
import { GetStoredAPIKey, EventsOn, setKernelRuntimeMode } from "../platform/runtime/host";
import { hasDesktopSettingsHost, invokeDesktopSettings, subscribeDesktopSettings, invokeDesktopHost } from "../platform/runtime/desktop";
import { buildCompatibilityState } from "../lib/compatState";
import { persistActiveProfileId, persistProfiles } from "./studioStore.shared";
import { persistAIProfileId } from "../lib/profiles";
import { persistProxyConfig } from "../lib/proxy";
import { persistCompletionSoundConfig } from "../lib/completionSound";
import { persistCompletionNotificationConfig } from "../lib/completionNotification";
import { preferenceDefaults, profileWithoutCredential, type SettingsSnapshot } from "../components/desktop-settings/settingsModel";

type StoreAdapter = { getState: () => StudioState; setState: (patch: Partial<StudioState>) => void };
let latestRevision = -1;
let detach: (() => void) | undefined;

export async function applyDesktopSettingsSnapshot(store: StoreAdapter, snapshot: SettingsSnapshot) {
  if (snapshot.revision < latestRevision) return;
  latestRevision = snapshot.revision;
  const prefs = preferenceDefaults(snapshot.preferences);
  const profiles = snapshot.profiles.map(profileWithoutCredential);
  const active = profiles.find((item) => item.id === snapshot.activeProfileId);
  const apiKey = active ? await GetStoredAPIKey(`profile:${active.id}`).catch(() => "") : "";
  if (snapshot.revision < latestRevision) return;
  persistProfiles(profiles); persistActiveProfileId(snapshot.activeProfileId); persistAIProfileId(snapshot.aiProfileId);
  persistProxyConfig(prefs.proxyMode, prefs.proxyURL);
  persistCompletionSoundConfig(prefs.completionSound); persistCompletionNotificationConfig(prefs.completionNotification);
  for (const [key, value] of Object.entries({
    theme: "light", fontScale: prefs.fontScale, outputDir: prefs.outputDir,
    kernelRuntimeMode: prefs.kernelRuntimeMode, keepLogs: prefs.keepLogs ? "1" : "0",
    cleanupPreviewCacheOnExit: prefs.cleanupPreviewCacheOnExit ? "1" : "0",
    savePromptSuppressed: prefs.savePromptSuppressed ? "1" : "0",
    autoRetryEnabled: prefs.autoRetryEnabled ? "1" : "0", autoRetryCount: prefs.autoRetryCount,
    protectStreamPreview: prefs.protectStreamPreview ? "1" : "0",
  })) { try { localStorage.setItem(`gptcodex.${key}`, String(value)); } catch {} }
  document.documentElement.style.setProperty("--font-scale", String(prefs.fontScale));
  setKernelRuntimeMode(prefs.kernelRuntimeMode);
  store.setState({
    profiles, activeProfileId: snapshot.activeProfileId, aiProfileId: snapshot.aiProfileId, apiKey,
    apiMode: active?.apiMode ?? "images", responsesTransport: active?.responsesTransport ?? "sse",
    requestPolicy: active?.requestPolicy ?? "openai", imagesNewAPICompat: active?.imagesNewAPICompat ?? false,
    baseURL: active?.baseURL ?? "", textModelID: active?.textModelID ?? "", imageModelID: active?.imageModelID ?? "",
    reasoningEffort: active?.reasoningEffort ?? "xhigh", theme: "light", fontScale: prefs.fontScale,
    proxyMode: prefs.proxyMode, proxyURL: prefs.proxyURL, kernelRuntimeMode: prefs.kernelRuntimeMode,
    autoRetryEnabled: prefs.autoRetryEnabled, autoRetryCount: prefs.autoRetryCount, protectStreamPreview: prefs.protectStreamPreview,
    savePromptSuppressed: prefs.savePromptSuppressed, keepLogs: prefs.keepLogs, cleanupPreviewCacheOnExit: prefs.cleanupPreviewCacheOnExit,
    completionSound: prefs.completionSound, completionNotification: prefs.completionNotification,
  });
}

export async function initializeDesktopSettingsSync(store: StoreAdapter) {
  if (!hasDesktopSettingsHost()) return;
  detach?.();
  detach = subscribeDesktopSettings(() => {
    void invokeDesktopSettings<SettingsSnapshot>("GetSnapshot").then((snapshot) => applyDesktopSettingsSnapshot(store, snapshot))
      .catch(() => store.getState().pushToast("设置同步失败，请重新打开设置", "error"));
  });
  const snapshot = await invokeDesktopSettings<SettingsSnapshot>("Initialize", buildCompatibilityState(store.getState()));
  await applyDesktopSettingsSnapshot(store, snapshot);
  EventsOn("desktop-workspace-command", async (request: { command: string; requestId: string }) => {
    try {
      const state = store.getState();
      switch (request.command) {
        case "export-history": await state.exportHistory(); break;
        case "import-history": await state.importHistory(); break;
        case "clear-history": await state.clearHistory(); break;
        case "prune-history-3": await state.pruneHistoryOlderThanDays(3); break;
        case "prune-history-7": await state.pruneHistoryOlderThanDays(7); break;
        default: throw new Error("不支持的历史操作");
      }
      await invokeDesktopHost("CompleteWorkspaceCommand", request.requestId, true, "操作已完成");
    } catch { await invokeDesktopHost("CompleteWorkspaceCommand", request.requestId, false, "操作未完成，请在主窗口查看详情"); }
  });
}

export async function updateDesktopProfile(store: StoreAdapter, method: string, ...args: unknown[]) {
  const snapshot = await invokeDesktopSettings<SettingsSnapshot>(method, ...args);
  await applyDesktopSettingsSnapshot(store, snapshot);
  return snapshot;
}
