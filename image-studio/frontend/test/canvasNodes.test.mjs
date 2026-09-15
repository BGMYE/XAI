import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const nodes = await import("../src/state/canvasNodes.ts");
const { buildImageMaskPNGDataURL } = await import("../src/state/canvasMask.ts");

test("native URL images produce a hand-painted mask at their full canvas image size", () => {
  const previousDocument = globalThis.document;
  const paths = [];
  const canvas = {
    width: 0, height: 0,
    getContext: () => ({
      fillRect: (...rect) => paths.push(["fill", ...rect]),
      beginPath() {}, moveTo: (...point) => paths.push(["start", ...point]),
      lineTo: (...point) => paths.push(["line", ...point]), stroke() {},
    }),
    toDataURL: (mime) => { assert.equal(mime, "image/png"); return "data:image/png;base64,encoded-mask"; },
  };
  globalThis.document = { createElement: (tag) => { assert.equal(tag, "canvas"); return canvas; } };
  try {
    const image = { id: "native-a", fullUrl: "/media/full/native-a", previewWidth: 384, previewHeight: 288 };
    const result = buildImageMaskPNGDataURL([{ points: [1500, 900, 1700, 1100], size: 24 }], image, [
      nodes.createCanvasNode({ id: "unrelated", type: "image", width: 512, height: 512 }),
      nodes.createCanvasNode({ id: image.id, type: "image", width: 2048, height: 1536 }),
    ]);
    assert.equal(result, "data:image/png;base64,encoded-mask");
    assert.deepEqual([canvas.width, canvas.height], [2048, 1536]);
    assert.deepEqual(paths, [["fill", 0, 0, 2048, 1536], ["start", 1500, 900], ["line", 1700, 1100]]);
  } finally { globalThis.document = previousDocument; }
});

test("mask sizing never substitutes a thumbnail, another image, or a video node", () => {
  const image = { id: "native-a", fullUrl: "/media/full/native-a", previewWidth: 384, previewHeight: 288 };
  const strokes = [{ points: [10, 10, 20, 20], size: 12 }];
  assert.equal(buildImageMaskPNGDataURL(strokes, image, []), null);
  assert.equal(buildImageMaskPNGDataURL(strokes, image, [nodes.createCanvasNode({ id: "unrelated", type: "image" })]), null);
  assert.equal(buildImageMaskPNGDataURL(strokes, image, [nodes.createCanvasNode({ id: image.id, type: "video" })]), null);
});

test("a reference layer keeps its editable image after another image replaces active sources", () => {
  const node = nodes.createCanvasNode({
    id: "source-preview:C:\\images\\original-a.png", type: "image", mediaId: "asset-a",
    src: "/media/full/asset-a", width: 640, height: 480, createdAt: 123,
  });
  const image = nodes.sourceHistoryItemForCanvasNode(node);
  assert.equal(image.savedPath, "C:\\images\\original-a.png");
  assert.equal(image.id, node.id);
  assert.equal(image.imageId, "asset-a");
  assert.equal(image.fullUrl, "/media/full/asset-a");
  assert.equal(image.mode, "edit");
  assert.deepEqual([image.previewWidth, image.previewHeight, image.createdAt], [640, 480, 123]);
});

test("source layer recovery never invents a path for generated images or video nodes", () => {
  assert.equal(nodes.sourceHistoryItemForCanvasNode(nodes.createCanvasNode({ id: "generated", type: "image" })), undefined);
  assert.equal(nodes.sourceHistoryItemForCanvasNode(nodes.createCanvasNode({ id: "source-preview:/movie.mp4", type: "video" })), undefined);
  assert.equal(nodes.sourceHistoryItemForCanvasNode(nodes.createCanvasNode({ id: "source-preview:", type: "image" })), undefined);
});

