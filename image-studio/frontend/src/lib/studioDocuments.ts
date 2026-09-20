import type { CanvasNode, CanvasViewport } from "../state/canvasNodes";
import type { HistoryItem, Workspace } from "../types/domain";

export type TaskStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "interrupted";
export interface StudioTask {
  id: string; kind: string; queue: string; status: TaskStatus;
  workspaceId?: string; profileId?: string; modelId?: string; provider?: string;
  baseURL?: string; label?: string; remoteId?: string; stage?: string; error?: string;
  createdAt: number; updatedAt: number; revision: number;
  result?: { savedPath?: string; mediaUrl?: string; width?: number; height?: number };
}
export interface DocumentWorkspace {
  id: string; name: string; prompt: string; nodes: CanvasNode[];
  viewport: CanvasViewport; selectedNodeId: string;
}
export interface StudioDocument {
  version: 1; revision: number; activeWorkspaceId: string;
  workspaces: DocumentWorkspace[]; appliedVideoTaskIds: string[];
}
export function newStudioTaskID(): string {
  // Older desktop webviews may expose getRandomValues but not randomUUID.
  const bytes = new Uint8Array(16); globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
export function isActiveTask(task: StudioTask): boolean {
  return task.status === "queued" || task.status === "running";
}
export function safeMediaSource(src?: string): string {
  if (!src || src.length > 8192) return "";
  if (/^\/media\/(full|thumb|preview)\/[a-f0-9]{32}$/.test(src)) return src;
  try {
    const url = new URL(src);
    return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash ? src : "";
  } catch { return ""; }
}
export function documentNode(node: CanvasNode, history: HistoryItem[]): CanvasNode {
  // Explicit allowlist: never serialize a whole workspace or generation payload.
  const item = history.find((entry) => entry.id === node.id);
  const savedPath = node.savedPath || item?.savedPath ||
    (node.id.startsWith("source-preview:") ? node.id.slice("source-preview:".length) : undefined);
  return { id: node.id, type: node.type, mediaId: node.mediaId, savedPath,
    src: safeMediaSource(node.src), label: (node.label || "").slice(0, 1000),
    x: node.x, y: node.y, width: node.width, height: node.height, createdAt: node.createdAt };
}
export function buildStudioDocument(state: {
  activeWorkspaceId: string; workspaces: Workspace[]; history: HistoryItem[];
  canvasNodes: CanvasNode[]; canvasViewport: CanvasViewport | null;
  selectedNodeId: string | null; prompt: string;
}, applied: Iterable<string>): StudioDocument {
  return { version: 1, revision: 0, activeWorkspaceId: state.activeWorkspaceId,
    appliedVideoTaskIds: [...applied], workspaces: state.workspaces.map((workspace) => {
      const active = workspace.id === state.activeWorkspaceId;
      const nodes = (active ? state.canvasNodes : workspace.canvasNodes || []).map((node) => documentNode(node, state.history));
      const selected = active ? state.selectedNodeId : workspace.selectedNodeId;
      return { id: workspace.id, name: workspace.name, prompt: active ? state.prompt : workspace.prompt,
        nodes, viewport: (active ? state.canvasViewport : workspace.canvasViewport) || { x: 0, y: 0, scale: 1 },
        selectedNodeId: nodes.some((node) => node.id === selected) ? selected! : "" };
    }) };
}
export function videoTaskNode(task: StudioTask): CanvasNode | null {
  if (task.kind !== "video" || task.status !== "succeeded" || !task.result?.savedPath) return null;
  const src = safeMediaSource(task.result.mediaUrl);
  if (!src) return null;
  const ratio = (task.result.width || 16) / (task.result.height || 9);
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 100) return null;
  return { id: `video-task-${task.id}`, type: "video", savedPath: task.result.savedPath,
    src, label: task.label || "生成视频", x: 80, y: 80, width: 480,
    height: Math.max(48, Math.min(960, 480 / ratio)), createdAt: task.createdAt };
}
export function mergeTaskRecords(previous: StudioTask[], incoming: StudioTask[]): StudioTask[] {
  const map = new Map(previous.map((task) => [task.id, task]));
  for (const task of incoming) {
    const old = map.get(task.id);
    if (!old || task.revision > old.revision) map.set(task.id, task);
  }
  return [...map.values()].sort((a, b) => b.createdAt - a.createdAt);
}

/** Serializes writes; a slow disk must not save an older layout over a newer one. */
export class DocumentWriter {
  private pending: StudioDocument | null = null;
  private active: Promise<void> | null = null;
  private blocked = false;
  private revision: number;
  private save: (doc: StudioDocument, revision: number) => Promise<StudioDocument>;
  private status: (state: "saving" | "saved" | "error", message?: string) => void;
  constructor(revision: number, save: (doc: StudioDocument, revision: number) => Promise<StudioDocument>,
    status: (state: "saving" | "saved" | "error", message?: string) => void) {
    this.revision = revision; this.save = save; this.status = status;
  }
  enqueue(doc: StudioDocument): Promise<void> {
    this.pending = doc;
    if (this.blocked) return Promise.resolve();
    if (!this.active) this.active = this.drain().finally(() => { this.active = null; });
    return this.active;
  }
  private async drain() {
    while (this.pending && !this.blocked) {
      const doc = this.pending; this.pending = null; this.status("saving");
      try {
        const saved = await this.save({ ...doc, revision: this.revision }, this.revision);
        this.revision = saved.revision;
      } catch (error) {
        this.pending ??= doc; this.blocked = true;
        this.status("error", String(error instanceof Error ? error.message : error)); return;
      }
    }
    if (!this.blocked) this.status("saved");
  }
  retry(): Promise<void> {
    this.blocked = false;
    return this.pending ? this.enqueue(this.pending) : Promise.resolve();
  }
}
