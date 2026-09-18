import { useEffect } from "react";
import { useStudioStore } from "../../state/studioStore";
import { startStudioV2 } from "../../state/studioV2";
let bootstrapPromise: Promise<void> | null = null;
export function useStudioBootstrap() {
  useEffect(() => {
    // React StrictMode remounts effects; only one hydration may write the store.
    bootstrapPromise ??= useStudioStore.getState().bootstrap().then(() => {
      // The home-page guide replaces the first-launch settings overlay.
      if (!useStudioStore.getState().baseURL) useStudioStore.getState().closeSettings();
      return startStudioV2();
    });
    void bootstrapPromise.catch((error) => useStudioStore.getState().pushToast(`启动失败：${String(error)}`, "error"));
  }, []);
}
