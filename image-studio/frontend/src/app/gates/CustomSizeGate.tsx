import { lazy, Suspense } from "react";
import { useStudioStore } from "../../state/studioStore";

const CustomSizeModal = lazy(() => import("../../components/panel/CustomSizeModal").then((module) => ({ default: module.CustomSizeModal })));

export function CustomSizeGate() {
  const open = useStudioStore((state) => state.customSizeModalOpen);
  if (!open) return null;

  return (
    <Suspense fallback={null}>
      <CustomSizeModal />
    </Suspense>
  );
}
