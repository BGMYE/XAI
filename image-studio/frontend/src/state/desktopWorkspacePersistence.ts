import { createStore, get, set } from "idb-keyval";
import { base64ToBlob, blobToBase64 } from "../lib/images";
import { loadAllHistory } from "../lib/storage";
import { flushCompatibilityExport } from "../lib/compatState";
import { hasDesktopSettingsHost, invokeDesktopHost } from "../platform/runtime/desktop";
import { EventsOn, ImportImageFromB64, RegisterImportedImageAsset, RegisterMediaAsset } from "../platform/runtime/host";
import type { SourceImage } from "../types/domain";
import { cleanWorkspaceEdits, createDesktopWorkspaceSnapshot, readDesktopWorkspaceSnapshot, refreshWorkspaceMedia, type DesktopWorkspaceSnapshot } from "./desktopWorkspaceSnapshot";
import { saveActiveWorkspaceSnapshot } from "./studioStore.runtime";
import { sourceHistoryItemForCanvasNode } from "./canvasNodes";
import type { StudioState } from "./studioStore.types";

type Store = { getState(): StudioState; setState(patch: Partial<StudioState>): void; subscribe(listener: (state: StudioState, previous: StudioState) => void): () => void };
let flush: (() => Promise<void>) | null = null;
export async function flushDesktopWorkspacePersistence() { await flush?.(); }

