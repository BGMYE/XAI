import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import React from "react";
import Reconciler from "react-reconciler";
import { DefaultEventPriority, LegacyRoot } from "react-reconciler/constants.js";

// Real hook + React renderer; only the host boundary is replaced. This needs
// no browser binary, IndexedDB, credentials or network.
const require = createRequire(import.meta.url);
const directory = await mkdtemp(join(tmpdir(), "studio-autosave-"));
after(() => rm(directory, { recursive: true, force: true }));
const hookPath = fileURLToPath(new URL("../src/studio/useStudio.ts", import.meta.url));
const output = join(directory, "hook.mjs");
await build({
  entryPoints: [hookPath], outfile: output, bundle: true, platform: "node", format: "esm", logLevel: "silent",
  plugins: [{ name: "test-host", setup(builder) {
    builder.onResolve({ filter: /^react$/ }, () => ({ path: pathToFileURL(require.resolve("react")).href, external: true }));
    builder.onResolve({ filter: /^\.\/client$/ }, (args) => args.importer === hookPath ? { path: "client", namespace: "test-host" } : null);
    builder.onLoad({ filter: /.*/, namespace: "test-host" }, () => ({ contents: "export const client = new Proxy({}, {get: (_, key) => globalThis.__studioTestClient[key]});" }));
  } }],
});
const { useStudio } = await import(pathToFileURL(output).href);
const renderer = Reconciler({
  supportsMutation: true, isPrimaryRenderer: true,
  getRootHostContext: () => ({}), getChildHostContext: () => ({}), getPublicInstance: (instance) => instance,
  prepareForCommit: () => null, resetAfterCommit() {}, createInstance: () => ({}), appendInitialChild() {}, finalizeInitialChildren: () => false,
  shouldSetTextContent: () => false, createTextInstance: () => ({}), appendChild() {}, appendChildToContainer() {}, removeChild() {}, removeChildFromContainer() {},
  insertBefore() {}, insertInContainerBefore() {}, clearContainer() {}, prepareUpdate: () => null, commitUpdate() {}, commitTextUpdate() {}, resetTextContent() {},
  scheduleTimeout: setTimeout, cancelTimeout: clearTimeout, noTimeout: -1, getCurrentEventPriority: () => DefaultEventPriority, detachDeletedInstance() {},
});
const { act } = React;
const project = () => ({ id: "canvas", name: "Original", revision: 1, updatedAt: "1", viewport: { x: 0, y: 0, zoom: 1 }, nodes: [], edges: [] });
const resultNode = () => ({ id: "result", kind: "asset", title: "Generated result", assetId: "asset", x: 10, y: 20, parameters: {} });

