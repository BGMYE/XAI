import assert from "node:assert/strict";
import test from "node:test";

const realWindow = globalThis.window;
const realLocalStorage = globalThis.localStorage;

function installStorage() {
  const store = new Map();
  globalThis.localStorage = {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
  };
  return store;
}

function installService(methods = {}) {
  globalThis.window = {
    go: {
      backend: {
        Service: methods,
      },
    },
  };
}

test.afterEach(() => {
  globalThis.window = realWindow;
  globalThis.localStorage = realLocalStorage;
});

function minimalExport(prompt) {
  return {
    history: [], profiles: [], activeProfileId: "", aiProfileId: "", proxyMode: "system", proxyURL: "",
    promptHistory: [prompt], promptTemplates: [], presets: [], customAspectRatios: [],
    theme: "light", fontScale: 1, outputFormat: "png", background: "auto", outputCompression: 100,
    inputFidelity: "auto", imageStyle: "default", moderation: "auto", userIdentifier: "", partialImages: 1,
    protectStreamPreview: true, autoRetryEnabled: true, autoRetryCount: 1, kernelRuntimeMode: "auto",
    keepLogs: false, cleanupPreviewCacheOnExit: false, ignoredReleaseTag: "",
    completionSound: { enabled: true, mode: "default", customName: "", customDataURL: "" }, completionNotification: { enabled: false },
  };
}

test("close flush saves the pending compatibility document before its debounce fires", async () => {
  installStorage();
  let saved;
  installService({ SaveCompatibilityState: async (state) => { saved = state; } });
  const compat = await import(`../src/lib/compatState.ts?flush=${Math.random()}`);
  compat.scheduleCompatibilityExport(minimalExport("unsaved prompt"));
  await compat.flushCompatibilityExport();
  assert.deepEqual(saved.settings.promptHistory, ["unsaved prompt"]);
});

test("compatibility export preserves the supported 200 percent font size", async () => {
  installStorage();
  const { buildCompatibilityState } = await import("../src/lib/compatState.ts");
  assert.equal(buildCompatibilityState({ ...minimalExport(""), fontScale: 2 }).settings.fontScale, 2);
  assert.equal(buildCompatibilityState({ ...minimalExport(""), fontScale: 2.1 }).settings.fontScale, 1);
});

