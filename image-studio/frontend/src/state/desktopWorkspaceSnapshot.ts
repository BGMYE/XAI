import type { Annotation, SourceImage, Workspace } from "../types/domain";
import type { CanvasNode } from "./canvasNodes";
import type { Stroke } from "./studioStore.types";

// Keep this list explicit. A workspace can contain lastPayload with API credentials.
const workspaceFields = ["id", "name", "prompt", "negativePrompt", "mode", "size", "quality", "outputFormat", "seed", "background", "outputCompression", "inputFidelity", "imageStyle", "moderation", "userIdentifier", "partialImages", "batchCount", "selectedPresetId", "editSourceMode", "editAutoAspectResolution", "currentImageId", "selectedNodeId", "resultGridOpen"] as const;
const sourceFields = ["path", "name", "size", "previewUrl", "previewWidth", "previewHeight", "imageBlob", "imageB64"] as const;
const nodeFields = ["id", "type", "mediaId", "src", "label", "x", "y", "width", "height", "createdAt"] as const;

function pick<T, K extends keyof T>(value: T, fields: readonly K[]): Pick<T, K> {
  return Object.fromEntries(fields.map((key) => [key, value[key]])) as Pick<T, K>;
}

export interface DesktopWorkspaceSnapshot {
  version: 1;
  activeWorkspaceId: string;
  workspaces: Workspace[];
  annotations: Annotation[];
  strokes: Stroke[];
  maskDataURL: string | null;
  blobs: Record<string, Blob>;
  workspaceEdits?: Record<string, WorkspaceEdits>;
}

export interface WorkspaceEdits {
  annotations: Annotation[];
  strokes: Stroke[];
  maskDataURL: string | null;
}

export function cleanWorkspaceEdits(input: WorkspaceEdits): WorkspaceEdits {
  return {
    annotations: input.annotations.map((annotation) => ({ ...pick(annotation, ["id", "kind", "x", "y", "width", "height", "text", "color"]), points: annotation.points ? [...annotation.points] : undefined })),
    strokes: input.strokes.map((stroke) => ({ points: [...stroke.points], size: stroke.size, erase: stroke.erase })),
    maskDataURL: input.maskDataURL?.startsWith("data:image/") ? input.maskDataURL : null,
  };
}

export function cleanWorkspace(workspace: Workspace): Workspace {
  return {
    ...pick(workspace, workspaceFields),
    batchProcess: {
      ...pick(workspace.batchProcess, ["enabled", "inputDir", "outputMode", "outputDir", "concurrency", "retryOnFailure", "fileNamePrefix", "autoAspectResolution"]),
      discoveredSources: workspace.batchProcess.discoveredSources.map((source) => pick(source, ["path", "name", "size", "width", "height", "previewUrl", "previewWidth", "previewHeight"])),
    },
    loopGeneration: pick(workspace.loopGeneration, ["enabled", "totalCount", "concurrency", "autoSave", "autoSaveDir", "livePreview"]),
    sources: workspace.sources.map((source) => pick(source, sourceFields)),
    canvasNodes: (workspace.canvasNodes ?? []).map((node) => pick(node, nodeFields)),
    canvasViewport: workspace.canvasViewport ? pick(workspace.canvasViewport, ["x", "y", "scale"]) : undefined,
    batchResultIds: [...workspace.batchResultIds],
    runningJobIds: [], jobsTotal: 0, jobsCompleted: 0, progress: null,
    streamPreview: null, streamPreviews: {}, lastLogLine: "", errorMessage: null,
    errorCanRetry: false, errorRawPath: null, lastPayload: null,
  };
}

export function createDesktopWorkspaceSnapshot(input: Omit<DesktopWorkspaceSnapshot, "version" | "blobs">): DesktopWorkspaceSnapshot {
  return {
    version: 1,
    activeWorkspaceId: input.activeWorkspaceId,
    workspaces: input.workspaces.map(cleanWorkspace),
    ...cleanWorkspaceEdits(input),
    workspaceEdits: Object.fromEntries(input.workspaces.map((workspace) => [workspace.id, cleanWorkspaceEdits(workspace.id === input.activeWorkspaceId ? input : workspace.editorState ?? input.workspaceEdits?.[workspace.id] ?? { annotations: [], strokes: [], maskDataURL: null })])),
    blobs: {},
  };
}

export function readDesktopWorkspaceSnapshot(value: unknown): DesktopWorkspaceSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const snapshot = value as DesktopWorkspaceSnapshot;
  if (snapshot.version !== 1 || !Array.isArray(snapshot.workspaces) || !snapshot.workspaces.length) return null;
  if (!snapshot.workspaces.every((workspace) => typeof workspace.id === "string" && typeof workspace.prompt === "string" && Array.isArray(workspace.sources) && workspace.batchProcess && workspace.loopGeneration)) return null;
  const clean = createDesktopWorkspaceSnapshot({ ...snapshot, annotations: snapshot.annotations ?? [], strokes: snapshot.strokes ?? [] });
  clean.activeWorkspaceId = clean.workspaces.some((workspace) => workspace.id === clean.activeWorkspaceId) ? clean.activeWorkspaceId : clean.workspaces[0].id;
  clean.blobs = Object.fromEntries(Object.entries(snapshot.blobs ?? {}).filter(([url, blob]) => url.startsWith("blob:") && blob instanceof Blob));
  return clean;
}

export function refreshWorkspaceMedia(workspace: Workspace, sources: SourceImage[], historyNodes: Map<string, Partial<CanvasNode>>): Workspace {
  const sourcesByPath = new Map(workspace.sources.map((source, index) => [source.path, sources[index]]));
  const refreshSourceID = (id: string | null | undefined) => id?.startsWith("source-preview:")
    ? `source-preview:${sourcesByPath.get(id.slice("source-preview:".length))?.path ?? id.slice("source-preview:".length)}` : id;
  return {
    ...workspace, sources,
    canvasNodes: (workspace.canvasNodes ?? []).map((node) => {
      const source = node.id.startsWith("source-preview:") ? sourcesByPath.get(node.id.slice("source-preview:".length)) : undefined;
      if (source) return { ...node, id: `source-preview:${source.path}`, src: source.previewUrl, mediaId: undefined };
      const media = historyNodes.get(node.id);
      return media ? { ...node, ...media } : node;
    }),
    selectedNodeId: refreshSourceID(workspace.selectedNodeId),
    currentImageId: refreshSourceID(workspace.currentImageId) ?? null,
  };
}
