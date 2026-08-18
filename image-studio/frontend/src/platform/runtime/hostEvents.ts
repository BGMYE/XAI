import type { KernelRuntimeMode } from "./hostTypes.ts";

const localEventListeners = new Map<string, Set<(...args: any[]) => void>>();
let forcedKernelRuntimeMode: KernelRuntimeMode = "auto";

export function emitLocalEvent(eventName: string, payload: unknown) {
  const bucket = localEventListeners.get(eventName);
  if (!bucket) return;
  for (const listener of Array.from(bucket)) {
    try {
      listener(payload);
    } catch {
      // ignore listener errors
    }
  }
}

export function onLocalEvent(eventName: string, callback: (...args: any[]) => void) {
  const bucket = localEventListeners.get(eventName) ?? new Set<(...args: any[]) => void>();
  bucket.add(callback);
  localEventListeners.set(eventName, bucket);
  return () => {
    const existing = localEventListeners.get(eventName);
    if (!existing) return;
    existing.delete(callback);
    if (existing.size === 0) localEventListeners.delete(eventName);
  };
}

export function clearLocalEvents(...eventNames: string[]) {
  for (const eventName of eventNames) {
    localEventListeners.delete(eventName);
  }
}

export function setForcedKernelRuntimeMode(mode: KernelRuntimeMode) {
  forcedKernelRuntimeMode = mode;
}

export function getForcedKernelRuntimeMode(): KernelRuntimeMode {
  return forcedKernelRuntimeMode;
}
