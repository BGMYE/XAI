import { lazy, Suspense } from "react";
import { useStudioStore } from "../../state/studioStore";

const SavePromptModal = lazy(() => import("../../components/common/SavePromptModal").then((module) => ({ default: module.SavePromptModal })));

export function SavePromptGate() {
  const request = useStudioStore((s) => s.savePromptRequest);
  if (!request) return null;
  return (
    <Suspense fallback={null}>
      <SavePromptModal />
    </Suspense>
  );
}
