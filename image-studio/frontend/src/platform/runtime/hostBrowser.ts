const browserKeyPrefix = "image-studio.browser-key.";

export function saveByDownload(blob: Blob, suggestedName: string): string {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = suggestedName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  globalThis.setTimeout(() => URL.revokeObjectURL(url), 15_000);
  return suggestedName;
}

export function browserStoredAPIKey(user: string): string {
  try {
    localStorage.removeItem(browserKeyPrefix + user);
  } catch { /* ignore unavailable browser storage */ }
  return "";
}

export function setBrowserStoredAPIKey(user: string, value: string) {
  try {
    localStorage.removeItem(browserKeyPrefix + user);
  } catch { /* ignore unavailable browser storage */ }
  if (value.trim()) {
    throw new Error("浏览器不能写入系统凭据存储。请在桌面应用中保存 API Key。");
  }
}

export function fileNameFromPath(path: string | undefined): string {
  if (!path) return "image.png";
  return path.split(/[\\/]/).pop() || "image.png";
}
