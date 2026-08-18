import { lazy, Suspense } from "react";
import { usePlatform } from "../../platform/context";
import { useStudioStore } from "../../state/studioStore";

const AndroidUpstreamConfigModal = lazy(() => import("../../platform/android/upstream/AndroidUpstreamConfigModal").then((module) => ({ default: module.AndroidUpstreamConfigModal })));
const UpstreamConfigModal = lazy(() => import("../../components/panel/UpstreamConfigModal").then((module) => ({ default: module.UpstreamConfigModal })));

export function UpstreamConfigGate() {
  const open = useStudioStore((state) => state.upstreamModalOpen);
  const close = useStudioStore((state) => state.closeUpstreamConfig);
  const { isAndroid } = usePlatform();

  if (!open) return null;

  return (
    <Suspense fallback={null}>
      {isAndroid ? (
        <AndroidUpstreamConfigModal open={open} onClose={close} />
      ) : (
        <UpstreamConfigModal open={open} onClose={close} />
      )}
    </Suspense>
  );
}
