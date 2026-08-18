import { lazy, Suspense } from "react";

const AppUpdateModal = lazy(() => import("../../components/common/AppUpdateModal").then((module) => ({ default: module.AppUpdateModal })));

export function AppUpdateGate() {
  return (
    <Suspense fallback={null}>
      <AppUpdateModal />
    </Suspense>
  );
}
