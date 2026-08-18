import type { CustomAspectRatio } from "../types/domain";

export const CUSTOM_ASPECT_RATIOS_LS_KEY = "gptcodex.customAspectRatios";
export const MAX_CUSTOM_ASPECT_RATIOS = 24;

export function reduceAspectRatio(width: number, height: number): { width: number; height: number } {
  const safeWidth = normalizePositiveInteger(width);
  const safeHeight = normalizePositiveInteger(height);
  if (!safeWidth || !safeHeight) {
    return { width: 0, height: 0 };
  }
  const divisor = greatestCommonDivisor(safeWidth, safeHeight);
  return {
    width: safeWidth / divisor,
    height: safeHeight / divisor,
  };
}

export function buildCustomAspectRatioId(width: number, height: number): string {
  const reduced = reduceAspectRatio(width, height);
  return reduced.width > 0 && reduced.height > 0 ? `${reduced.width}:${reduced.height}` : "";
}

export function buildCustomAspectRatioLabel(width: number, height: number): string {
  const safeWidth = normalizePositiveInteger(width);
  const safeHeight = normalizePositiveInteger(height);
  return safeWidth > 0 && safeHeight > 0 ? `${safeWidth}:${safeHeight}` : "";
}

export function makeCustomAspectRatio(width: number, height: number, createdAt = Date.now()): CustomAspectRatio | null {
  const safeWidth = normalizePositiveInteger(width);
  const safeHeight = normalizePositiveInteger(height);
  if (!safeWidth || !safeHeight) return null;
  const id = buildCustomAspectRatioId(safeWidth, safeHeight);
  if (!id) return null;
  return {
    id,
    label: buildCustomAspectRatioLabel(safeWidth, safeHeight),
    width: safeWidth,
    height: safeHeight,
    createdAt: Number.isFinite(createdAt) ? Math.max(0, Math.floor(createdAt)) : Date.now(),
  };
}

export function normalizeCustomAspectRatio(raw: unknown): CustomAspectRatio | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  const width = normalizePositiveInteger(source.width);
  const height = normalizePositiveInteger(source.height);
  if (!width || !height) return null;
  const fallback = makeCustomAspectRatio(width, height, Number(source.createdAt));
  if (!fallback) return null;
  const label = typeof source.label === "string" && source.label.trim()
    ? source.label.trim()
    : fallback.label;
  return {
    ...fallback,
    label,
  };
}

export function normalizeCustomAspectRatios(raw: unknown): CustomAspectRatio[] {
  if (!Array.isArray(raw)) return [];
  const out: CustomAspectRatio[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const ratio = normalizeCustomAspectRatio(item);
    if (!ratio || seen.has(ratio.id)) continue;
    seen.add(ratio.id);
    out.push(ratio);
    if (out.length >= MAX_CUSTOM_ASPECT_RATIOS) break;
  }
  return out;
}

export function loadCustomAspectRatios(): CustomAspectRatio[] {
  try {
    const raw = localStorage.getItem(CUSTOM_ASPECT_RATIOS_LS_KEY);
    if (!raw) return [];
    return normalizeCustomAspectRatios(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function persistCustomAspectRatios(ratios: CustomAspectRatio[]): void {
  try {
    localStorage.setItem(CUSTOM_ASPECT_RATIOS_LS_KEY, JSON.stringify(normalizeCustomAspectRatios(ratios)));
  } catch {}
}

function greatestCommonDivisor(a: number, b: number): number {
  let left = Math.abs(Math.trunc(a));
  let right = Math.abs(Math.trunc(b));
  while (right !== 0) {
    const next = left % right;
    left = right;
    right = next;
  }
  return left || 1;
}

function normalizePositiveInteger(value: unknown): number {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return Math.max(1, Math.floor(num));
}
