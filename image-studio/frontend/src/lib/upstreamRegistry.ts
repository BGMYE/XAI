// The desktop keeps one upstream registry, owned by the Go backend and shared
// by the Studio and the classic editor. This module adapts the classic
// editor's UpstreamProfile shape to it, and migrates profiles the classic
// editor kept in browser storage. Without the desktop backend (browser
// preview) nothing here is used and the classic editor keeps its own storage.
import type { ReasoningEffortValue, UpstreamProfile } from "../types/domain.ts";
import type { Profile } from "../studio/types.ts";
import { PROFILES_LS_KEY, tryParseProfile } from "./profiles.ts";
import { loadProxyConfig, type ProxyConfig } from "./proxy.ts";

interface RegistryHost {
  ListProfiles(): Promise<Profile[]>;
  SaveProfile(profile: Profile, key: string): Promise<Profile>;
  DeleteProfile(id: string): Promise<void>;
  DuplicateProfile(id: string): Promise<Profile>;
  GetProfileKey(id: string): Promise<string>;
  ClearProfileKey(id: string): Promise<Profile>;
  ImportClassicProfiles(profiles: Profile[]): Promise<number>;
  SetNetworkProxy(mode: string, url: string): Promise<unknown>;
}

const LAST_USED_KEY = "gptcodex.profileLastUsed";

function host(): RegistryHost | null {
  if (typeof window === "undefined") return null;
  const candidate = (window as unknown as { go?: { backend?: { StudioV2?: Partial<RegistryHost> } } }).go
    ?.backend?.StudioV2;
  return candidate &&
    typeof candidate.ListProfiles === "function" &&
    typeof candidate.GetProfileKey === "function"
    ? (candidate as RegistryHost)
    : null;
}

// Registry copies of the profiles the classic editor shows, so a classic edit
// keeps fields it does not expose (such as a Studio-only loopback switch).
const known = new Map<string, Profile>();
let active = false;

/** Whether the classic editor currently reads and writes the shared registry. */
export function registryActive(): boolean {
  return active && host() !== null;
}

export function desktopRegistry(): boolean {
  return host() !== null;
}
export function registryReadOnly(): boolean {
  return desktopRegistry() && !active;
}
export function profileHasKey(id: string, localKey = ""): boolean {
  return desktopRegistry() ? known.get(id)?.hasKey === true : Boolean(localKey.trim());
}
export function requireRegistryWritable(): void {
  if (registryReadOnly()) throw new Error("共享配置不可用：上游设置暂为只读，请修复数据库后重启");
}

