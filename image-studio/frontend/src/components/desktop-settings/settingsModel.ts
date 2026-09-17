import type { CompletionNotificationConfig, CompletionSoundConfig, KernelRuntimeMode, ProxyMode, UpstreamProfile } from "../../types/domain";

export const settingsPanes = [
  ["connections", "连接与模型"], ["general", "通用"], ["files", "文件"],
  ["notifications", "通知"], ["display", "显示"], ["data", "数据"], ["about", "关于"],
] as const;
export type SettingsPane = typeof settingsPanes[number][0];
export type DesktopProfile = UpstreamProfile & { hasAPIKey: boolean };
export type DesktopPreferences = {
  proxyMode?: ProxyMode; proxyURL?: string; fontScale?: number; kernelRuntimeMode?: KernelRuntimeMode;
  autoRetryEnabled?: boolean; autoRetryCount?: number; protectStreamPreview?: boolean;
  outputDir?: string; savePromptSuppressed?: boolean; keepLogs?: boolean; cleanupPreviewCacheOnExit?: boolean;
  completionSound?: CompletionSoundConfig; completionNotification?: CompletionNotificationConfig;
  ignoredReleaseTag?: string; lastSettingsPane?: SettingsPane;
};
export type SettingsSnapshot = {
  revision: number; profiles: DesktopProfile[]; activeProfileId: string; aiProfileId: string; preferences: DesktopPreferences;
};
export type CredentialChange = { action: "keep" | "replace" | "clear"; value?: string };
export type SaveProfileRequest = { expectedRevision: number; profile: UpstreamProfile; credential: CredentialChange; setActive?: boolean };

export function profileWithoutCredential(profile: DesktopProfile | UpstreamProfile): UpstreamProfile {
  const { hasAPIKey: _keyStatus, ...publicProfile } = profile as DesktopProfile;
  return publicProfile;
}

export function mergeModelIDs(current: string[], discovered: string[]) {
  return Array.from(new Set([...current, ...discovered].map((id) => id.trim()).filter(Boolean)));
}

export function preferenceDefaults(preferences: DesktopPreferences) {
  return {
    proxyMode: "system" as ProxyMode, proxyURL: "", fontScale: 1, kernelRuntimeMode: "auto" as KernelRuntimeMode,
    autoRetryEnabled: true, autoRetryCount: 2, protectStreamPreview: true,
    outputDir: "", savePromptSuppressed: false, keepLogs: false, cleanupPreviewCacheOnExit: false,
    completionSound: { enabled: true, mode: "default", customName: "", customDataURL: "" } as CompletionSoundConfig,
    completionNotification: { enabled: true }, ...preferences,
  };
}
