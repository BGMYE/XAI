export const ANDROID_STREAM_PREVIEW_CONCURRENCY_LIMIT = 2;
export const DESKTOP_STREAM_PREVIEW_CONCURRENCY_LIMIT = 8;
export const ANDROID_STREAM_PREVIEW_LARGE_EDGE = 2048;

export type StreamPreviewDisableReason =
  | "android_concurrency"
  | "android_large_size"
  | "desktop_concurrency";

function parseSize(value: string): { width: number; height: number } | null {
  const match = /^(\d+)x(\d+)$/.exec((value ?? "").trim());
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return { width, height };
}

export function getStreamPreviewDisableReason({
  enabled = true,
  isAndroid,
  requestedConcurrency,
  resolvedSize,
}: {
  enabled?: boolean;
  isAndroid: boolean;
  requestedConcurrency: number;
  resolvedSize: string;
}): StreamPreviewDisableReason | null {
  if (!enabled) return null;
  if (isAndroid) {
    const parsed = parseSize(resolvedSize);
    if (parsed && Math.max(parsed.width, parsed.height) >= ANDROID_STREAM_PREVIEW_LARGE_EDGE) {
      return "android_large_size";
    }
    if (requestedConcurrency >= ANDROID_STREAM_PREVIEW_CONCURRENCY_LIMIT) {
      return "android_concurrency";
    }
    return null;
  }
  if (requestedConcurrency >= DESKTOP_STREAM_PREVIEW_CONCURRENCY_LIMIT) {
    return "desktop_concurrency";
  }
  return null;
}

export function shouldForceDisableStreamingPreview(input: {
  enabled?: boolean;
  isAndroid: boolean;
  requestedConcurrency: number;
  resolvedSize: string;
}): boolean {
  return getStreamPreviewDisableReason(input) !== null;
}
