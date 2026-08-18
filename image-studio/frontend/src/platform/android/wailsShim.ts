import type { AndroidBridge } from "./bridge";
import { targetPlatform } from "..";
import { base64ToBlob, blobToBase64 } from "../../lib/images";

type AnyFn = (...args: any[]) => any;

declare global {
  interface Window {
    runtime?: Record<string, AnyFn>;
    go?: {
      backend?: {
        Service?: Record<string, AnyFn>;
      };
    };
    AndroidImageStudio?: AndroidBridge;
    __imageStudioNativeResolve?: (requestId: string, payload: unknown) => void;
    __imageStudioNativeReject?: (requestId: string, message: string) => void;
  }
}

const SHIM_KEY_PREFIX = "android-shell";
const OUTPUT_DIR_KEY = `${SHIM_KEY_PREFIX}.outputDir`;
const DEFAULT_OUTPUT_DIR = "/sdcard/Android/data/top.gptcodex.imagestudio/files/Pictures/ImageStudio";

function isAndroidShellTarget() {
  return targetPlatform === "android" || targetPlatform === "android-pad";
}

function ensureWindowRuntime() {
  if (typeof window === "undefined" || window.runtime) return;

  const listeners = new Map<string, Set<(...args: any[]) => void>>();

  const emit = (eventName: string, ...args: any[]) => {
    const bucket = listeners.get(eventName);
    if (!bucket) return;
    for (const callback of Array.from(bucket)) {
      try {
        callback(...args);
      } catch {
        // Ignore callback failures in the shim layer.
      }
    }
  };

  const on = (eventName: string, callback: (...args: any[]) => void, maxCallbacks = -1) => {
    const bucket = listeners.get(eventName) ?? new Set<(...args: any[]) => void>();
    listeners.set(eventName, bucket);

    let wrapped = callback;
    if (maxCallbacks > 0) {
      let seen = 0;
      wrapped = (...args: any[]) => {
        seen += 1;
        callback(...args);
        if (seen >= maxCallbacks) bucket.delete(wrapped);
      };
    }

    bucket.add(wrapped);
    return () => bucket.delete(wrapped);
  };

  const nativeCalls = new Map<string, { resolve: (payload: any) => void; reject: (message: any) => void }>();

  window.__imageStudioNativeResolve = (requestId, payload) => {
    const entry = nativeCalls.get(requestId);
    if (!entry) return;
    nativeCalls.delete(requestId);
    entry.resolve(payload);
  };

  window.__imageStudioNativeReject = (requestId, message) => {
    const entry = nativeCalls.get(requestId);
    if (!entry) return;
    nativeCalls.delete(requestId);
    entry.reject(new Error(typeof message === "string" ? message : String(message)));
  };

  const invokeNative = (method: string, args: unknown[], fallback?: () => Promise<any> | any): Promise<any> => {
    if (window.AndroidImageStudio?.invoke) {
      return new Promise((resolve, reject) => {
        const requestId = `${method}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        nativeCalls.set(requestId, { resolve, reject });
        try {
          window.AndroidImageStudio!.invoke!(requestId, method, JSON.stringify(args));
        } catch (error) {
          nativeCalls.delete(requestId);
          reject(error);
        }
      });
    }

    if (fallback) return Promise.resolve(fallback());
    return Promise.reject(new Error(`${method} is unavailable in this environment`));
  };

  window.runtime = {
    ...(window.runtime ?? {}),
    EventsOnMultiple: on,
    EventsOff: (...eventNames: string[]) => {
      for (const eventName of eventNames) listeners.delete(eventName);
    },
    EventsOffAll: () => listeners.clear(),
    EventsEmit: emit,
    WindowSetSystemDefaultTheme: () => undefined,
    WindowSetLightTheme: () => undefined,
    WindowSetDarkTheme: () => undefined,
    BrowserOpenURL: (url: string) => {
      const opened = window.open(url, "_blank", "noopener,noreferrer");
      if (!opened) window.location.href = url;
    },
    ClipboardGetText: async () => navigator.clipboard.readText(),
    ClipboardSetText: async (text: string) => navigator.clipboard.writeText(text),
  };
}

if (typeof window !== "undefined" && isAndroidShellTarget()) {
  ensureWindowRuntime();
}

export async function readBlobAsBase64ForShell(blob: Blob): Promise<string> {
  return blobToBase64(blob);
}

export async function readBase64AsBlobForShell(imageB64: string): Promise<Blob> {
  return base64ToBlob(imageB64);
}

export function getAndroidShellOutputDir(): string {
  try {
    return localStorage.getItem(OUTPUT_DIR_KEY) || DEFAULT_OUTPUT_DIR;
  } catch {
    return DEFAULT_OUTPUT_DIR;
  }
}

export function setAndroidShellOutputDir(outputDir: string) {
  try {
    localStorage.setItem(OUTPUT_DIR_KEY, outputDir);
  } catch {
    // Ignore storage failures in the preview shim.
  }
}
