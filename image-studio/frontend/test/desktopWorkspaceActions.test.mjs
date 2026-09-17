import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import { createStore } from "zustand/vanilla";

const calls = { cancelled: [], eventsOff: [] };
globalThis.__workspaceActionTest = calls;
const loader = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes("/src/state/")) {
      if (specifier.endsWith("/runtime/host")) return { url: "workspace-test:host", shortCircuit: true };
      if (specifier.endsWith("/lib/images")) return { url: "workspace-test:images", shortCircuit: true };
      if (specifier.endsWith("/lib/storage")) return { url: "workspace-test:storage", shortCircuit: true };
      if (specifier.endsWith("/lib/security")) return { url: "workspace-test:security", shortCircuit: true };
      if (specifier.startsWith(".") && !specifier.endsWith(".ts")) {
        const candidate = new URL(`${specifier}.ts`, context.parentURL);
        if (existsSync(candidate)) return { url: candidate.href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    const source = {
      "workspace-test:host": "export const Cancel = (id) => globalThis.__workspaceActionTest.cancelled.push(id); export const EventsOff = (...events) => globalThis.__workspaceActionTest.eventsOff.push(events); export const ImportImageFromB64 = () => {}, RegisterMediaAsset = () => {}, RegisterImportedImageAsset = () => {}, ReadImageAsBase64 = () => {};",
      "workspace-test:images": "export const base64ToBlob = () => {};",
      "workspace-test:storage": "export const loadHistoryFullImage = () => {}, persistHistoryItem = () => {};",
      "workspace-test:security": "export const suggestedImportNameForHistory = () => {};",
    }[url];
    return source ? { format: "module", source, shortCircuit: true } : nextLoad(url, context);
  },
});
const { createWorkspaceActions } = await import("../src/state/studioStore.workspaces.ts");
const { createDesktopWorkspaceSnapshot, readDesktopWorkspaceSnapshot } = await import("../src/state/desktopWorkspaceSnapshot.ts");
loader.deregister();

function createWorkspaceStore() {
  const store = createStore(() => ({
    workspaces: [], activeWorkspaceId: "", history: [], runningJobMeta: {},
    outputFormat: "png", background: "auto", outputCompression: 100, inputFidelity: "high",
    imageStyle: "vivid", moderation: "auto", userIdentifier: "", partialImages: 1,
    pushToast() {},
  }));
  store.setState(createWorkspaceActions(store));
  store.getState().newWorkspace("First");
  return store;
}

test("switching workspaces preserves each canvas painting, undo stack and running request", () => {
  const store = createWorkspaceStore();
  const firstID = store.getState().activeWorkspaceId;
  const undo = { label: "paint", undo: () => ({ strokes: [] }), redo: () => ({}) };
  const strokes = [{ points: [1, 2, 3, 4], size: 16 }];
  const node = { id: "source-preview:reference.png", type: "image", src: "/media/reference", x: 60, y: -10, width: 240, height: 200, createdAt: 1 };
  const request = { apiKey: "MEMORY_ONLY_CREDENTIAL", prompt: "started request" };
  store.setState({
    prompt: "First painting", currentImage: { id: node.id }, canvasNodes: [node], selectedNodeId: node.id,
    strokes, annotations: [{ id: "one", kind: "rect", x: 1, y: 2, color: "red" }], maskDataURL: "data:image/png;base64,cG5n",
    undoStack: [undo], runningJobs: ["job-a"], jobsTotal: 1, isRunning: true, lastPayload: request, errorRawPath: "/log-a",
  });
  store.getState().newWorkspace("Second");
  const secondID = store.getState().activeWorkspaceId;
  assert.deepEqual(store.getState().strokes, []);
  store.setState({ prompt: "Second painting", annotations: [{ id: "two", kind: "text", x: 3, y: 4, color: "blue" }] });
  store.getState().switchWorkspace(firstID);
  const restored = store.getState();
  assert.equal(restored.prompt, "First painting");
  assert.equal(restored.currentImage.id, node.id);
  assert.equal(restored.currentImage.savedPath, "reference.png");
  assert.equal(restored.strokes, strokes);
  assert.equal(restored.undoStack[0], undo);
  assert.equal(restored.annotations[0].id, "one");
  assert.equal(restored.maskDataURL, "data:image/png;base64,cG5n");
  assert.deepEqual(restored.runningJobs, ["job-a"]);
  assert.equal(restored.lastPayload, request);
  assert.equal(restored.errorRawPath, "/log-a");
  store.getState().switchWorkspace(secondID);
  assert.equal(store.getState().annotations[0].id, "two");
  assert.deepEqual(store.getState().undoStack, []);
  assert.equal(store.getState().isRunning, false);

  const snapshot = createDesktopWorkspaceSnapshot(store.getState());
  const durable = readDesktopWorkspaceSnapshot(structuredClone(snapshot));
  assert.equal(durable.workspaceEdits[firstID].annotations[0].id, "one");
  assert.deepEqual(durable.workspaceEdits[firstID].strokes, [{ ...strokes[0], erase: undefined }]);
  assert.equal(durable.workspaceEdits[secondID].annotations[0].id, "two");
  assert.equal(JSON.stringify(durable).includes("MEMORY_ONLY_CREDENTIAL"), false);
  assert.equal(durable.workspaces[0].editorState, undefined);
});

test("closing the active workspace cancels current jobs and restores the other painting", () => {
  calls.cancelled.length = 0;
  const store = createWorkspaceStore();
  const firstID = store.getState().activeWorkspaceId;
  store.setState({ strokes: [{ points: [1, 2], size: 8 }] });
  store.getState().newWorkspace("Second");
  const secondID = store.getState().activeWorkspaceId;
  // Active mirror can be newer than its saved workspace record.
  store.setState({ runningJobs: ["new-job"], runningJobMeta: { "new-job": { workspaceId: secondID, apiMode: "images" } } });
  store.getState().closeWorkspace(secondID);
  assert.deepEqual(calls.cancelled, ["new-job"]);
  assert.equal(store.getState().activeWorkspaceId, firstID);
  assert.deepEqual(store.getState().strokes, [{ points: [1, 2], size: 8 }]);
  assert.deepEqual(store.getState().runningJobMeta, {});
});
