import assert from "node:assert/strict";
import test from "node:test";
import { createDesktopWorkspaceSnapshot, readDesktopWorkspaceSnapshot, refreshWorkspaceMedia } from "../src/state/desktopWorkspaceSnapshot.ts";

function workspace() {
  return {
    id: "workspace-a", name: "Sketch", prompt: "A quiet valley", negativePrompt: "",
    mode: "edit", size: "1024x1024", quality: "medium", outputFormat: "png", seed: 7,
    background: "auto", outputCompression: 100, inputFidelity: "high", imageStyle: "vivid",
    moderation: "auto", userIdentifier: "", partialImages: 1, batchCount: 1,
    editSourceMode: "manual", batchProcess: { enabled: false, discoveredSources: [], unexpectedSecret: "SENSITIVE_MARKER" },
    loopGeneration: { enabled: false, totalCount: 2, concurrency: 1, autoSave: false, autoSaveDir: "", livePreview: true },
    sources: [{ path: "old.png", name: "reference", size: 3, imageBlob: new Blob(["png"], { type: "image/png" }), extraKey: "SENSITIVE_MARKER" }],
    canvasNodes: [{ id: "source-preview:old.png", type: "image", x: 80, y: -40, width: 400, height: 300, createdAt: 123, src: "/media/preview/old", secret: "SENSITIVE_MARKER" }],
    canvasViewport: { x: -35, y: 42, scale: 1.75, extra: "SENSITIVE_MARKER" },
    selectedNodeId: "source-preview:old.png", currentImageId: "result", batchResultIds: ["result"], resultGridOpen: false,
    runningJobIds: ["old-job"], lastPayload: { apiKey: "SENSITIVE_MARKER", prompt: "private request" },
    streamPreview: { imageB64: "partial" }, errorMessage: "SENSITIVE_MARKER", injected: "SENSITIVE_MARKER",
  };
}

test("workspace restart preserves canvas, media Blobs and painting but excludes credentials and unfinished jobs", async () => {
  const input = { activeWorkspaceId: "workspace-a", workspaces: [workspace()], annotations: [{ id: "a", kind: "rect", x: 1, y: 2, width: 10, height: 20, color: "red", injected: "SENSITIVE_MARKER" }], strokes: [{ points: [10, 20, 30, 40], size: 14, erase: true, injected: "SENSITIVE_MARKER" }], maskDataURL: "data:image/png;base64,cG5n" };
  const snapshot = createDesktopWorkspaceSnapshot(input);
  const restored = readDesktopWorkspaceSnapshot(structuredClone(snapshot));
  assert.equal(JSON.stringify(snapshot).includes("SENSITIVE_MARKER"), false);
  assert.equal(await restored.workspaces[0].sources[0].imageBlob.text(), "png");
  assert.deepEqual(restored.workspaces[0].canvasViewport, { x: -35, y: 42, scale: 1.75 });
  assert.equal(restored.workspaces[0].canvasNodes[0].x, 80);
  assert.deepEqual(restored.workspaces[0].runningJobIds, []);
  assert.equal(restored.workspaces[0].lastPayload, null);
  assert.equal(restored.workspaces[0].streamPreview, null);
  assert.deepEqual(restored.strokes, [{ points: [10, 20, 30, 40], size: 14, erase: true }]);
  assert.equal(restored.maskDataURL, input.maskDataURL);
});

test("snapshot rejects unknown schema and safely picks an existing active workspace", () => {
  assert.equal(readDesktopWorkspaceSnapshot({ version: 2, workspaces: [] }), null);
  assert.equal(readDesktopWorkspaceSnapshot({ version: 1, workspaces: [{}] }), null);
  const restored = readDesktopWorkspaceSnapshot(createDesktopWorkspaceSnapshot({ activeWorkspaceId: "deleted", workspaces: [workspace()], annotations: [], strokes: [], maskDataURL: "__PENDING_MASK__" }));
  assert.equal(restored.activeWorkspaceId, "workspace-a");
  assert.equal(restored.maskDataURL, null);
});

test("restored source paths and media URLs preserve node geometry and selection", () => {
  const original = workspace();
  const restored = refreshWorkspaceMedia(original, [{ ...original.sources[0], path: "managed.png", previewUrl: "/media/preview/new" }], new Map());
  assert.equal(restored.canvasNodes[0].id, "source-preview:managed.png");
  assert.equal(restored.selectedNodeId, "source-preview:managed.png");
  assert.equal(restored.canvasNodes[0].src, "/media/preview/new");
  assert.equal(restored.canvasNodes[0].x, 80);
  assert.equal(restored.canvasNodes[0].height, 300);
});
