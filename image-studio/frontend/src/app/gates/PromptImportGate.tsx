import { lazy, Suspense } from "react";
import type { PromptImportDialogState } from "../hooks/useDesktopPromptImport";

const PromptImportModal = lazy(() => import("../../components/common/PromptImportModal").then((module) => ({ default: module.PromptImportModal })));

export function PromptImportGate({ dialog }: { dialog: PromptImportDialogState }) {
  if (!dialog.open) return null;
  return (
    <Suspense fallback={null}>
      <PromptImportModal
        open={dialog.open}
        payload={dialog.payload}
        resolvedSize={dialog.resolvedSize}
        onClose={dialog.close}
        onConfirm={dialog.confirm}
      />
    </Suspense>
  );
}
