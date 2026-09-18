import assert from "node:assert/strict";
import test from "node:test";
import { canvasSnapshot, safeCanvasSource, validateCanvasDocument, visibleCanvasNodes } from "../src/lib/canvasDocument.ts";
const node = { id: "image-1", type: "image", src: "/media/full/abc", x: -200, y: 80, width: 400, height: 300, createdAt: 123 };
function state() { return { apiKey: "DO_NOT_PERSIST", workspaces: [{ id: "ws-1", name: "镜头 1", prompt: "old", sources: [{ apiKey: "SECRET" }], lastPayload: { apiKey: "SECRET" }, canvasNodes: [node] }], activeWorkspaceId: "ws-1", canvasNodes: [node], canvasViewport: { x: 10, y: 20, scale: .5 }, selectedNodeId: node.id, prompt: "new", history: [{ id: node.id, savedPath: "/images/a.png" }] }; }
test("canvas snapshot whitelists layout fields, not keys or request payloads", () => {
 const doc = canvasSnapshot(state(), 2, ["task-1"]); validateCanvasDocument(doc);
 assert.equal(doc.workspaces[0].prompt, "new"); assert.equal(doc.workspaces[0].nodes[0].savedPath, "/images/a.png"); assert.equal(doc.workspaces[0].nodes[0].x, -200);
 assert.deepEqual(doc.appliedVideoTaskIds, ["task-1"]); assert.doesNotMatch(JSON.stringify(doc), /SECRET|DO_NOT_PERSIST|lastPayload|apiKey/);
});
test("deleted result receipts survive snapshots without recreating a node", () => {
 const s = state(); s.canvasNodes = []; const doc = canvasSnapshot(s, 3, ["finished-video"]);
 assert.deepEqual(doc.appliedVideoTaskIds, ["finished-video"]); assert.deepEqual(doc.workspaces[0].nodes, []); assert.equal(doc.workspaces[0].selectedNodeId, ""); validateCanvasDocument(doc);
});
test("durable sources omit blob, base64, signed links and URL credentials", () => {
 for (const url of ["blob:temporary", "data:video/mp4;base64,AAA", "https://key:secret@host.test/video", "https://host.test/video?token=secret", "javascript:alert(1)", "/media/../secret"]) assert.equal(safeCanvasSource(url), undefined);
 assert.equal(safeCanvasSource("/media/full/abc"), "/media/full/abc"); assert.equal(safeCanvasSource("https://host.test/video.mp4"), "https://host.test/video.mp4");
});
test("document rejects NaN, unknown schemas and broken selections", () => {
 const doc = canvasSnapshot(state(), 0, []); doc.workspaces[0].nodes[0].x = NaN; assert.throws(() => validateCanvasDocument(doc)); assert.throws(() => validateCanvasDocument({ ...doc, version: 2 }));
 const good = canvasSnapshot(state(), 0, []); good.workspaces[0].selectedNodeId = "missing"; assert.throws(() => validateCanvasDocument(good));
});
test("viewport culling keeps visible and selected offscreen nodes, not all videos", () => {
 const far = { ...node, id: "video-far", type: "video", x: 10000 }; const selected = { ...far, id: "selected" };
 assert.deepEqual(visibleCanvasNodes([node, far, selected], { x: 0, y: 0, scale: 1 }, 800, 600, "selected").map((n) => n.id), ["image-1", "selected"]);
});
