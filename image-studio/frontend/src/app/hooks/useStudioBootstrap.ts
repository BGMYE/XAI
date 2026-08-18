import { useEffect } from "react";
import { useStudioStore } from "../../state/studioStore";

export function useStudioBootstrap() {
  const bootstrap = useStudioStore((state) => state.bootstrap);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);
}
