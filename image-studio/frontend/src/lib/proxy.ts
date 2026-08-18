import type { ProxyMode } from "../types/domain";

const PROXY_MODE_KEY = "gptcodex.proxyMode";
const PROXY_URL_KEY = "gptcodex.proxyURL";

export type ProxyConfig = {
  mode: ProxyMode;
  url: string;
};

export function normalizeProxyMode(value: unknown): ProxyMode {
  return value === "none" || value === "custom" || value === "system" ? value : "system";
}

export function loadProxyConfig(): ProxyConfig {
  let mode: ProxyMode = "system";
  let url = "";
  try {
    mode = normalizeProxyMode(localStorage.getItem(PROXY_MODE_KEY));
    url = localStorage.getItem(PROXY_URL_KEY)?.trim() ?? "";
  } catch {
    // localStorage may be unavailable in tests or embedded previews.
  }
  return { mode, url };
}

export function persistProxyConfig(mode: ProxyMode, url: string) {
  try {
    localStorage.setItem(PROXY_MODE_KEY, mode);
    localStorage.setItem(PROXY_URL_KEY, url.trim());
  } catch {
    // ignore
  }
}