test("canvas node reducer supports selection, movement, deletion, and preserves other nodes", () => {
  const image = nodes.createCanvasNode({ id: "img-1", type: "image", mediaId: "h-1", x: 10, y: 20 });
  const video = nodes.createCanvasNode({ id: "vid-1", type: "video", mediaId: "v-1", x: 300, y: 40 });
  let state = nodes.canvasStateReducer({ nodes: [], selectedNodeId: null }, { type: "add", node: image });
  state = nodes.canvasStateReducer(state, { type: "add", node: video });
  state = nodes.canvasStateReducer(state, { type: "select", id: "vid-1" });
  state = nodes.canvasStateReducer(state, { type: "move", id: "vid-1", x: 420, y: 80 });
  assert.equal(state.selectedNodeId, "vid-1");
  assert.deepEqual(state.nodes.find((n) => n.id === "vid-1").x, 420);
  state = nodes.canvasStateReducer(state, { type: "remove", id: "vid-1" });
  assert.deepEqual(state.nodes.map((n) => n.id), ["img-1"]);
  assert.equal(state.selectedNodeId, null);
});

test("fitCanvasView contains every node and remains stable for an empty canvas", () => {
  assert.deepEqual(nodes.fitCanvasView([], 800, 600), { x: 0, y: 0, scale: 1 });
  const view = nodes.fitCanvasView([
    nodes.createCanvasNode({ id: "a", type: "image", x: -100, y: -50, width: 200, height: 100 }),
    nodes.createCanvasNode({ id: "b", type: "image", x: 900, y: 650, width: 200, height: 100 }),
  ], 800, 600);
  assert.ok(view.scale > 0 && view.scale <= 1);
  assert.ok(Number.isFinite(view.x) && Number.isFinite(view.y));
});

test("one-to-one view centers a selected world-space node", () => {
  const node = nodes.createCanvasNode({ id: "offset", type: "image", x: 420, y: -180, width: 640, height: 480 });
  assert.deepEqual(nodes.oneToOneCanvasView(node, 1200, 800), { scale: 1, x: -140, y: 340 });
});

test("selecting a node does not mutate its world coordinates", () => {
  const node = nodes.createCanvasNode({ id: "img", type: "image", x: 123, y: -77 });
  const state = nodes.canvasStateReducer({ nodes: [node], selectedNodeId: null }, { type: "select", id: "img" });
  assert.equal(state.selectedNodeId, "img");
  assert.deepEqual({ x: state.nodes[0].x, y: state.nodes[0].y }, { x: 123, y: -77 });
});

test("late image metadata updates dimensions without teleporting a node", () => {
  const placeholder = nodes.createCanvasNode({ id: "img", type: "image", x: 123, y: -77, width: 280, height: 280 });
  const loaded = nodes.createCanvasNode({ id: "img", type: "image", x: 999, y: 999, width: 1920, height: 1080 });
  const merged = nodes.mergeCanvasNodePreservingPosition(placeholder, loaded);
  assert.deepEqual({ x: merged.x, y: merged.y, width: merged.width, height: merged.height }, { x: 123, y: -77, width: 1920, height: 1080 });
});

test("upserting a node updates media metadata but keeps list identity unique", () => {
  const placeholder = nodes.createCanvasNode({ id: "img", type: "image", x: 10, y: 20, width: 280, height: 280 });
  const loaded = nodes.createCanvasNode({ id: "img", type: "image", x: 30, y: 40, width: 1600, height: 900 });
  const next = nodes.upsertCanvasNodeList([placeholder], loaded);
  assert.equal(next.length, 1);
  assert.deepEqual({ x: next[0].x, y: next[0].y, width: next[0].width, height: next[0].height }, { x: 10, y: 20, width: 1600, height: 900 });
});

test("video-only workspaces still render the canvas stage", async () => {
  const source = await readFile(new URL("../src/components/canvas/CanvasStage.tsx", import.meta.url), "utf8");
  assert.match(source, /!currentImage\s*&&\s*canvasNodes\.length\s*===\s*0\s*&&\s*!showingResultGrid/);
  assert.match(source, /!showingResultGrid\s*&&\s*!compareB\s*&&\s*\(currentImage\s*\|\|\s*canvasNodes\.length\s*>\s*0\)/);
});

