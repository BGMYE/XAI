import { lazy, Suspense } from "react";

const SettingsPanel = lazy(() => import("../../components/panel/SettingsPanel").then((module) => ({ default: module.SettingsPanel })));

export function SettingsPanelGate({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Suspense fallback={null}>
      <SettingsPanel open={open} onClose={onClose} />
    </Suspense>
  );
}
