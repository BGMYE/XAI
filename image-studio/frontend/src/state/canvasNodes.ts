import type { HistoryItem } from "../types/domain";

export type CanvasNodeType = "image" | "video";

export interface CanvasNode {
  id: string;
  type: CanvasNodeType;
  mediaId?: string;
  src?: string;
  label?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  createdAt: number;
}

export interface CanvasState {
  nodes: CanvasNode[];
  selectedNodeId: string | null;
}

export interface CanvasViewport {
  x: number;
  y: number;
  scale: number;
}

export const DEFAULT_CANVAS_VIEWPORT: CanvasViewport = { x: 0, y: 0, scale: 1 };

export function sourceHistoryItemForCanvasNode(node: CanvasNode | undefined): HistoryItem | undefined {
  if (!node || node.type !== "image" || !node.id.startsWith("source-preview:")) return undefined;
  const savedPath = node.id.slice("source-preview:".length);
  if (!savedPath) return undefined;
  return {
    id: node.id,
    imageId: node.mediaId,
    savedPath,
    previewUrl: node.src,
    fullUrl: node.src,
    previewWidth: node.width,
    previewHeight: node.height,
    prompt: node.label || `(参考图)${savedPath.split(/[\\/]/).pop()}`,
    mode: "edit",
    size: "auto",
    quality: "medium",
    createdAt: node.createdAt,
    previewOnly: true,
  };
}

export function clampCanvasScale(scale: number): number {
  return Math.max(0.05, Math.min(8, Number.isFinite(scale) ? scale : 1));
}

export type CanvasAction =
  | { type: "add"; node: CanvasNode }
  | { type: "update"; id: string; patch: Partial<Omit<CanvasNode, "id">> }
  | { type: "move"; id: string; x: number; y: number }
  | { type: "select"; id: string | null }
  | { type: "remove"; id: string };

export function createCanvasNode(input: Partial<CanvasNode> & Pick<CanvasNode, "id" | "type">): CanvasNode {
  return {
    id: input.id,
    type: input.type,
    mediaId: input.mediaId,
    src: input.src,
    label: input.label,
    x: input.x ?? 0,
    y: input.y ?? 0,
    width: input.width ?? (input.type === "video" ? 320 : 280),
    height: input.height ?? (input.type === "video" ? 220 : 280),
    createdAt: input.createdAt ?? Date.now(),
  };
}

export function mergeCanvasNodePreservingPosition(existing: CanvasNode | undefined, incoming: CanvasNode): CanvasNode {
  if (!existing) return incoming;
  return {
    ...existing,
    ...incoming,
    x: existing.x,
    y: existing.y,
    createdAt: existing.createdAt,
  };
}

export function upsertCanvasNodeList(nodes: CanvasNode[], incoming: CanvasNode): CanvasNode[] {
  const existing = nodes.find((node) => node.id === incoming.id);
  const merged = mergeCanvasNodePreservingPosition(existing, incoming);
  return [...nodes.filter((node) => node.id !== incoming.id), merged];
}

export function canvasStateReducer(state: CanvasState, action: CanvasAction): CanvasState {
  switch (action.type) {
    case "add":
      return { nodes: [...state.nodes.filter((n) => n.id !== action.node.id), action.node], selectedNodeId: action.node.id };
    case "update":
      return { ...state, nodes: state.nodes.map((n) => n.id === action.id ? { ...n, ...action.patch } : n) };
    case "move":
      return { ...state, nodes: state.nodes.map((n) => n.id === action.id ? { ...n, x: action.x, y: action.y } : n) };
    case "select":
      return { ...state, selectedNodeId: action.id };
    case "remove":
      return { nodes: state.nodes.filter((n) => n.id !== action.id), selectedNodeId: state.selectedNodeId === action.id ? null : state.selectedNodeId };
  }
}

export function fitCanvasView(nodes: CanvasNode[], width: number, height: number) {
  if (!nodes.length || width <= 0 || height <= 0) return { x: 0, y: 0, scale: 1 };
  const minX = Math.min(...nodes.map((n) => n.x));
  const minY = Math.min(...nodes.map((n) => n.y));
  const maxX = Math.max(...nodes.map((n) => n.x + n.width));
  const maxY = Math.max(...nodes.map((n) => n.y + n.height));
  const contentW = Math.max(1, maxX - minX);
  const contentH = Math.max(1, maxY - minY);
  const scale = clampCanvasScale(Math.min(1, (width - 80) / contentW, (height - 80) / contentH));
  return { scale, x: (width - contentW * scale) / 2 - minX * scale, y: (height - contentH * scale) / 2 - minY * scale };
}

export function oneToOneCanvasView(node: CanvasNode, width: number, height: number): CanvasViewport {
  return {
    scale: 1,
    x: (width - node.width) / 2 - node.x,
    y: (height - node.height) / 2 - node.y,
  };
}
