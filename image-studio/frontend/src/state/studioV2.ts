import { create } from "zustand";
import { buildStudioDocument, DocumentWriter, mergeTaskRecords, videoTaskNode, type StudioTask } from "../lib/studioDocuments";
import { EventsOn, GetStoredAPIKey, RegisterImportedImageAsset, RegisterMediaAsset } from "../platform/runtime/host";
import { studioBackend, type VideoTaskInput } from "../platform/runtime/studioBackend";
import { useStudioStore } from "./studioStore";
import { isAndroid } from "../platform";
import { sourceHistoryItemForCanvasNode } from "./canvasNodes";
import type { Workspace } from "../types/domain";

type StorageState = "loading" | "preview" | "unsaved" | "saving" | "saved" | "error";
export const useStudioV2 = create<{
  ready: boolean; available: boolean; storage: StorageState; error: string;
  taskError: string; tasks: StudioTask[];
}>(() => ({ ready: false, available: false, storage: "loading", error: "", taskError: "", tasks: [] }));
const applied = new Set<string>();
let started: Promise<void> | null = null;
let writer: DocumentWriter | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let interval: ReturnType<typeof setInterval> | undefined;
let unsubscribe: (() => void) | undefined;
let unlisten: (() => void) | undefined;
let refreshing = false;
function message(error: unknown) { return error instanceof Error ? error.message : String(error); }

function scheduleSave() {
  if (!writer || !useStudioV2.getState().ready) return;
  if (useStudioV2.getState().storage !== "error") useStudioV2.setState({ storage: "unsaved" });
  clearTimeout(timer);
  timer = setTimeout(() => { void flushStudioDocument(); }, 350);
}
export async function flushStudioDocument() {
  clearTimeout(timer);
  if (writer) await writer.enqueue(buildStudioDocument(useStudioStore.getState(), applied));
}
export async function retryStudioSave() {
  // Never resolve an optimistic-lock conflict by silently changing the revision.
  if (useStudioV2.getState().error.includes("CANVAS_CONFLICT")) return;
  await writer?.retry();
}
export function deliverVideoTask(task: StudioTask, workspaceId = task.workspaceId, automatic = false) {
  if (!useStudioV2.getState().ready || (automatic && applied.has(task.id))) return;
  const store = useStudioStore.getState();
  const workspace = store.workspaces.find((entry) => entry.id === workspaceId);
  const node = videoTaskNode(task);
  if (!workspace || !node) return;
  const nodes = workspace.id === store.activeWorkspaceId ? store.canvasNodes : workspace.canvasNodes || [];
  const offset = nodes.length % 12 * 36;
  // The delivery marker and node are written in the same canvas document.
  applied.add(task.id);
  const incoming = { ...node, x: node.x + offset, y: node.y + offset };
  if (automatic) {
    // Receiving a finished task must not steal the user's selected image.
    const nextNodes = nodes.some((entry) => entry.id === node.id) ? nodes : [...nodes, incoming];
    useStudioStore.setState({ workspaces: store.workspaces.map((entry) => entry.id === workspace.id ? { ...entry, canvasNodes: nextNodes } : entry),
      ...(workspace.id === store.activeWorkspaceId ? { canvasNodes: nextNodes } : {}) });
  } else store.addCanvasNodeToWorkspace(workspace.id, incoming);
  scheduleSave();
}
export async function refreshStudioTasks() {
  if (!studioBackend.available() || refreshing) return;
  refreshing = true;
  try {
    const tasks = mergeTaskRecords(useStudioV2.getState().tasks, (await studioBackend.tasks()) || []);
    useStudioV2.setState({ tasks, taskError: "" });
    for (const task of tasks) deliverVideoTask(task, task.workspaceId, true);
  } catch (error) { useStudioV2.setState({ taskError: message(error) }); }
  finally { refreshing = false; }
}
export async function submitStudioVideo(options: VideoTaskInput) {
  if (!useStudioV2.getState().ready || useStudioV2.getState().storage === "error") throw new Error("请等待画布加载或修复保存错误后再提交。");
  // Persist the target workspace before reserving a paid upstream task.
  await flushStudioDocument();
  if (useStudioV2.getState().storage === "error") throw new Error("工作区未能保存；视频请求未发送。");
  const task = await studioBackend.submit(options);
  useStudioV2.setState((state) => ({ tasks: mergeTaskRecords(state.tasks, [task]) }));
  await refreshStudioTasks(); return task;
}
export async function cancelStudioTask(task: StudioTask) {
  await studioBackend.cancel(task.id); await refreshStudioTasks();
}
export async function resumeStudioTask(task: StudioTask) {
  const state = useStudioStore.getState();
  const profile = state.profiles.find((entry) => entry.id === task.profileId);
  if (!profile) throw new Error("原上游配置已删除；请先恢复该配置。");
  const apiKey = profile.id === state.activeProfileId ? state.apiKey : await GetStoredAPIKey(`profile:${profile.id}`);
  const resumed = await studioBackend.resume(task.id, {
    profileId: profile.id, baseURL: profile.baseURL, apiKey, workspaceId: task.workspaceId || "",
    provider: task.provider === "xai" ? "xai" : "openai-compatible", videoModelID: profile.videoModelID,
    prompt: "resume", seconds: 1,
  });
  useStudioV2.setState((current) => ({ tasks: mergeTaskRecords(current.tasks, [resumed]) }));
  await refreshStudioTasks();
}

