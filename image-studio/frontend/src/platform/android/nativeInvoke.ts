type BrowserWindow = Window & {
  AndroidImageStudio?: {
    invoke?: (requestId: string, method: string, payloadJson: string) => void;
  };
  __imageStudioNativeResolve?: (requestId: string, payload: unknown) => void;
  __imageStudioNativeReject?: (requestId: string, message: string) => void;
};

const androidNativeCalls = new Map<string, { resolve: (payload: unknown) => void; reject: (message: unknown) => void }>();
let hooksInstalled = false;
let installedWindow: BrowserWindow | null = null;

function getAndroidBridge() {
  if (typeof window === "undefined") return null;
  return (window as BrowserWindow).AndroidImageStudio ?? null;
}

function ensureAndroidInvokeHooks() {
  if (typeof window === "undefined") return;
  const browserWindow = window as BrowserWindow;
  if (hooksInstalled && installedWindow === browserWindow) return;
  const prevResolve = browserWindow.__imageStudioNativeResolve;
  const prevReject = browserWindow.__imageStudioNativeReject;

  browserWindow.__imageStudioNativeResolve = (requestId, payload) => {
    const entry = androidNativeCalls.get(requestId);
    if (entry) {
      androidNativeCalls.delete(requestId);
      entry.resolve(payload);
      return;
    }
    prevResolve?.(requestId, payload);
  };

  browserWindow.__imageStudioNativeReject = (requestId, message) => {
    const entry = androidNativeCalls.get(requestId);
    if (entry) {
      androidNativeCalls.delete(requestId);
      entry.reject(new Error(typeof message === "string" ? message : String(message)));
      return;
    }
    prevReject?.(requestId, message);
  };

  hooksInstalled = true;
  installedWindow = browserWindow;
}

export function hasAndroidInvokeBridge(): boolean {
  return typeof getAndroidBridge()?.invoke === "function";
}

export function invokeAndroidNative<T>(method: string, ...args: unknown[]): Promise<T> {
  const bridge = getAndroidBridge();
  if (!bridge?.invoke) {
    return Promise.reject(new Error(`当前 Android shell 未提供 ${method} 对应的本地内核能力`));
  }

  ensureAndroidInvokeHooks();

  return new Promise<T>((resolve, reject) => {
    const requestId = `${method}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    androidNativeCalls.set(requestId, {
      resolve: (payload) => resolve(payload as T),
      reject,
    });

    try {
      bridge.invoke?.(requestId, method, JSON.stringify(args));
    } catch (error) {
      androidNativeCalls.delete(requestId);
      reject(error);
    }
  });
}