export async function initializeDesktopWorkspacePersistence(store: Store) {
  if (!hasDesktopSettingsHost() || flush) return;
  const database = createStore("image-studio-desktop-workspaces", "snapshots");
  const sourceBlobs = new WeakMap<SourceImage, Promise<Blob | null>>();
  const urlBlobs = new Map<string, Promise<Blob>>();
  const readBlob = (url: string) => {
    let request = urlBlobs.get(url);
    if (!request) {
      request = fetch(url).then((response) => { if (!response.ok) throw new Error("素材暂不可用"); return response.blob(); });
      if (url.startsWith("blob:")) {
        urlBlobs.set(url, request);
        void request.catch(() => { urlBlobs.delete(url); });
      }
    }
    return request;
  };
  async function sourceBlob(source: SourceImage): Promise<Blob | null> {
    let request = sourceBlobs.get(source);
    if (!request) {
      request = source.previewUrl?.startsWith("/media/") ? readBlob(source.previewUrl.replace(/^\/media\/(preview|thumb)\//, "/media/full/"))
        : source.imageBlob ? Promise.resolve(source.imageBlob)
        : source.imageB64 ? Promise.resolve(base64ToBlob(source.imageB64))
        : Promise.resolve(null);
      sourceBlobs.set(source, request);
      void request.catch(() => { sourceBlobs.delete(source); });
    }
    return request;
  }
  async function prepare(snapshot: DesktopWorkspaceSnapshot, state: StudioState) {
    for (let index = 0; index < snapshot.workspaces.length; index++) {
      const workspace = snapshot.workspaces[index];
      const live = workspace.id === state.activeWorkspaceId ? state.sources : state.workspaces.find((item) => item.id === workspace.id)?.sources ?? [];
      workspace.sources = await Promise.all(workspace.sources.map(async (source, sourceIndex) => ({ ...source, imageBlob: live[sourceIndex] ? await sourceBlob(live[sourceIndex]) : source.imageBlob })));
      for (const node of workspace.canvasNodes ?? []) {
        if (node.src?.startsWith("blob:")) snapshot.blobs[node.src] = await readBlob(node.src);
      }
    }
    return snapshot;
  }
  try {
    const raw = await get("current", database);
    const saved = readDesktopWorkspaceSnapshot(raw);
    if (raw && !saved) throw new Error("无法识别工作区存档");
    if (saved) {
      const urls = new Map(Object.entries(saved.blobs).map(([url, blob]) => [url, URL.createObjectURL(blob)]));
      const needed = new Set(saved.workspaces.flatMap((workspace) => [workspace.currentImageId, ...workspace.batchResultIds, ...(workspace.canvasNodes ?? []).map((node) => node.id)]).filter(Boolean));
      let history = store.getState().history;
      if ([...needed].some((id) => !history.some((item) => item.id === id))) {
        const known = new Set(history.map((item) => item.id));
        history = [...history, ...(await loadAllHistory()).filter((item) => needed.has(item.id) && !known.has(item.id))];
      }
      let missingMedia = false;
      const media = new Map<string, { src?: string; mediaId?: string }>();
      history = await Promise.all(history.map(async (item) => {
        if (!needed.has(item.id) || !item.savedPath) return item;
        try {
          const ref = await RegisterMediaAsset(item.savedPath, item.thumbPath ?? "");
          media.set(item.id, { src: ref.previewUrl, mediaId: ref.imageId });
          return { ...item, ...ref };
        } catch { missingMedia = true; return item; }
      }));
      const workspaces = [];
      for (const workspace of saved.workspaces) {
        const sources = await Promise.all(workspace.sources.map(async (source) => {
          try { return { ...source, ...await RegisterImportedImageAsset(source.path) }; }
          catch {
            if (source.imageBlob) {
              const imported = await ImportImageFromB64(await blobToBase64(source.imageBlob), source.name);
              return { ...source, path: imported.path, previewUrl: imported.previewUrl, previewWidth: imported.previewWidth, previewHeight: imported.previewHeight };
            }
            missingMedia = true;
            return source;
          }
        }));
        const restored = refreshWorkspaceMedia(workspace, sources, media);
        const edits = saved.workspaceEdits?.[workspace.id]
          ?? (workspace.id === saved.activeWorkspaceId ? cleanWorkspaceEdits(saved) : { annotations: [], strokes: [], maskDataURL: null });
        restored.editorState = { ...edits, undoStack: [], redoStack: [] };
        restored.canvasNodes = restored.canvasNodes?.map((node) => ({ ...node, src: node.src ? urls.get(node.src) ?? node.src : undefined }));
        workspaces.push(restored);
      }
      store.setState({ workspaces, activeWorkspaceId: "", history, runningJobMeta: {} });
      store.getState().switchWorkspace(saved.activeWorkspaceId);
      const active = workspaces.find((workspace) => workspace.id === saved.activeWorkspaceId);
      const sourceImage = sourceHistoryItemForCanvasNode(active?.canvasNodes?.find((node) => node.id === active.currentImageId));
      if (!store.getState().currentImage && sourceImage) store.setState({ currentImage: sourceImage });
      if (missingMedia) store.getState().pushToast("工作区已恢复，部分素材无法读取，请重新添加。", "warn", 0);
    }
  } catch {
    store.getState().pushToast("工作区未能恢复。原存档已保留，重启后可重试。", "error", 0);
    // Never replace an unreadable existing archive with the empty startup workspace.
    return;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending = false;
  let writing = Promise.resolve();
  let failed = false;
  flush = () => {
    clearTimeout(timer);
    if (!pending) return writing;
    pending = false;
    const state = store.getState();
    const snapshot = createDesktopWorkspaceSnapshot({ activeWorkspaceId: state.activeWorkspaceId, workspaces: saveActiveWorkspaceSnapshot(state), annotations: state.annotations, strokes: state.strokes, maskDataURL: state.maskDataURL });
    writing = writing.then(async () => {
      try {
        await set("current", await prepare(snapshot, state), database);
        if (failed) store.getState().pushToast("工作区自动保存已恢复。", "success");
        failed = false;
      } catch {
        pending = true;
        if (!failed) store.getState().pushToast("工作区暂未保存，请检查可用空间后重试。", "error", 0, { label: "重试", onClick: () => { void flush?.(); } });
        failed = true;
      }
    });
    return writing;
  };
  const fields: (keyof StudioState)[] = ["workspaces", "activeWorkspaceId", "prompt", "negativePrompt", "mode", "size", "quality", "outputFormat", "seed", "background", "outputCompression", "inputFidelity", "imageStyle", "moderation", "userIdentifier", "partialImages", "batchCount", "selectedPresetId", "editSourceMode", "editAutoAspectResolution", "batchProcess", "loopGeneration", "sources", "canvasNodes", "canvasViewport", "selectedNodeId", "currentImage", "batchResults", "resultGridOpen", "annotations", "strokes", "maskDataURL"];
  store.subscribe((state, previous) => {
    if (!fields.some((field) => state[field] !== previous[field])) return;
    pending = true; clearTimeout(timer); timer = setTimeout(() => { void flush?.(); }, 250);
  });
  window.addEventListener("pagehide", () => { void flush?.(); });
  EventsOn("desktop-workspace-flush-request", () => {
    void (async () => {
      let compatibilitySaved = true;
      try {
        // Edits can arrive while the host writes compatibility data. Recheck
        // the workspace after both stores settle before allowing the window to close.
        do {
          await flush?.();
          await flushCompatibilityExport();
        } while (pending && !failed);
      }
      catch {
        compatibilitySaved = false;
        store.getState().pushToast("作品记录暂未保存，请检查可用空间后再关闭。", "error", 0);
      }
      await invokeDesktopHost("CompleteWorkspaceFlush", !failed && compatibilitySaved);
    })();
  });
  await invokeDesktopHost("WorkspacePersistenceReady");
}