test("compatibility exports remain ordered when a write is slow", async () => {
  installStorage();
  const saved = [];
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  installService({ SaveCompatibilityState: async (state) => {
    const prompt = state.settings.promptHistory[0];
    saved.push(`start:${prompt}`);
    if (prompt === "first") await blocked;
    saved.push(`end:${prompt}`);
  } });
  const compat = await import(`../src/lib/compatState.ts?order=${Math.random()}`);
  const first = compat.exportCompatibilityStateNow(minimalExport("first"));
  await new Promise((resolve) => setImmediate(resolve));
  const second = compat.exportCompatibilityStateNow(minimalExport("second"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(saved, ["start:first"]);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(saved, ["start:first", "end:first", "start:second", "end:second"]);
});

test("failed compatibility writes remain available for a subsequent close retry", async () => {
  installStorage();
  let fail = true;
  let saved;
  installService({ SaveCompatibilityState: async (state) => {
    if (fail) throw new Error("disk unavailable");
    saved = state;
  } });
  const compat = await import(`../src/lib/compatState.ts?retry=${Math.random()}`);
  await assert.rejects(compat.exportCompatibilityStateNow(minimalExport("keep me")), /disk unavailable/);
  fail = false;
  await compat.flushCompatibilityExport();
  assert.deepEqual(saved.settings.promptHistory, ["keep me"]);
});

test("compat export preserves previewPath sourcePaths and parentId in history", async () => {
  installStorage();
  let savedState = null;
  installService({
    SaveCompatibilityState(state) {
      savedState = state;
    },
  });
  const compatState = await import(`../src/lib/compatState.ts?compat-export=${Date.now()}-${Math.random().toString(36).slice(2)}`);

  await compatState.exportCompatibilityStateNow({
    history: [{
      id: "hist-1",
      prompt: "edit cat",
      mode: "edit",
      size: "1024x1024",
      quality: "high",
      outputFormat: "png",
      createdAt: 123,
      savedPath: "/tmp/result.png",
      previewPath: "/tmp/previews/result.png",
      thumbPath: "/tmp/thumbs/result.png",
      parentId: "/tmp/source-a.png",
      sourcePaths: ["/tmp/source-a.png", "/tmp/source-b.png"],
      imageB64: "AAAA",
    }],
    profiles: [],
    activeProfileId: "",
    proxyMode: "system",
    proxyURL: "",
    theme: "system",
    fontScale: 1,
    outputFormat: "png",
    background: "auto",
    outputCompression: 100,
    inputFidelity: "auto",
    imageStyle: "default",
    moderation: "low",
    userIdentifier: "",
    partialImages: 1,
    protectStreamPreview: true,
    autoRetryEnabled: true,
    autoRetryCount: 5,
    promptTemplates: [],
    promptHistory: [],
    presets: [],
    customAspectRatios: [],
    kernelRuntimeMode: "remote",
    keepLogs: false,
    cleanupPreviewCacheOnExit: false,
    ignoredReleaseTag: "",
    completionSound: { enabled: true, mode: "default", customName: "", customDataURL: "" },
    completionNotification: { enabled: false },
  });

  assert.ok(savedState, "compat state should be exported");
  assert.equal(savedState.history[0].previewPath, "/tmp/previews/result.png");
  assert.equal(savedState.history[0].parentId, "/tmp/source-a.png");
  assert.deepEqual(savedState.history[0].sourcePaths, ["/tmp/source-a.png", "/tmp/source-b.png"]);
});

test("compat fingerprint changes when previewPath or sourcePaths change", async () => {
  installStorage();
  installService();
  const compatState = await import(`../src/lib/compatState.ts?compat-fingerprint=${Date.now()}-${Math.random().toString(36).slice(2)}`);

  const base = {
    history: [{
      id: "hist-1",
      prompt: "edit cat",
      mode: "edit",
      size: "1024x1024",
      quality: "high",
      outputFormat: "png",
      createdAt: 123,
      savedPath: "/tmp/result.png",
      previewPath: "/tmp/previews/result-a.png",
      sourcePaths: ["/tmp/source-a.png"],
    }],
    profiles: [],
    activeProfileId: "",
    proxyMode: "system",
    proxyURL: "",
    theme: "system",
    fontScale: 1,
    outputFormat: "png",
    background: "auto",
    outputCompression: 100,
    inputFidelity: "auto",
    imageStyle: "default",
    moderation: "low",
    userIdentifier: "",
    partialImages: 1,
    protectStreamPreview: true,
    autoRetryEnabled: true,
    autoRetryCount: 5,
    promptTemplates: [],
    promptHistory: [],
    presets: [],
    customAspectRatios: [],
    kernelRuntimeMode: "remote",
    keepLogs: false,
    cleanupPreviewCacheOnExit: false,
    ignoredReleaseTag: "",
    completionSound: { enabled: true, mode: "default", customName: "", customDataURL: "" },
    completionNotification: { enabled: false },
  };

  const fingerprintA = compatState.compatibilityExportFingerprint(base);
  const fingerprintB = compatState.compatibilityExportFingerprint({
    ...base,
    history: [{ ...base.history[0], previewPath: "/tmp/previews/result-b.png" }],
  });
  const fingerprintC = compatState.compatibilityExportFingerprint({
    ...base,
    history: [{ ...base.history[0], sourcePaths: ["/tmp/source-a.png", "/tmp/source-b.png"] }],
  });

  assert.notEqual(fingerprintA, fingerprintB);
  assert.notEqual(fingerprintA, fingerprintC);
});
