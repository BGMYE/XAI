import { hasAndroidInvokeBridge, invokeAndroidNative } from "../android/nativeInvoke.ts";

type AnyFn = (...args: any[]) => any;
export type ServiceBinding = Record<string, AnyFn>;
export type RuntimeBinding = {
  EventsOnMultiple?: (eventName: string, callback: (...args: any[]) => void, maxCallbacks?: number) => () => void;
  EventsOff?: (eventName: string, ...additionalEventNames: string[]) => void;
  WindowSetSystemDefaultTheme?: () => void;
  WindowSetLightTheme?: () => void;
  WindowSetDarkTheme?: () => void;
  WindowFullscreen?: () => void;
  WindowUnfullscreen?: () => void;
  WindowIsFullscreen?: () => Promise<boolean>;
};

type BrowserWindow = Window & {
  go?: {
    backend?: {
      Service?: ServiceBinding;
    };
  };
  runtime?: RuntimeBinding;
  AndroidImageStudio?: {
    invoke?: (requestId: string, method: string, payloadJson: string) => void;
  };
  __imageStudioNativeResolve?: (requestId: string, payload: unknown) => void;
  __imageStudioNativeReject?: (requestId: string, message: string) => void;
};

export function getService(): ServiceBinding | null {
  if (typeof window === "undefined") return null;
  return (window as BrowserWindow).go?.backend?.Service ?? null;
}

export function getRuntime(): RuntimeBinding | null {
  if (typeof window === "undefined") return null;
  return (window as BrowserWindow).runtime ?? null;
}

export function hasServiceMethod(name: string): boolean {
  return typeof getService()?.[name] === "function";
}

export function canInvokeAndroidMethod(_name: string): boolean {
  return hasAndroidInvokeBridge();
}

export function invokeService<T>(unsupportedMessage: (method: string) => string, method: string, ...args: unknown[]): Promise<T> {
  const fn = getService()?.[method];
  if (typeof fn !== "function") {
    return Promise.reject(new Error(unsupportedMessage(method)));
  }
  try {
    return Promise.resolve(fn(...args)) as Promise<T>;
  } catch (error) {
    return Promise.reject(error);
  }
}

export function invokeAndroid<T>(unsupportedMessage: (method: string) => string, method: string, ...args: unknown[]): Promise<T> {
  return invokeAndroidNative<T>(method, ...args).catch((error) => {
    if (String((error as any)?.message || "").includes("当前 Android shell 未提供")) {
      return Promise.reject(new Error(unsupportedMessage(method)));
    }
    return Promise.reject(error);
  });
}
