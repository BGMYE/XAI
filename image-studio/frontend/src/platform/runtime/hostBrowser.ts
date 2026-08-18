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
    return localStorage.getItem(browserKeyPrefix + user) ?? "";
  } catch {
    return "";
  }
}

export function setBrowserStoredAPIKey(user: string, value: string) {
  try {
    if (value.trim()) localStorage.setItem(browserKeyPrefix + user, value.trim());
    else localStorage.removeItem(browserKeyPrefix + user);
  } catch {
    // ignore
  }
}

export function fileNameFromPath(path: string | undefined): string {
  if (!path) return "image.png";
  return path.split(/[\\/]/).pop() || "image.png";
}