test("video canvas frames redraw Konva without per-frame React state", async () => {
  const source = await readFile(new URL("../src/components/canvas/CanvasNodeShape.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /setFrame/);
  assert.doesNotMatch(source, /element\.crossOrigin\s*=/, "signed provider URLs must not require optional CORS headers just to play");
  assert.match(source, /getLayer\(\)\?\.batchDraw\(\)/);
});

test("selecting video detaches image-only editing overlays", async () => {
  const source = await readFile(new URL("../src/components/canvas/CanvasStage.tsx", import.meta.url), "utf8");
  assert.match(source, /if \(node\.type === "video"\) setField\("currentImage", null\)/);
});

test("deleting the active image cannot leave a ghost node that is re-added", async () => {
  const source = await readFile(new URL("../src/components/canvas/CanvasStage.tsx", import.meta.url), "utf8");
  assert.match(source, /function deleteCanvasNode\(id: string\)/);
  assert.match(source, /if \(currentImage\?\.id === id\) setField\("currentImage", null\)/);
  assert.match(source, /onDelete=\{\(\) => deleteCanvasNode\(node\.id\)\}/);
});

test("clear canvas removes all media nodes rather than only hiding currentImage", async () => {
  const source = await readFile(new URL("../src/components/canvas/CanvasStage.tsx", import.meta.url), "utf8");
  assert.match(source, /function clearCanvasBoard\(\)/);
  assert.match(source, /clearCanvas\(\)/);
  assert.match(source, /label: "清空画板"[\s\S]*onClick: clearCanvasBoard/);
});

test("canvas nodes can be added to an inactive workspace without changing active state", async () => {
  const source = await readFile(new URL("../src/components/panel/VideoGenerationPanel.tsx", import.meta.url), "utf8");
  assert.match(source, /addCanvasNodeToWorkspace\(workspaceId/);
  assert.match(source, /const workspaceId = useStudioStore\.getState\(\)\.activeWorkspaceId/);
});

test("workspace-targeted node insertion mirrors the active workspace immediately", async () => {
  const source = await readFile(new URL("../src/state/studioStore.ts", import.meta.url), "utf8");
  const action = source.slice(source.indexOf("addCanvasNodeToWorkspace:"), source.indexOf("moveCanvasNode:"));
  assert.match(action, /state\.activeWorkspaceId === workspaceId/);
  assert.match(action, /\{ canvasNodes, selectedNodeId: node\.id \}/);
});

test("canvas selection clears image editing state atomically", async () => {
  const source = await readFile(new URL("../src/state/studioStore.ts", import.meta.url), "utf8");
  assert.match(source, /maskDataURL: null, strokes: \[\], annotations: \[\]/);
});

test("selecting an image discards undo and redo history from the previous node", async () => {
  const source = await readFile(new URL("../src/state/studioStore.ts", import.meta.url), "utf8");
  const selection = source.slice(source.indexOf('if (key === "currentImage")'), source.indexOf('} else if (key === "batchCount")'));
  assert.match(selection, /undoStack: \[\]/);
  assert.match(selection, /redoStack: \[\]/);
});

test("selecting an image aligns canvas node selection atomically", async () => {
  const source = await readFile(new URL("../src/state/studioStore.ts", import.meta.url), "utf8");
  const selection = source.slice(source.indexOf('if (key === "currentImage")'), source.indexOf('} else if (key === "batchCount")'));
  assert.match(selection, /selectedNodeId: item\?\.id \?\? null/);
  assert.match(selection, /currentImageId:[\s\S]*selectedNodeId: item\?\.id \?\? null/);
});

test("selecting a batch image discards undo and redo history from the previous node", async () => {
  const source = await readFile(new URL("../src/state/studioStore.media.ts", import.meta.url), "utf8");
  const selection = source.slice(source.indexOf("async selectBatchResult"), source.indexOf("async stepBatchResult"));
  assert.match(selection, /undoStack: \[\]/);
  assert.match(selection, /redoStack: \[\]/);
});

test("selecting a batch image aligns canvas node selection atomically", async () => {
  const source = await readFile(new URL("../src/state/studioStore.media.ts", import.meta.url), "utf8");
  const selection = source.slice(source.indexOf("async selectBatchResult"), source.indexOf("async stepBatchResult"));
  assert.match(selection, /selectedNodeId: full\.id/);
  assert.match(selection, /currentImageId: full\.id,[\s\S]*selectedNodeId: full\.id/);
});

test("every workspace transition discards undo and redo history", async () => {
  const source = await readFile(new URL("../src/state/studioStore.workspaces.ts", import.meta.url), "utf8");
  const transitions = [
    source.slice(source.indexOf("newWorkspace("), source.indexOf("switchWorkspace(")),
    source.slice(source.indexOf("switchWorkspace("), source.indexOf("closeWorkspace(")),
    source.slice(source.indexOf("closeWorkspace("), source.indexOf("renameWorkspace(")),
  ];
  for (const transition of transitions) {
    assert.match(transition, /undoStack: \[\]/);
    assert.match(transition, /redoStack: \[\]/);
  }
});

test("canvas clear uses one store action", async () => {
  const stage = await readFile(new URL("../src/components/canvas/CanvasStage.tsx", import.meta.url), "utf8");
  const toolbar = await readFile(new URL("../src/components/canvas/Toolbar.tsx", import.meta.url), "utf8");
  const android = await readFile(new URL("../src/platform/android/canvas/AndroidCanvasWorkspace.tsx", import.meta.url), "utf8");
  const store = await readFile(new URL("../src/state/studioStore.ts", import.meta.url), "utf8");
  assert.match(stage, /clearCanvas\(\)/);
  assert.doesNotMatch(stage, /for \(const node of canvasNodes\) removeCanvasNode/);
  assert.match(toolbar, /onClearCanvas=\{clearCanvas\}/);
  assert.match(android, /runAction\(clearCanvas, 8\)/);
  const action = store.slice(store.indexOf("clearCanvas:"), store.indexOf("savePreset:"));
  assert.match(action, /compareB: null/);
  assert.match(action, /resultGridOpen: false/);
});

test("clearing the canvas discards undo and redo history", async () => {
  const source = await readFile(new URL("../src/state/studioStore.ts", import.meta.url), "utf8");
  const action = source.slice(source.indexOf("clearCanvas:"), source.indexOf("savePreset:"));
  assert.match(action, /undoStack: \[\]/);
  assert.match(action, /redoStack: \[\]/);
});

test("canvas context menu is available with video nodes and no current image", async () => {
  const source = await readFile(new URL("../src/components/canvas/CanvasStage.tsx", import.meta.url), "utf8");
  assert.match(source, /canvasMenu && canvasNodes\.length > 0/);
});

test("toolbar reset view always uses the latest node layout", async () => {
  const source = await readFile(new URL("../src/components/canvas/CanvasStage.tsx", import.meta.url), "utf8");
  assert.match(source, /const resetView = useCallback\([\s\S]*?\[canvasNodes, hostSize\.w, hostSize\.h, setCanvasViewport\]\);/);
  assert.match(source, /__canvasResetView = resetView;[\s\S]*?\}, \[resetView\]\);/);
});

test("image node refreshes when its source URL changes", async () => {
  const source = await readFile(new URL("../src/components/canvas/CanvasNodeShape.tsx", import.meta.url), "utf8");
  assert.match(source, /node\.src.*source/);
});

test("both upstream save handlers persist the video model", async () => {
  const modal = await readFile(new URL("../src/components/panel/UpstreamConfigModal.tsx", import.meta.url), "utf8");
  const android = await readFile(new URL("../src/platform/android/upstream/useAndroidUpstreamConfig.ts", import.meta.url), "utf8");
  assert.match(modal, /imageModelID: draft\.imageModelID,[\s\S]*videoModelID: draft\.videoModelID/);
  assert.match(android, /imageModelID: draft\.imageModelID,[\s\S]*videoModelID: draft\.videoModelID/);
});

test("result drawer selects and materializes its displayed item before upscaling", async () => {
  const source = await readFile(new URL("../src/components/panel/ResultDetailDrawer.tsx", import.meta.url), "utf8");
  assert.match(source, /await selectBatchResult\(detail\);\s*await upscaleCurrent\(scale as 2 \| 4\)/);
  assert.doesNotMatch(source, /setField\("currentImage", detail\); void upscaleCurrent/);
});
