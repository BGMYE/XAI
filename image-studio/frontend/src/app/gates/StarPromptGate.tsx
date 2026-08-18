import { lazy, Suspense } from "react";
import { usePlatform } from "../../platform/context";
import { useStudioStore } from "../../state/studioStore";

const StarPromptModal = lazy(() => import("../../components/common/StarPromptModal").then((module) => ({ default: module.StarPromptModal })));

export function StarPromptGate() {
  const { isMac } = usePlatform();
  const open = useStudioStore((state) => state.starPromptOpen);

  if (isMac || !open) return null;

  return (
    <Suspense fallback={null}>
      <StarPromptModal open={open} />
    </Suspense>
  );
}
