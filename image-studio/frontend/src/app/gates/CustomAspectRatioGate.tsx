import { lazy, Suspense } from "react";
import { useStudioStore } from "../../state/studioStore";

const CustomAspectRatioModal = lazy(() => import("../../components/panel/CustomAspectRatioModal").then((module) => ({ default: module.CustomAspectRatioModal })));

export function CustomAspectRatioGate() {
  const open = useStudioStore((state) => state.customAspectRatioModalOpen);
  if (!open) return null;

  return (
    <Suspense fallback={null}>
      <CustomAspectRatioModal />
    </Suspense>
  );
}
