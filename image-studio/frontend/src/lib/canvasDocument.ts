import type { CanvasNode, CanvasViewport } from "../state/canvasNodes";
import type { HistoryItem, Workspace } from "../types/domain";

export interface CanvasDocumentWorkspace {
  id: string; name: string; prompt: string; nodes: CanvasNode[];
  viewport: CanvasViewport; selectedNodeId: string;
}
export interface CanvasDocument {
  version: 1; revision: number; activeWorkspaceId: string;
  workspaces: CanvasDocumentWorkspace[]; appliedVideoTaskIds: string[];
}
export function safeCanvasSource(src?: string): string | undefined {
  if (!src || src.length > 8192) return undefined;
  if (src.startsWith("/media/") && !/[?#\\]/.test(src) && !src.includes("..")) return src;
  try { const url = new URL(src); return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash ? src : undefined; }
  catch { return undefined; }
}
export function canvasSnapshot(state: {
  workspaces: Workspace[]; activeWorkspaceId: string; canvasNodes: CanvasNode[];
  canvasViewport: CanvasViewport | null; selectedNodeId: string | null; prompt: string; history: HistoryItem[];
}, revision: number, applied: Iterable<string>): CanvasDocument {
  return { version: 1, revision, activeWorkspaceId: state.activeWorkspaceId, appliedVideoTaskIds: [...applied],
    workspaces: state.workspaces.map((w) => {
      const active = w.id === state.activeWorkspaceId;
      const nodes = (active ? state.canvasNodes : w.canvasNodes ?? []).map((n) => {
        const item = state.history.find((h) => h.id === n.id);
        return { id: n.id, type: n.type, mediaId: n.mediaId, src: safeCanvasSource(n.src), label: (n.label ?? "").slice(0, 1000),
          savedPath: n.savedPath || item?.savedPath || (n.id.startsWith("source-preview:") ? n.id.slice(15) : undefined),
          x: n.x, y: n.y, width: n.width, height: n.height, createdAt: n.createdAt };
      });
      const selected = (active ? state.selectedNodeId : w.selectedNodeId) ?? "";
      return { id: w.id, name: w.name, prompt: active ? state.prompt : w.prompt, nodes,
        viewport: (active ? state.canvasViewport : w.canvasViewport) ?? { x: 0, y: 0, scale: 1 },
        selectedNodeId: nodes.some((n) => n.id === selected) ? selected : "" };
    }),
  };
}
export function validateCanvasDocument(value: unknown): asserts value is CanvasDocument {
  const d = value as CanvasDocument;
  if (!d || d.version !== 1 || !Number.isSafeInteger(d.revision) || d.revision < 0 || !Array.isArray(d.workspaces) || d.workspaces.length > 100 || !Array.isArray(d.appliedVideoTaskIds) || d.appliedVideoTaskIds.length > 10000) throw new Error("画布文档版本或结构无效；未覆盖原文件");
  const ids = new Set<string>(); let count = 0;
  for (const w of d.workspaces) {
    if (!w || !/^[\w-]{1,128}$/.test(w.id) || ids.has(w.id) || typeof w.name !== "string" || typeof w.prompt !== "string" || !Array.isArray(w.nodes)) throw new Error("画布工作区无效");
    ids.add(w.id);
    const v = w.viewport;
    if (!v || ![v.x, v.y, v.scale].every(Number.isFinite) || v.scale < .05 || v.scale > 8) throw new Error("画布视口无效");
    const nodeIds = new Set<string>();
    for (const n of w.nodes) {
      if (++count > 10000 || !n || typeof n.id !== "string" || !n.id || nodeIds.has(n.id) || !["image", "video"].includes(n.type) || ![n.x, n.y, n.width, n.height].every(Number.isFinite) || n.width <= 0 || n.height <= 0 || (n.src && !safeCanvasSource(n.src))) throw new Error("画布节点无效");
      nodeIds.add(n.id);
    }
    if (w.selectedNodeId && !nodeIds.has(w.selectedNodeId)) throw new Error("选中的节点不存在");
  }
  if (d.workspaces.length && !ids.has(d.activeWorkspaceId)) throw new Error("活动工作区不存在");
  if (!d.appliedVideoTaskIds.every((id) => typeof id === "string" && /^[\w-]{1,128}$/.test(id))) throw new Error("视频交付记录无效");
}
export function visibleCanvasNodes(nodes: CanvasNode[], view: CanvasViewport, width: number, height: number, selected?: string | null): CanvasNode[] {
  const margin = 240 / view.scale;
  const left = -view.x / view.scale - margin, top = -view.y / view.scale - margin;
  const right = (width - view.x) / view.scale + margin, bottom = (height - view.y) / view.scale + margin;
  return nodes.filter((n) => n.id === selected || (n.x + n.width >= left && n.y + n.height >= top && n.x <= right && n.y <= bottom));
}