export function startStudioV2(): Promise<void> {
  return started ??= (async () => {
    const available = studioBackend.available();
    useStudioV2.setState({ available });
    if (isAndroid) { useStudioV2.setState({ ready: true, storage: "preview" }); return; }
    try {
      const doc = await studioBackend.load();
      if (doc.version !== 1 || !Array.isArray(doc.workspaces)) throw new Error("无法识别画布文档；原文件不会被覆盖。");
      const state = useStudioStore.getState();
      const template = state.workspaces[0];
      for (const id of doc.appliedVideoTaskIds || []) applied.add(id);
      let missing = 0;
      if (doc.workspaces.length && template) {
        const workspaces: Workspace[] = [];
        for (const workspace of doc.workspaces) {
          const nodes = [];
          for (const node of workspace.nodes || []) {
            let src = node.src;
            if (node.savedPath && available) {
              try {
                if (node.type === "video") src = await studioBackend.registerVideo(node.savedPath);
                else {
                  const asset = node.id.startsWith("source-preview:")
                    ? await RegisterImportedImageAsset(node.savedPath) : await RegisterMediaAsset(node.savedPath, "");
                  src = asset.fullUrl || asset.previewUrl;
                }
              } catch { src = ""; missing++; }
            }
            nodes.push({ ...node, src });
          }
          workspaces.push({ ...template, id: workspace.id, name: workspace.name, prompt: workspace.prompt,
            canvasNodes: nodes, canvasViewport: workspace.viewport, selectedNodeId: workspace.selectedNodeId || null,
            sources: [], currentImageId: null, batchResultIds: [], runningJobIds: [], lastPayload: null });
        }
        const active = workspaces.find((entry) => entry.id === doc.activeWorkspaceId) || workspaces[0];
        const selected = active.canvasNodes?.find((node) => node.id === active.selectedNodeId);
        const currentImage = state.history.find((item) => item.id === selected?.id) || sourceHistoryItemForCanvasNode(selected) || null;
        useStudioStore.setState({ workspaces, activeWorkspaceId: active.id, canvasNodes: active.canvasNodes || [],
          canvasViewport: active.canvasViewport || null, selectedNodeId: active.selectedNodeId || null,
          prompt: active.prompt, currentImage, sources: [], runningJobs: [], isRunning: false });
      }
      writer = new DocumentWriter(doc.revision, studioBackend.save, (storage, error = "") => useStudioV2.setState({ storage, error }));
      useStudioV2.setState({ ready: true, storage: "saved" });
      if (missing) state.pushToast(`${missing} 个素材文件不可读，已保留节点位置；请检查原文件是否被移动。`, "warn");
      unsubscribe = useStudioStore.subscribe((next, previous) => {
        if (next.workspaces !== previous.workspaces || next.canvasNodes !== previous.canvasNodes ||
          next.activeWorkspaceId !== previous.activeWorkspaceId || next.prompt !== previous.prompt ||
          next.canvasViewport !== previous.canvasViewport || next.selectedNodeId !== previous.selectedNodeId) scheduleSave();
      });
      if (available) {
        unlisten = EventsOn("task:changed", () => { void refreshStudioTasks(); });
        interval = setInterval(() => { void refreshStudioTasks(); }, 3000);
      }
      window.addEventListener("pagehide", onPageHide);
      document.addEventListener("visibilitychange", onVisibilityChange);
      window.addEventListener("beforeunload", onBeforeUnload);
      await refreshStudioTasks();
      if (!doc.workspaces.length) scheduleSave();
    } catch (error) { useStudioV2.setState({ ready: false, storage: "error", error: message(error) }); }
  })();
}
function onPageHide() { void flushStudioDocument(); }
function onVisibilityChange() { if (document.hidden) void flushStudioDocument(); }
function onBeforeUnload(event: BeforeUnloadEvent) {
  if (["unsaved", "saving", "error"].includes(useStudioV2.getState().storage)) {
    void flushStudioDocument(); event.preventDefault(); event.returnValue = "";
  }
}
if (import.meta.hot) import.meta.hot.dispose(() => {
  clearTimeout(timer); clearInterval(interval); unsubscribe?.(); unlisten?.();
  window.removeEventListener("pagehide", onPageHide);
  document.removeEventListener("visibilitychange", onVisibilityChange);
  window.removeEventListener("beforeunload", onBeforeUnload);
});
