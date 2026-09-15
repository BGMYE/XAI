import { getImageDimensionsFromBase64 } from "../lib/images.ts";
import type { HistoryItem } from "../types/domain";
import type { CanvasNode } from "./canvasNodes";
import type { Stroke } from "./studioStore.types";

export function buildImageMaskPNGDataURL(
  strokes: Stroke[],
  image: HistoryItem | null,
  nodes: CanvasNode[],
): string | null {
  if (!image || strokes.length === 0) return null;
  const node = nodes.find((entry) => entry.id === image.id && entry.type === "image");
  // Native images keep full bytes behind a URL. The loaded canvas node carries
  // their original dimensions; previewWidth/previewHeight may be thumbnail sizes.
  const dims = (image.imageB64 ? getImageDimensionsFromBase64(image.imageB64) : null)
    ?? (node && node.width > 0 && node.height > 0 ? { w: node.width, h: node.height } : null);
  if (!dims) return null;
  const c = document.createElement("canvas");
  c.width = dims.w;
  c.height = dims.h;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  let hasWhite = false;
  for (const s of strokes) {
    ctx.strokeStyle = s.erase ? "#000" : "#fff";
    ctx.lineWidth = s.size;
    ctx.beginPath();
    for (let i = 0; i < s.points.length; i += 2) {
      const x = s.points[i];
      const y = s.points[i + 1];
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    if (!s.erase) hasWhite = true;
  }
  return hasWhite ? c.toDataURL("image/png") : null;
}
