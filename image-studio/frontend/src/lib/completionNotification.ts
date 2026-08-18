import type {
  CompletionNotificationConfig,
  SystemNotificationPermissionState,
} from "../types/domain";

const COMPLETION_NOTIFICATION_ENABLED_KEY = "gptcodex.completionNotification.enabled";

export function normalizeCompletionNotificationConfig(raw: unknown): CompletionNotificationConfig {
  const source = raw && typeof raw === "object" ? raw as Record<string, any> : {};
  return {
    enabled: source.enabled !== false,
  };
}

export function readCompletionNotificationConfig(): CompletionNotificationConfig {
  try {
    return normalizeCompletionNotificationConfig({
      enabled: localStorage.getItem(COMPLETION_NOTIFICATION_ENABLED_KEY) !== "0",
    });
  } catch {
    return normalizeCompletionNotificationConfig(null);
  }
}

export function persistCompletionNotificationConfig(value: CompletionNotificationConfig): void {
  const next = normalizeCompletionNotificationConfig(value);
  try {
    localStorage.setItem(COMPLETION_NOTIFICATION_ENABLED_KEY, next.enabled ? "1" : "0");
  } catch {
    // localStorage can be unavailable in tests/previews.
  }
}

export function readSystemNotificationPermission(): SystemNotificationPermissionState {
  try {
    if (typeof Notification === "undefined") return "unsupported";
    if (Notification.permission === "granted") return "granted";
    if (Notification.permission === "denied") return "denied";
    return "default";
  } catch {
    return "unsupported";
  }
}

export async function requestSystemNotificationPermission(): Promise<SystemNotificationPermissionState> {
  const current = readSystemNotificationPermission();
  if (current === "unsupported" || current === "granted") return current;
  try {
    if (typeof Notification === "undefined" || typeof Notification.requestPermission !== "function") {
      return current;
    }
    const next = await Notification.requestPermission();
    if (next === "granted" || next === "denied" || next === "default") return next;
  } catch {}
  return readSystemNotificationPermission();
}

export function shouldSendCompletionNotification(input: {
  config: CompletionNotificationConfig;
  completedNow: number;
  totalNow: number;
  windowHidden: boolean;
}): boolean {
  const next = normalizeCompletionNotificationConfig(input.config);
  return next.enabled
    && input.windowHidden
    && input.totalNow > 0
    && input.completedNow === input.totalNow;
}

export function showSystemNotification(title: string, body: string, onClick?: () => void): boolean {
  if (readSystemNotificationPermission() !== "granted") return false;
  try {
    const notification = new Notification(title, { body });
    if (onClick) {
      notification.onclick = () => {
        try { window.focus(); } catch {}
        onClick();
        notification.close();
      };
    }
    return true;
  } catch {
    return false;
  }
}