async function harness(t) {
  const original = { window: globalThis.window, document: globalThis.document, client: globalThis.__studioTestClient, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  globalThis.window = { setInterval: () => 0, addEventListener() {}, removeEventListener() {} };
  globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const backend = { project: project(), hold: undefined, release: undefined, writes: [], snapshots: 0, changes: 0 };
  let latest;
  const snapshot = () => ({ epoch: "test", revision: backend.project.revision, profiles: [], projects: [structuredClone(backend.project)], assets: [], jobs: [], promptCards: [] });
  globalThis.__studioTestClient = {
    async snapshot() { backend.snapshots++; return snapshot(); },
    async changes(_epoch, since) {
      backend.changes++;
      return { epoch: "test", revision: backend.project.revision, full: false, profiles: [], projects: backend.project.revision > since ? [structuredClone(backend.project)] : [], assets: [], jobs: [], promptCards: [], removed: { profiles: [], promptCards: [] }, progress: {} };
    },
    subscribe: () => () => undefined,
    async saveProject(value) {
      backend.writes.push(structuredClone(value));
      const held = backend.hold;
      backend.hold = undefined;
      if (held === "failure") {
        await new Promise((resolve) => { backend.release = resolve; });
        backend.release = undefined;
        throw Error("simulated disk failure");
      }
      if (value.revision !== backend.project.revision) throw Error("revision conflict");
      const saved = { ...structuredClone(value), revision: value.revision + 1, updatedAt: String(value.revision + 1) };
      backend.project = structuredClone(saved);
      if (held) {
        await new Promise((resolve) => { backend.release = resolve; });
        backend.release = undefined;
      }
      return saved;
    },
  };
  function Harness() { latest = useStudio(); return null; }
  const root = renderer.createContainer({}, LegacyRoot, null, false, null, "", (error) => { throw error; }, null);
  await act(async () => { renderer.updateContainer(React.createElement(Harness), root, null, null); });
  assert.equal(latest.ready, true);
  t.after(async () => {
    await act(async () => renderer.updateContainer(null, root, null, null));
    t.mock.timers.reset();
    globalThis.window = original.window;
    globalThis.document = original.document;
    globalThis.__studioTestClient = original.client;
    globalThis.IS_REACT_ACT_ENVIRONMENT = original.act;
  });
  return {
    backend,
    get studio() { return latest; },
    async start(hold = "success") {
      let saving;
      await act(async () => {
        backend.hold = hold;
        latest.edit({ ...latest.getProject("canvas"), name: "Saved edit" });
        saving = latest.flush("canvas");
        void saving.catch(() => undefined);
      });
      assert.equal(typeof backend.release, "function");
      return { saving };
    },
    async remote(change) {
      backend.project = { ...change(structuredClone(backend.project)), revision: backend.project.revision + 1, updatedAt: String(backend.project.revision + 1) };
      await act(async () => { await latest.refresh(); });
    },
  };
}

test("pending save merges a consumed revision 3 generated node after revision 2 acknowledgement", async (t) => {
  const h = await harness(t);
  const { saving } = await h.start();
  await h.remote((p) => ({ ...p, nodes: [resultNode()] }));
  assert.equal(h.studio.snapshot.projects[0].revision, 3);
  assert.equal(h.studio.getProject("canvas").revision, 1);
  await act(async () => { h.backend.release(); await saving; });
  assert.equal(h.studio.getProject("canvas").revision, 3);
  assert.equal(h.studio.getProject("canvas").name, "Saved edit");
  assert.deepEqual(h.studio.getProject("canvas").nodes.map((node) => node.id), ["result"]);
  assert.equal(h.backend.writes.length, 1, "a clean reconciled project is not saved again");
  await act(async () => { await h.studio.refresh(); });
  assert.equal(h.backend.snapshots, 1, "recover the consumed revision from cache, not a reload");
  assert.equal(h.studio.getProject("canvas").nodes.length, 1);
});

test("edits during saving survive the remote result and save against its latest revision", async (t) => {
  const h = await harness(t);
  const { saving } = await h.start();
  await act(async () => h.studio.edit({ ...h.studio.getProject("canvas"), viewport: { x: 30, y: 40, zoom: 1 } }));
  await h.remote((p) => ({ ...p, nodes: [resultNode()] }));
  await act(async () => { h.backend.release(); await saving; });
  assert.deepEqual(h.backend.writes.map((value) => value.revision), [1, 3]);
  assert.equal(h.studio.getProject("canvas").revision, 4);
  assert.equal(h.backend.project.nodes[0].id, "result");
  assert.equal(h.backend.project.viewport.x, 30);
  assert.equal(h.backend.snapshots, 1, "no avoidable revision-conflict retry is required");
});

test("a conflicting consumed update rejects flush and retains the local draft until reload", async (t) => {
  const h = await harness(t);
  const { saving } = await h.start();
  await act(async () => h.studio.edit({ ...h.studio.getProject("canvas"), name: "Unsaved local name" }));
  await h.remote((p) => ({ ...p, name: "Remote name" }));
  await act(async () => { h.backend.release(); await assert.rejects(saving, /画布保存冲突/); });
  assert.equal(h.studio.conflicted, true);
  assert.equal(h.studio.getProject("canvas").name, "Unsaved local name");
  assert.equal(h.backend.project.name, "Remote name");
  assert.equal(h.backend.writes.length, 1);
  await act(async () => { await h.studio.reload("canvas"); });
  assert.equal(h.studio.conflicted, false);
  assert.equal(h.studio.getProject("canvas").name, "Remote name");
});

test("failed save reconciles skipped results without automatic retries and remains explicitly retryable", async (t) => {
  const h = await harness(t);
  const { saving } = await h.start("failure");
  await h.remote((p) => ({ ...p, nodes: [resultNode()] }));
  await act(async () => { h.backend.release(); await assert.rejects(saving, /simulated disk failure/); });
  assert.equal(h.studio.getProject("canvas").revision, 2);
  assert.equal(h.studio.getProject("canvas").name, "Saved edit");
  assert.equal(h.studio.getProject("canvas").nodes[0].id, "result");
  assert.equal(h.studio.saving, false);
  await act(async () => t.mock.timers.tick(1000));
  assert.equal(h.backend.writes.length, 1, "failure must not cause an autosave retry loop");
  await act(async () => { await h.studio.flush("canvas"); });
  assert.equal(h.backend.writes[1].revision, 2);
  assert.equal(h.backend.project.name, "Saved edit");
  assert.equal(h.backend.project.nodes[0].id, "result");
});

test("a late save acknowledgement cannot restore a remotely deleted draft", async (t) => {
  const h = await harness(t);
  const { saving } = await h.start();
  await h.remote((p) => ({ ...p, deletedAt: "2026-10-04T00:00:00Z" }));
  assert.equal(h.studio.getProject("canvas"), undefined);
  await act(async () => { h.backend.release(); await saving; });
  assert.equal(h.studio.getProject("canvas"), undefined);
  assert.equal(h.backend.writes.length, 1);
});
