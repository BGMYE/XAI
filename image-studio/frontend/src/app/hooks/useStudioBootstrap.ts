import { useEffect } from "react";
import { useStudioStore } from "../../state/studioStore";
import { initializeStudioV2 } from "../../state/studioV2Runtime";
export function useStudioBootstrap() {
  const bootstrap = useStudioStore((state) => state.bootstrap);
  useEffect(() => { void initializeStudioV2(bootstrap); }, [bootstrap]);
}