function loadLastUsed(): Record<string, number> {
  try {
    const parsed = JSON.parse(localStorage.getItem(LAST_USED_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

/** Usage order is a per-window preference, not part of the shared config. */
export function rememberProfileUse(id: string, at = Date.now()): void {
  const usage = loadLastUsed();
  usage[id] = at;
  try {
    localStorage.setItem(LAST_USED_KEY, JSON.stringify(usage));
  } catch {
    // ignore: ordering falls back to creation order
  }
}

function isLoopbackURL(raw: string): boolean {
  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      (host === "localhost" || host.endsWith(".localhost") || host === "::1" || /^127\./.test(host))
    );
  } catch {
    return false;
  }
}

function truncateUTF8(text: string, limit: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(text).length <= limit) return text;
  let out = "";
  for (const ch of text) {
    if (encoder.encode(out + ch).length > limit) break;
    out += ch;
  }
  return out;
}

const efforts: readonly ReasoningEffortValue[] = ["low", "medium", "high", "xhigh"];

/** Converts a classic profile for the registry; server-owned fields are left empty. */
export function toRegistryProfile(p: UpstreamProfile, existing?: Profile): Profile {
  const baseUrl = p.baseURL.trim().replace(/\/+$/, "");
  return {
    id: p.id,
    name: truncateUTF8(p.name.trim() || "未命名上游", 160),
    baseUrl,
    protocol: existing?.protocol ?? "openai",
    imageModel: p.imageModelID.trim(),
    videoModel: (p.videoModelID ?? "").trim(),
    // The classic editor always allowed local upstreams; the registry needs it said.
    allowLocal: (existing?.allowLocal ?? false) || isLoopbackURL(baseUrl),
    imageApi: p.apiMode === "responses" ? "responses" : "images",
    responsesTransport: p.responsesTransport === "websocket" ? "websocket" : "sse",
    requestPolicy: p.requestPolicy === "compat" ? "compat" : "openai",
    imagesNewApiCompat: p.imagesNewAPICompat === true,
    allowInsecure: p.allowInsecureConnection === true,
    textModel: p.textModelID.trim(),
    reasoningEffort: efforts.includes(p.reasoningEffort) ? p.reasoningEffort : "xhigh",
    modelIds: [...(p.modelIDs ?? [])],
    concurrencyLimit: Math.max(0, Math.min(1000, Math.floor(p.concurrencyLimit || 0))),
    fallbackProfileId: p.fallbackProfileId ?? "",
    createdAt: new Date(Number.isFinite(p.createdAt) ? p.createdAt : Date.now()).toISOString(),
    hasKey: false,
    updatedAt: "",
  };
}

/** Converts a registry profile for the classic editor. */
export function toClassicProfile(p: Profile, lastUsedAt?: number): UpstreamProfile {
  const createdAt = Date.parse(p.createdAt ?? "");
  return {
    id: p.id,
    name: p.name,
    hasKey: p.hasKey,
    apiMode: p.imageApi === "responses" ? "responses" : "images",
    responsesTransport: p.responsesTransport === "websocket" ? "websocket" : "sse",
    requestPolicy: p.requestPolicy === "compat" ? "compat" : "openai",
    imagesNewAPICompat: p.imagesNewApiCompat === true,
    allowInsecureConnection: p.allowInsecure === true,
    baseURL: p.baseUrl,
    textModelID: p.textModel ?? "",
    imageModelID: p.imageModel,
    modelIDs: p.modelIds?.length ? [...p.modelIds] : undefined,
    videoModelID: p.videoModel,
    reasoningEffort: efforts.includes(p.reasoningEffort as ReasoningEffortValue)
      ? (p.reasoningEffort as ReasoningEffortValue)
      : "xhigh",
    concurrencyLimit: p.concurrencyLimit ?? 0,
    fallbackProfileId: p.fallbackProfileId || undefined,
    createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
    lastUsedAt,
  };
}

function storedClassicProfiles(): UpstreamProfile[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(PROFILES_LS_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.map(tryParseProfile).filter((p): p is UpstreamProfile => p !== null)
      : [];
  } catch {
    return [];
  }
}

/**
 * Imports the classic editor's stored profiles into the registry. The backend
 * skips IDs it already has or has deleted, so this is safe on every start.
 */
export async function importClassicProfiles(profiles = storedClassicProfiles()): Promise<number> {
  const registry = host();
  if (!registry || profiles.length === 0) return 0;
  return registry.ImportClassicProfiles(profiles.map((p) => toRegistryProfile(p)));
}

/** Loads the classic editor's view of the registry. The Studio-only xAI protocol is hidden. */
export async function loadRegistryProfiles(): Promise<UpstreamProfile[]> {
  const registry = host();
  if (!registry) throw new Error("上游配置服务不可用");
  const usage = loadLastUsed();
  const list = (await registry.ListProfiles()).filter((p) => p.protocol === "openai");
  known.clear();
  for (const p of list) known.set(p.id, p);
  active = true;
  return list.map((p) => toClassicProfile(p, usage[p.id]));
}

/**
 * Prepares the classic editor's profile list on the desktop: imports what it
 * kept locally, then reads the shared registry. Returns null when there is no
 * registry (browser preview) or it cannot be used, so the caller keeps using
 * browser storage. In the second case onUnavailable says why: changes made
 * then stay in this window and the registry wins once it is back.
 */
export async function syncClassicProfiles(
  local: UpstreamProfile[],
  onUnavailable?: (reason: string) => void,
): Promise<UpstreamProfile[] | null> {
  if (!host()) return null;
  try {
    await importClassicProfiles(local);
    return await loadRegistryProfiles();
  } catch (error) {
    active = false;
    onUnavailable?.(error instanceof Error ? error.message : String(error));
    return null;
  }
}

/** Saves a classic profile; an empty key keeps the saved one. */
export async function saveRegistryProfile(profile: UpstreamProfile, key = ""): Promise<UpstreamProfile> {
  requireRegistryWritable();
  const registry = host();
  if (!registry) throw new Error("上游配置服务不可用");
  const saved = await registry.SaveProfile(toRegistryProfile(profile, known.get(profile.id)), key.trim());
  known.set(saved.id, saved);
  return toClassicProfile(saved, profile.lastUsedAt);
}

export async function clearRegistryKey(id: string): Promise<void> {
  requireRegistryWritable();
  const registry = host();
  if (!registry) throw new Error("上游配置服务不可用");
  known.set(id, await registry.ClearProfileKey(id));
}

export async function deleteRegistryProfile(id: string): Promise<void> {
  requireRegistryWritable();
  const registry = host();
  if (!registry) throw new Error("上游配置服务不可用");
  await registry.DeleteProfile(id);
  known.delete(id);
}

export async function duplicateRegistryProfile(id: string): Promise<UpstreamProfile> {
  requireRegistryWritable();
  const registry = host();
  if (!registry) throw new Error("上游配置服务不可用");
  const copy = await registry.DuplicateProfile(id);
  known.set(copy.id, copy);
  return toClassicProfile(copy);
}

/** Reads a profile's key from the registry, or from the keychain entry the classic editor used. */
export async function readProfileKey(
  id: string,
  legacyRead: (id: string) => Promise<string>,
): Promise<string> {
  const registry = host();
  if (registry) return "";
  return (await legacyRead(id)) ?? "";
}

let pendingProxy: ReturnType<typeof setTimeout> | undefined;

/** Applies the classic proxy setting to Studio jobs. Typing is debounced; invalid drafts are ignored. */
export function shareProxySetting(config: ProxyConfig = loadProxyConfig(), delay = 800): void {
  const registry = host();
  if (!registry) return;
  if (pendingProxy) clearTimeout(pendingProxy);
  pendingProxy = setTimeout(() => {
    pendingProxy = undefined;
    registry.SetNetworkProxy(config.mode, config.mode === "custom" ? config.url : "").catch(() => undefined);
  }, delay);
}

let prepared: Promise<void> | null = null;

/**
 * Runs once per window before the Studio first reads its snapshot: brings the
 * classic editor's profiles and proxy setting into the shared registry.
 */
export function prepareSharedUpstreams(): Promise<void> {
  prepared ??= (async () => {
    if (!host()) return;
    shareProxySetting(loadProxyConfig(), 0);
    await importClassicProfiles().catch(() => 0);
  })();
  return prepared;
}

/** Explicit user action only; callers must clear the returned value on close. */
export async function revealProfileKey(id: string): Promise<string> {
  requireRegistryWritable();
  const registry = host();
  return registry ? registry.GetProfileKey(id) : "";
}
