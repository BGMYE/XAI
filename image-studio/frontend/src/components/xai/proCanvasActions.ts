import type { StudioState } from "../../state/studioStore.types";

export type CanvasCommand = "select" | "mask" | "annotate" | "fit" | "zoom-in" | "zoom-out"
  | "rotate-left" | "rotate-right" | "flip-horizontal" | "flip-vertical" | "crop" | "save"
  | "toggle-materials" | "toggle-inspector";

/** Resolve the rectangle at activation time, so a stale selection cannot crop another image. */
export function selectedCropRect(state: Pick<StudioState, "annotations" | "selectedAnnotationId" | "currentImage">) {
  if (!state.currentImage?.savedPath) return null;
  const rect = state.annotations.find((item) => item.id === state.selectedAnnotationId && item.kind === "rect");
  if (!rect || !rect.width || !rect.height) return null;
  return {
    x: Math.min(rect.x, rect.x + rect.width),
    y: Math.min(rect.y, rect.y + rect.height),
    width: Math.abs(rect.width),
    height: Math.abs(rect.height),
  };
}

/** Materializing an image may be asynchronous. Never activate a mask on a different selection. */
export async function activateLocalPaint(getState: () => StudioState): Promise<boolean> {
  const state = getState();
  const image = state.currentImage;
  if (!image || state.isRunning) return false;
  const hasCurrentSource = !!image.savedPath && state.sources.some((source) => source.path === image.savedPath);
  if (state.mode !== "edit" || !hasCurrentSource) await state.reuseAsSource(image);
  const latest = getState();
  if (latest.currentImage?.id !== image.id || latest.isRunning) return false;
  const editable = !!latest.currentImage.savedPath
    && latest.sources.some((source) => source.path === latest.currentImage?.savedPath);
  if (latest.mode !== "edit" || !editable) {
    latest.pushToast("这张图片暂时无法局部绘制，请重新添加素材。", "warn");
    return false;
  }
  latest.selectCanvasNode(image.id);
  latest.setField("tool", "mask");
  return true;
}

export function professionalPanelDefaults(width: number, fontScale: number) {
  const readableWidth = width / Math.max(1, fontScale);
  return { materials: readableWidth >= 760, inspector: readableWidth >= 1120 };
}
