import { createContext, useContext } from "react";
import { useRuntimePlatform } from ".";

type PlatformState = ReturnType<typeof useRuntimePlatform>;

const PlatformContext = createContext<PlatformState | null>(null);

export function PlatformProvider({ children }: { children: React.ReactNode }) {
  const value = useRuntimePlatform();
  return <PlatformContext.Provider value={value}>{children}</PlatformContext.Provider>;
}

export function usePlatform() {
  const value = useContext(PlatformContext);
  if (!value) {
    throw new Error("usePlatform must be used inside PlatformProvider");
  }
  return value;
}
