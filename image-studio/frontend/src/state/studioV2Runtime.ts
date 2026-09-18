import { create } from "zustand";
import { get, update } from "idb-keyval";
import { getService, hasServiceMethod, invokeService } from "../platform/runtime/hostBindings";
import { canvasSnapshot, validateCanvasDocument, type CanvasDocument } from "../lib/canvasDocument";
import { createCanvasNode } from "./canvasNodes";
import { useStudioStore } from "./studioStore";

export interface StudioTask {
  id: string; kind: "image" | "video"; workspaceId?: string; profileId?: string; modelId?: string;
  provider?: string; baseURL?: string; label?: string; remoteId?: string; revision: number;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "interrupted";
  stage?: string; error?: string; createdAt: number; updatedAt: number;
  result?: { savedPath?: string; mediaUrl?: string; width?: number; height?: number };
}
export const useStudioV2 = create<{ ready: boolean; saving: boolean; storageError: string; taskError: string; tasks: StudioTask[] }>(() => ({ ready: false, saving: false, storageError: "", taskError: "", tasks: [] }));
export const studioService = <T,>(method: string, ...args: unknown[]) => invokeService<T>(() => "请在更新后的桌面应用中使用此功能", method, ...args);
const DOCUMENT_KEY = "xai.canvas-document.v1";
let initialized: Promise<void> | undefined;
let revision = 0, lastSaved = "", dirty = false, saving = false, storageStopped = false;
const applied = new Set<string>();
let timer: ReturnType<typeof setTimeout> | undefined;

