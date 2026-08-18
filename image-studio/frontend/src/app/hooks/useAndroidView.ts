import { useEffect, useState } from "react";
import { usePlatform } from "../../platform/context";
import type { AndroidView } from "../../platform/types";

export function useAndroidView() {
  const { isAndroid, isAndroidPhone, isAndroidPad } = usePlatform();
  const [androidView, setAndroidView] = useState<AndroidView>("compose");

  useEffect(() => {
    if (!isAndroid) return;
    setAndroidView((current) => {
      if (isAndroidPad) return current;
      return current === "history" ? "history" : "compose";
    });
  }, [isAndroid, isAndroidPad]);

  return {
    androidView,
    setAndroidView,
  };
}
