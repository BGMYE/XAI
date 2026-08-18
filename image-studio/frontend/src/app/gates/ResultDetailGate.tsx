import { lazy, Suspense } from "react";
import { useStudioStore } from "../../state/studioStore";

const ResultDetailDrawer = lazy(() => import("../../components/panel/ResultDetailDrawer").then((module) => ({ default: module.ResultDetailDrawer })));

export function ResultDetailGate() {
  const item = useStudioStore((state) => state.resultDetail);
  if (!item) return null;

  return (
    <Suspense fallback={null}>
      <ResultDetailDrawer />
    </Suspense>
  );
}
