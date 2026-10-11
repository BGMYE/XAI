import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as history from "../src/state/sharedHistory.ts";
import { buildHistoryCleanupPatch } from "../src/state/historyCleanup.ts";

function extract(file, predicate) {
  const source = ts.createSourceFile(
    file,
    readFileSync(new URL(`../src/state/${file}`, import.meta.url), "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  let found;
  function visit(node) {
    if (predicate(node, source)) found = node.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(found);
  return found;
}
function execute(code, deps) {
  const { outputText } = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  });
  return Function(...Object.keys(deps), outputText)(...Object.values(deps));
}
const start = extract(
  "studioStore.ts",
  (node) => ts.isFunctionDeclaration(node) && node.name?.text === "startSharedHistory",
);

for (const action of ["clearHistory", "pruneHistoryOlderThanDays"])
  test(`${action} covers shared history beyond the visible/cache limit and ignores stale cache IDs`, async () => {
    let backend = [
      { jobId: "recent", createdAt: new Date().toISOString() },
      ...Array.from({ length: 121 }, (_, i) => ({ jobId: `old-${i}`, createdAt: new Date(1).toISOString() })),
    ];
    const visible = history.mergeSharedHistory([], backend).slice(0, 120);
    const local = new Map(
      [...visible, { id: "gone", sharedJobId: "already-deleted", createdAt: 1 }].map((x) => [x.id, x]),
    );
    let state = {
      history: visible,
      workspaces: [],
      batchResults: [],
      savePromptQueue: [],
      loadMoreHistory: async () => {},
    };
    const store = {
      getState: () => state,
      setState: (patch) => {
        state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
      },
    };
    const method = extract(
      action === "clearHistory" ? "studioStore.images.ts" : "studioStore.media.ts",
      (node) => ts.isMethodDeclaration(node) && node.name.getText() === action,
    );
    const remove = execute(`return ({${method}}).${action};`, {
      store,
      withSharedHistoryLock: history.withSharedHistoryLock,
      waitForActiveHistoryLoad: async () => {},
      buildHistoryCleanupPatch,
      loadAllHistory: async () => [...local.values()],
      readSharedHistory: async (items) => history.mergeSharedHistory(items, backend),
      deleteSharedHistory: async (items) => {
        const ids = new Set(items.map((x) => x.sharedJobId).filter(Boolean));
        for (const id of ids)
          assert.ok(
            backend.some((x) => x.jobId === id),
            `stale ID ${id}`,
          );
        backend = backend.filter((x) => !ids.has(x.jobId));
      },
      clearHistoryStorage: async () => {
        const ids = [...local.keys()];
        local.clear();
        return ids;
      },
      removeHistoryItem: async (id) => {
        local.delete(id);
      },
      persistTrimmedHistory: () => {},
      trimHistory: (items) => items.slice(0, 120),
    });
    await remove(1);
    assert.deepEqual(
      backend.map((x) => x.jobId),
      action === "clearHistory" ? [] : ["recent"],
    );
    assert.deepEqual(
      state.history.map((x) => x.id),
      action === "clearHistory" ? [] : ["recent"],
    );
  });

for (const action of ["deleteHistoryItem", "clearHistory", "pruneHistoryOlderThanDays"])
  test(`${action} during legacy import removes the newly mapped shared job`, async () => {
    const item = { id: "legacy-local", createdAt: 1, savedPath: "old.png" };
    const local = new Map([[item.id, item]]);
    let backend = [],
      refresh,
      releaseImport,
      importing;
    const importStarted = new Promise((resolve) => {
      importing = resolve;
    });
    const gate = new Promise((resolve) => {
      releaseImport = resolve;
    });
    let state = {
      history: [item],
      workspaces: [],
      canvasNodes: [],
      batchResults: [],
      savePromptQueue: [],
      currentImage: null,
      loadMoreHistory: async () => {},
      pushToast: assert.fail,
    };
    const store = {
      getState: () => state,
      setState: (patch) => {
        state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
      },
    };
    const deps = {
      store,
      useStudioStore: store,
      withSharedHistoryLock: history.withSharedHistoryLock,
      loadAllHistory: async () => [...local.values()],
      importSharedHistory: async (items) => {
        importing();
        await gate;
        backend = [{ jobId: "legacy-job", assetId: "asset", createdAt: new Date(1).toISOString() }];
        return items.map((x) => ({ ...x, sharedJobId: "legacy-job" }));
      },
      readSharedHistory: async (items) => history.mergeSharedHistory(items, backend),
      deleteSharedHistory: async (items) => {
        const ids = new Set(items.map((x) => x.sharedJobId));
        backend = backend.filter((x) => !ids.has(x.jobId));
      },
      persistHistoryItems: async (items) => {
        for (const x of items) local.set(x.id, x);
      },
      removeHistoryItem: async (id) => {
        local.delete(id);
      },
      clearHistoryStorage: async () => {
        const ids = [...local.keys()];
        local.clear();
        return ids;
      },
      trimHistory: (items) => items,
      persistTrimmedHistory: () => {},
      EventsOn: (_name, fn) => {
        refresh = fn;
      },
      patchWorkspaceRuntime: (workspaces) => workspaces,
      waitForActiveHistoryLoad: async () => {},
      buildHistoryCleanupPatch,
    };
    const method = extract(
      action === "pruneHistoryOlderThanDays" ? "studioStore.media.ts" : "studioStore.images.ts",
      (node) => ts.isMethodDeclaration(node) && node.name.getText() === action,
    );
    const actions = execute(
      `let deferredHistoryLoadPromise = null;
    let sharedHistoryStarted = false, sharedHistorySync = null, sharedHistoryAgain = false;
    ${start}
    return { startSharedHistory, remove: ({ ${method} }).${action}, idle: () => sharedHistorySync };`,
      deps,
    );
    const init = actions.startSharedHistory();
    await importStarted;
    const removing = actions.remove(action === "deleteHistoryItem" ? item.id : 1);
    await new Promise((resolve) => setImmediate(resolve));
    releaseImport();
    await Promise.all([init, removing]);
    await actions.idle();
    refresh();
    await actions.idle();
    assert.deepEqual(state.history, []);
    assert.equal(local.size, 0);
    assert.deepEqual(backend, []);
  });

test("completion after shared sync replaces the recovered item and keeps generation metadata", () => {
  const statement = extract(
    "studioStore.ts",
    (node, source) =>
      ts.isVariableDeclaration(node) &&
      node.name.getText(source) === "trimmed" &&
      node.initializer?.getText(source).includes("historyItem"),
  );
  const item = { id: "same-job", sharedJobId: "same-job", sourcePaths: ["reference.png"], seed: "42" };
  const recovered = history.mergeSharedHistory([], [{ jobId: item.id, createdAt: new Date().toISOString() }]);
  const merged = execute(`const ${statement}; return trimmed;`, {
    historyItem: item,
    store: { getState: () => ({ history: recovered }) },
    trimHistory: (items) => items,
  });
  assert.equal(merged.length, 1);
  assert.equal(merged[0].seed, "42");
  const oppositeOrder = history.mergeSharedHistory(
    [item],
    [{ jobId: item.id, createdAt: new Date().toISOString() }],
  );
  assert.equal(oppositeOrder.length, 1);
  assert.deepEqual(oppositeOrder[0].sourcePaths, ["reference.png"]);
});

test("local upscale detaches shared identity and survives the next shared refresh", async () => {
  const original = {
    id: "original",
    sharedJobId: "shared-job",
    assetId: "shared-asset",
    savedPath: "original.png",
  };
  let state = {
    currentImage: original,
    history: [original],
    activeWorkspaceId: "w",
    workspaces: [{ id: "w", canvasNodes: [] }],
    canvasNodes: [],
    pushToast: () => {},
  };
  const store = {
    getState: () => state,
    setState: (patch) => {
      state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
    },
  };
  const method = extract(
    "studioStore.media.ts",
    (node) => ts.isMethodDeclaration(node) && node.name.getText() === "upscaleCurrent",
  );
  const upscale = execute(`return ({${method}}).upscaleCurrent;`, {
    store,
    materializeHistoryItem: async (item) => item,
    UpscaleImage: async () => ({
      path: "upscaled.png",
      width: 20,
      height: 20,
      mediaAssetRef: { imageId: "upscaled-image", fullUrl: "/upscaled" },
    }),
    withMediaAssetRef: (item, ref) => ({ ...item, ...ref }),
    genId: () => "upscaled",
    createCanvasNode: (x) => x,
    upsertCanvasNodeList: (items, item) => [...items, item],
    trimHistory: (x) => x,
    persistHistoryItems: async () => {},
    persistTrimmedHistory: () => {},
  });
  await upscale(2);
  const derived = state.history.find((x) => x.id === "upscaled");
  assert.ok(derived);
  assert.equal(derived.sharedJobId, undefined);
  assert.equal(derived.assetId, undefined);
  const synced = history.mergeSharedHistory(state.history, [
    { jobId: "shared-job", savedPath: "original.png", createdAt: new Date().toISOString() },
  ]);
  assert.equal(synced.length, 2);
  assert.equal(synced.find((x) => x.id === "upscaled").savedPath, "upscaled.png");
});
