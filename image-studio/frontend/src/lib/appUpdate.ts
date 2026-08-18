import type { AppUpdateInfo } from "../types/domain";

export function semverCore(value: string): string {
  const trimmed = value.trim().replace(/^v/i, "");
  const match = /^(\d+\.\d+\.\d+)/.exec(trimmed);
  return match?.[1] ?? "";
}

export function hasRealAppUpdate(currentVersion: string, latestVersion: string, hasUpdateFlag: boolean): boolean {
  if (!hasUpdateFlag) return false;
  const currentCore = semverCore(currentVersion);
  const latestCore = semverCore(latestVersion);
  if (currentCore && latestCore && currentCore === latestCore) {
    return false;
  }
  return true;
}

export function normalizeAppUpdateInfo(raw: unknown): AppUpdateInfo | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  const currentVersion = typeof source.currentVersion === "string" ? source.currentVersion.trim() : "";
  const latestVersion = typeof source.latestVersion === "string" ? source.latestVersion.trim() : "";
  const releaseTag = typeof source.releaseTag === "string" ? source.releaseTag.trim() : "";
  const releaseURL = typeof source.releaseURL === "string" ? source.releaseURL.trim() : "";
  const hasUpdateFlag = source.hasUpdate === true;
  if (!currentVersion || !latestVersion || !releaseTag || !releaseURL) return null;
  return {
    currentVersion,
    latestVersion,
    releaseTag,
    releaseURL,
    hasUpdate: hasRealAppUpdate(currentVersion, latestVersion, hasUpdateFlag),
    releaseName: typeof source.releaseName === "string" ? source.releaseName.trim() : "",
    publishedAt: typeof source.publishedAt === "string" ? source.publishedAt.trim() : "",
    body: typeof source.body === "string" ? source.body.trim() : "",
  };
}