async function loadDocument(): Promise<CanvasDocument | undefined> {
  return hasServiceMethod("LoadCanvasDocument") ? studioService<CanvasDocument>("LoadCanvasDocument") : get<CanvasDocument>(DOCUMENT_KEY);
}
async function saveDocument(doc: CanvasDocument): Promise<CanvasDocument> {
  if (hasServiceMethod("SaveCanvasDocument")) return studioService<CanvasDocument>("SaveCanvasDocument", doc, revision);
  let saved = doc;
  await update<CanvasDocument>(DOCUMENT_KEY, (previous) => {
    if ((previous?.revision ?? 0) !== revision) throw new Error("CANVAS_CONFLICT: 画布被其他窗口修改，请重新打开应用；未覆盖原文档");
    saved = { ...doc, revision: revision + 1 }; return saved;
  });
  return saved;
}
function signature(doc: CanvasDocument) { return JSON.stringify({ ...doc, revision: 0 }); }
export async function flushCanvasDocument() {
  if (saving || storageStopped || !useStudioV2.getState().ready) return;
  saving = true;
  try {
    while (dirty) {
      dirty = false;
      const doc = canvasSnapshot(useStudioStore.getState(), revision, applied);
      const next = signature(doc); if (next === lastSaved || !doc.workspaces.length) continue;
      validateCanvasDocument(doc);
      useStudioV2.setState({ saving: true });
      const saved = await saveDocument(doc);
      revision = saved.revision; lastSaved = next;
      useStudioV2.setState({ storageError: "" });
    }
  } catch (error) {
    dirty = true; storageStopped = true;
    useStudioV2.setState({ storageError: `画布未保存：${String(error)}。原文档已保留，请检查磁盘或重新打开应用。` });
  } finally { saving = false; useStudioV2.setState({ saving: false }); }
}
function scheduleSave() {
  dirty = true; clearTimeout(timer);
  timer = setTimeout(() => void flushCanvasDocument(), 300);
}
async function restoreDocument(doc: CanvasDocument) {
  validateCanvasDocument(doc); revision = doc.revision;
  doc.appliedVideoTaskIds.forEach((id) => applied.add(id));
  const state = useStudioStore.getState(); const template = state.workspaces[0];
  if (!doc.workspaces.length || !template) return;
  const workspaces = doc.workspaces.map((w) => ({ ...template, id: w.id, name: w.name, prompt: w.prompt,
    canvasNodes: w.nodes, canvasViewport: w.viewport, selectedNodeId: w.selectedNodeId || null,
    currentImageId: state.history.find((h) => h.id === w.selectedNodeId)?.id ?? null,
    sources: [], runningJobIds: [], lastPayload: null, streamPreview: null, streamPreviews: {}, errorMessage: null }));
  // Re-register local media after process restart without discarding missing nodes.
  let missing = 0;
  if (getService()) for (const w of workspaces) for (const node of w.canvasNodes) {
    if (!node.savedPath) continue;
    try {
      if (node.type === "video") node.src = await studioService<string>("RegisterVideoAsset", node.savedPath);
      else {
        const asset = await studioService<{ fullUrl: string; imageId: string }>("RegisterMediaAsset", node.savedPath, "");
        node.src = asset.fullUrl; node.mediaId = asset.imageId;
      }
    } catch { missing++; }
  }
  const active = workspaces.find((w) => w.id === doc.activeWorkspaceId) ?? workspaces[0];
  useStudioStore.setState({ workspaces, activeWorkspaceId: active.id, prompt: active.prompt, canvasNodes: active.canvasNodes,
    canvasViewport: active.canvasViewport, selectedNodeId: active.selectedNodeId, currentImage: state.history.find((h) => h.id === active.currentImageId) ?? null });
  if (missing) state.pushToast(`${missing} 个本地素材无法读取；节点位置已保留，请检查素材是否被移动`, "warn", 7000);
}
let refreshing = false;
export async function refreshStudioTasks() {
  if (refreshing || !hasServiceMethod("ListTasks")) return;
  refreshing = true;
  try {
    const tasks = await studioService<StudioTask[]>("ListTasks");
    useStudioV2.setState({ tasks, taskError: "" });
    if (storageStopped) return;
    for (const task of tasks) {
      if (task.kind !== "video" || task.status !== "succeeded" || applied.has(task.id) || !task.result?.mediaUrl) continue;
      const state = useStudioStore.getState();
      const workspace = state.workspaces.find((w) => w.id === task.workspaceId);
      if (!workspace) continue;
      const nodes = workspace.id === state.activeWorkspaceId ? state.canvasNodes : workspace.canvasNodes ?? [];
      const nodeId = `video-task:${task.id}`;
      applied.add(task.id); // A durable receipt prevents deleted nodes reappearing.
      if (!nodes.some((n) => n.id === nodeId)) {
        const width = 480, height = width * (task.result.height || 9) / (task.result.width || 16);
        const x = nodes.length ? Math.max(...nodes.map((n) => n.x + n.width)) + 40 : 80;
        const node = createCanvasNode({ id: nodeId, type: "video", label: task.label, src: task.result.mediaUrl,
          savedPath: task.result.savedPath, width, height, x, y: 80, createdAt: task.createdAt });
        const nextNodes = [...nodes, node];
        useStudioStore.setState({ workspaces: state.workspaces.map((w) => w.id === workspace.id ? { ...w, canvasNodes: nextNodes } : w),
          ...(state.activeWorkspaceId === workspace.id ? { canvasNodes: nextNodes } : {}) });
      }
      scheduleSave();
    }
  } catch (error) { useStudioV2.setState({ taskError: `任务状态暂时无法读取：${String(error)}` }); }
  finally { refreshing = false; }
}
export function initializeStudioV2(bootstrap: () => Promise<void>): Promise<void> {
  if (initialized) return initialized;
  initialized = (async () => {
    await bootstrap();
    if (!useStudioStore.getState().apiKey) useStudioStore.setState({ settingsOpen: false });
    try { const document = await loadDocument(); if (document) await restoreDocument(document); }
    catch (error) { storageStopped = true; useStudioV2.setState({ storageError: `画布恢复失败：${String(error)}。自动保存已停止，原文档未覆盖。` }); }
    lastSaved = signature(canvasSnapshot(useStudioStore.getState(), revision, applied));
    useStudioV2.setState({ ready: true });
    useStudioStore.subscribe((s, old) => {
      if (s.workspaces !== old.workspaces || s.canvasNodes !== old.canvasNodes || s.canvasViewport !== old.canvasViewport || s.selectedNodeId !== old.selectedNodeId || s.prompt !== old.prompt || s.activeWorkspaceId !== old.activeWorkspaceId) scheduleSave();
    });
    window.addEventListener("pagehide", () => void flushCanvasDocument());
    document.addEventListener("visibilitychange", () => { if (document.hidden) void flushCanvasDocument(); });
    window.addEventListener("beforeunload", (event) => { if (dirty || saving) { void flushCanvasDocument(); event.preventDefault(); event.returnValue = ""; } });
    const poll = async () => { await refreshStudioTasks(); setTimeout(() => void poll(), 2000); };
    if (hasServiceMethod("ListTasks")) void poll();
  })().catch((error) => { useStudioV2.setState({ ready: true, storageError: `初始化失败：${String(error)}` }); });
  return initialized;
}
