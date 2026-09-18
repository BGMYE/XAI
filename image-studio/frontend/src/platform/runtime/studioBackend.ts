import { createStore, get, update } from "idb-keyval";
import { validateCanvasDocument } from "../../lib/canvasDocument";
import { hasServiceMethod, invokeService } from "./hostBindings";
import type { StudioDocument, StudioTask } from "../../lib/studioDocuments";
export interface VideoTaskInput {
  baseURL: string; apiKey: string; profileId: string; workspaceId: string;
  requestedJobId?: string; provider: "openai-compatible" | "xai"; videoModelID: string;
  prompt: string; seconds: number; size?: string; aspectRatio?: string;
  resolution?: string; referencePath?: string;
}
const unavailable = () => "此功能需要新版桌面后端；浏览器预览不会提交视频请求。";
const invoke = <T>(method: string, ...args: unknown[]) => invokeService<T>(unavailable, method, ...args);
// Do not use the legacy history database: old migrations may omit keyval's store.
const canvasStore = createStore("xai-studio-canvas-v1", "documents");
const documentKey = "xai.canvas-document.v1";
export const studioBackend = {
  available: () => hasServiceMethod("ListTasks") && hasServiceMethod("SaveCanvasDocument"),
  load: async (): Promise<StudioDocument> => {
    const doc = hasServiceMethod("LoadCanvasDocument") ? await invoke<StudioDocument>("LoadCanvasDocument")
      : await get<StudioDocument>(documentKey, canvasStore) || { version: 1, revision: 0, activeWorkspaceId: "", workspaces: [], appliedVideoTaskIds: [] };
    validateCanvasDocument(doc); return doc;
  },
  save: async (doc: StudioDocument, revision: number): Promise<StudioDocument> => {
    validateCanvasDocument(doc);
    if (hasServiceMethod("SaveCanvasDocument")) return invoke<StudioDocument>("SaveCanvasDocument", doc, revision);
    if (new TextEncoder().encode(JSON.stringify(doc)).byteLength > 16 * 1024 * 1024) throw new Error("画布文档超过 16 MiB");
    let saved = doc;
    await update<StudioDocument>(documentKey, (previous) => {
      if ((previous?.revision || 0) !== revision) throw new Error("CANVAS_CONFLICT: 画布已被其他窗口修改；未覆盖原文档");
      saved = { ...doc, revision: revision + 1 }; return saved;
    }, canvasStore);
    return saved;
  },
  tasks: () => invoke<StudioTask[]>("ListTasks"),
  submit: (options: VideoTaskInput) => invoke<StudioTask>("SubmitVideoTask", options),
  resume: (id: string, options: VideoTaskInput) => invoke<StudioTask>("ResumeVideoTask", id, options),
  cancel: (id: string) => invoke<void>("Cancel", id),
  registerVideo: (path: string) => invoke<string>("RegisterVideoAsset", path),
};
