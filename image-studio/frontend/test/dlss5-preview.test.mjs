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
import { defaultDLSS5Options } from "../src/studio/DLSS5Options.mjs";

// Render the actual component with React, keeping deferred native calls under
// test control. No browser, video decoder, native engine or network is needed.
const require = createRequire(import.meta.url);
const directory = await mkdtemp(join(tmpdir(), "dlss5-preview-"));
after(() => rm(directory, { recursive: true, force: true }));
const componentPath = fileURLToPath(new URL("../src/studio/DLSS5Preview.tsx", import.meta.url));
const output = join(directory, "component.mjs");
await build({
  entryPoints: [componentPath], outfile: output, bundle: true, platform: "node", format: "esm", logLevel: "silent",
  plugins: [{ name: "test-host", setup(builder) {
    builder.onResolve({ filter: /^react(?:\/.*)?$/ }, (args) => ({ path: pathToFileURL(require.resolve(args.path)).href, external: true }));
    builder.onResolve({ filter: /^\.\/client$/ }, (args) => args.importer === componentPath ? { path: "client", namespace: "test-host" } : null);
    builder.onResolve({ filter: /^lucide-react$/ }, () => ({ path: "icons", namespace: "test-host" }));
    builder.onLoad({ filter: /.*/, namespace: "test-host" }, (args) => ({ contents: args.path === "icons"
      ? "export const Download = () => null, Loader2 = () => null, Play = () => null, Square = () => null;"
      : "export const client = new Proxy({}, {get: (_, key) => globalThis.__dlss5PreviewTest.client[key]}); export const isDesktop = () => globalThis.__dlss5PreviewTest.desktop; export const mediaURL = id => '/studio-assets/' + id;",
    }));
  } }],
});
const { DLSS5Preview } = await import(pathToFileURL(output).href);

function remove(parent, child) {
  const index = parent.children.indexOf(child);
  if (index !== -1) parent.children.splice(index, 1);
}
function append(parent, child) { remove(parent, child); parent.children.push(child); }
function insert(parent, child, before) { remove(parent, child); parent.children.splice(parent.children.indexOf(before), 0, child); }
const hostContext = {};
const renderer = Reconciler({
  supportsMutation: true, isPrimaryRenderer: true,
  getRootHostContext: () => hostContext, getChildHostContext: () => hostContext, getPublicInstance: (instance) => instance,
  prepareForCommit: () => null, resetAfterCommit() {},
  createInstance: (type, props) => ({ type, props, children: [], currentTime: 0, duration: 10, pause() {} }),
  appendInitialChild: append, finalizeInitialChildren: () => false,
  shouldSetTextContent: () => false, createTextInstance: (value) => ({ text: String(value) }),
  appendChild: append, appendChildToContainer: append, removeChild: remove, removeChildFromContainer: remove,
  insertBefore: insert, insertInContainerBefore: insert, clearContainer: (container) => { container.children.length = 0; },
  prepareUpdate: (_instance, _type, _oldProps, newProps) => newProps,
  commitUpdate: (instance, newProps) => { instance.props = newProps; },
  commitTextUpdate: (instance, _previous, value) => { instance.text = String(value); }, resetTextContent() {},
  scheduleTimeout: setTimeout, cancelTimeout: clearTimeout, noTimeout: -1, getCurrentEventPriority: () => DefaultEventPriority, detachDeletedInstance() {},
});
const { act } = React;
const text = (node) => node.text ?? (node.children ?? []).map(text).join("");
function all(node, predicate) {
  return [...(predicate(node) ? [node] : []), ...(node.children ?? []).flatMap((child) => all(child, predicate))];
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
function videoSource(suffix = "1") {
  return {
    job: { id: `job-${suffix}`, state: "succeeded", request: { kind: "video", prompt: `Video ${suffix}` }, resultAssetId: `video-${suffix}` },
    asset: { id: `video-${suffix}`, kind: "video", name: `Original ${suffix}`, width: 1920, height: 1080 },
  };
}

async function harness(t, overrides = {}) {
  const original = { host: globalThis.__dlss5PreviewTest, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const backend = {
    previews: [], cancellations: [], applies: [], paid: [], errors: [], probes: 0, refreshes: 0,
    probe: { available: true, supportsFlow: ["off", "raft", "nvofa"] },
  };
  globalThis.__dlss5PreviewTest = {
    desktop: true,
    client: {
      async probeDLSS5() { backend.probes++; return backend.probe; },
      previewDLSS5(request) {
        const held = deferred();
        backend.previews.push({ request: structuredClone(request), held });
        return held.promise;
      },
      async cancelDLSS5Preview(id) { backend.cancellations.push(id); },
      async applyDLSS5(id, options) { backend.applies.push({ id, options }); },
      async submit(request) { backend.paid.push(request); throw Error("Paid generation must not be called"); },
      async run(...args) { backend.paid.push(args); throw Error("Paid workflow must not be called"); },
    },
  };
  const source = videoSource();
  let props = {
    options: { ...defaultDLSS5Options(), enabled: true }, jobs: [source.job], assets: [source.asset], probe: backend.probe,
    onRefresh: async () => { backend.refreshes++; }, report: (error) => backend.errors.push(error),
    ...overrides,
  };
  const container = { children: [] };
  const root = renderer.createContainer(container, LegacyRoot, null, false, null, "", (error) => { throw error; }, null);
  const render = () => renderer.updateContainer(React.createElement(DLSS5Preview, props), root, null, null);
  t.after(async () => {
    await act(async () => renderer.updateContainer(null, root, null, null));
    globalThis.__dlss5PreviewTest = original.host;
    globalThis.IS_REACT_ACT_ENVIRONMENT = original.act;
  });
  await act(async () => { render(); });
  const button = (label) => {
    const found = all(container, (node) => node.type === "button" && text(node) === label);
    assert.equal(found.length, 1, `expected one button named ${label}`);
    return found[0];
  };
  return {
    backend, container, button,
    get options() { return props.options; },
    get video() { return all(container, (node) => node.type === "video")[0]; },
    get status() { return text(all(container, (node) => node.props?.role === "status")[0]); },
    async click(label, { disabled = false } = {}) {
      const target = button(label);
      assert.equal(Boolean(target.props.disabled), disabled);
      // Also exercise handler guards when a disabled control is invoked.
      await act(async () => { target.props.onClick(); });
    },
    async update(next) { props = { ...props, ...next }; await act(async () => { render(); }); },
    async browser() { globalThis.__dlss5PreviewTest.desktop = false; await act(async () => { render(); }); },
    async autoPreview(enabled) {
      const toggle = all(container, node => node.type === "input" && node.props["aria-label"] === "自动更新短片预览")[0];
      assert(toggle);
      await act(async () => { toggle.props.onChange({ target: { checked: enabled } }); });
    },
    async unmount() { await act(async () => renderer.updateContainer(null, root, null, null)); },
    async complete(index = 0) {
      const { request, held } = backend.previews[index];
      const result = { id: request.id, url: `/studio-dlss5-preview/${request.id}/enhanced.mp4`, sourceUrl: `/studio-dlss5-preview/${request.id}/source.mp4`, width: 1920, height: 1080 };
      await act(async () => { held.resolve(result); });
      return result;
    },
  };
}

test("changing options cancels a preview and a late success cannot overwrite a newer request", async (t) => {
  const h = await harness(t);
  await h.click("生成短片预览");
  assert.equal(h.backend.previews.length, 1);
  const first = h.backend.previews[0].request;
  await h.update({ options: { ...h.options, intensity: 0.4 } });
  assert.deepEqual(h.backend.cancellations, [first.id]);
  assert.equal(h.video.props.src, "/studio-assets/video-1");
  await h.click("生成短片预览");
  assert.equal(h.backend.previews.length, 2);
  assert.notEqual(h.backend.previews[1].request.id, first.id);
  assert.equal(h.backend.previews[1].request.options.intensity, 0.4);
  await h.complete(0);
  assert.equal(h.video.props.src, "/studio-assets/video-1", "discard the old preview even while a new one is pending");
  assert.equal(h.button("生成短片预览").props.disabled, true);
  h.button("取消预览");
  const latest = await h.complete(1);
  assert.equal(h.video.props.src, latest.url);
  assert.equal(h.button("生成短片预览").props.disabled, false);
  assert.deepEqual(h.backend.paid, []);
});

test("changing the original video cancels processing and keeps a late result off the new source", async (t) => {
  const h = await harness(t);
  await h.click("生成短片预览");
  const other = videoSource("2");
  await h.update({ jobs: [other.job], assets: [other.asset] });
  assert.deepEqual(h.backend.cancellations, [h.backend.previews[0].request.id]);
  assert.equal(h.video.props.src, "/studio-assets/video-2");
  await h.complete();
  assert.equal(h.video.props.src, "/studio-assets/video-2");
  assert.equal(all(h.container, (node) => node.props?.role === "group").length, 0);
  await h.click("生成短片预览");
  assert.equal(h.backend.previews[1].request.sourceAssetId, "video-2");
  await h.complete(1);
});

test("cancel button requests native cancellation and ignores a late successful result", async (t) => {
  const h = await harness(t);
  await h.click("生成短片预览");
  await h.click("取消预览");
  assert.deepEqual(h.backend.cancellations, [h.backend.previews[0].request.id]);
  assert.match(h.status, /已取消预览/);
  await h.complete();
  assert.match(h.status, /已取消预览/);
  assert.equal(h.video.props.src, "/studio-assets/video-1");
  assert.equal(h.button("生成短片预览").props.disabled, false);
  assert.equal(h.backend.applies.length, 0);
});

test("export applies an independent copy of current options to the existing job without paid generation", async (t) => {
  const h = await harness(t);
  const originalOptions = h.options;
  await h.click("应用当前参数并导出完整视频");
  assert.equal(h.backend.probes, 0, "reuse the explicit engine detection rather than run an expensive probe for every action");
  assert.equal(h.backend.applies.length, 1);
  assert.equal(h.backend.applies[0].id, "job-1");
  assert.deepEqual(h.backend.applies[0].options, originalOptions);
  assert.notEqual(h.backend.applies[0].options, originalOptions);
  assert.notEqual(h.backend.applies[0].options.exportResolution, originalOptions.exportResolution);
  await h.update({ options: { ...originalOptions, outputMix: 0.2, exportResolution: { mode: "custom", width: 1280, height: 720 } } });
  assert.equal(h.backend.applies[0].options.outputMix, 1);
  assert.equal(h.backend.applies[0].options.exportResolution.mode, "source");
  assert.equal(h.backend.refreshes, 1);
  assert.deepEqual(h.backend.previews, []);
  assert.deepEqual(h.backend.paid, []);
  assert.deepEqual(h.backend.errors, []);
});

test("browser mode disables preview and export and their handlers cannot call the native client", async (t) => {
  const h = await harness(t);
  await h.browser();
  assert.match(h.status, /浏览器不能调用本地引擎/);
  await h.click("生成短片预览", { disabled: true });
  await h.click("应用当前参数并导出完整视频", { disabled: true });
  assert.equal(h.backend.probes, 0);
  assert.deepEqual(h.backend.previews, []);
  assert.deepEqual(h.backend.applies, []);
  assert.deepEqual(h.backend.paid, []);
});

test("an unavailable saved engine probe disables preview and export without making native requests", async (t) => {
  const h = await harness(t, { probe: { available: false, reason: "测试引擎不可用" } });
  assert.match(h.status, /请先完成本地引擎检测/);
  await h.click("生成短片预览", { disabled: true });
  await h.click("应用当前参数并导出完整视频", { disabled: true });
  assert.equal(h.backend.probes, 0);
  assert.deepEqual(h.backend.previews, []);
  assert.deepEqual(h.backend.applies, []);
  assert.deepEqual(h.backend.paid, []);
});

test("an invalid preview clip disables preview without preventing a full-video export", async (t) => {
  const h = await harness(t);
  const position = all(h.container, (node) => node.type === "input")[0];
  await act(async () => { position.props.onChange({ target: { valueAsNumber: NaN } }); });
  await h.click("生成短片预览", { disabled: true });
  assert.deepEqual(h.backend.previews, []);
  await h.click("应用当前参数并导出完整视频");
  assert.equal(h.backend.applies.length, 1);
  assert.equal(h.backend.applies[0].id, "job-1");
  assert.deepEqual(h.backend.paid, []);
});

test("changing options releases completed preview files and restores the original video", async (t) => {
  const h = await harness(t);
  await h.click("生成短片预览");
  const completed = await h.complete();
  assert.equal(h.video.props.src, completed.url);
  assert.deepEqual(h.backend.cancellations, []);
  await h.update({ options: { ...h.options, style: 1 } });
  assert.deepEqual(h.backend.cancellations, [completed.id]);
  assert.equal(h.video.props.src, "/studio-assets/video-1");
  assert.equal(h.button("生成短片预览").props.disabled, false);
});

test("starting a new preview and unmounting each release the completed preview files", async (t) => {
  const h = await harness(t);
  await h.click("生成短片预览");
  const first = await h.complete();
  await h.click("生成短片预览");
  assert.deepEqual(h.backend.cancellations, [first.id]);
  const second = await h.complete(1);
  assert.equal(h.video.props.src, second.url);
  await h.unmount();
  assert.deepEqual(h.backend.cancellations, [first.id, second.id]);
  assert.equal(h.backend.probes, 0);
});

test("an unconfirmed optical flow backend blocks native preview and export", async (t) => {
  const h = await harness(t, { options: { ...defaultDLSS5Options(), enabled: true, flowBackend: "raft" } });
  await h.update({ probe: { available: true, supportsFlow: ["off"] } });
  await h.click("生成短片预览");
  assert.match(h.status, /未确认支持 raft/);
  assert.deepEqual(h.backend.previews, []);
  await h.click("应用当前参数并导出完整视频");
  assert.match(h.status, /未确认支持 raft/);
  assert.deepEqual(h.backend.applies, []);
  assert.deepEqual(h.backend.paid, []);
});

test("automatic previews debounce edits and cancelling stops automatic work", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = await harness(t);
  await act(async () => { t.mock.timers.tick(2000); });
  assert.equal(h.backend.previews.length, 0, "automatic work is off by default");
  await h.autoPreview(true);
  await act(async () => { t.mock.timers.tick(800); });
  await h.update({ options: { ...h.options, intensity: 0.6 } });
  await act(async () => { t.mock.timers.tick(800); });
  await h.update({ options: { ...h.options, intensity: 0.4 } });
  await act(async () => { t.mock.timers.tick(999); });
  assert.equal(h.backend.previews.length, 0);
  await act(async () => { t.mock.timers.tick(1); });
  assert.equal(h.backend.previews.length, 1);
  assert.equal(h.backend.previews[0].request.options.intensity, 0.4);
  await h.click("取消预览");
  await h.update({ options: { ...h.options, intensity: 0.3 } });
  await act(async () => { t.mock.timers.tick(2000); });
  assert.equal(h.backend.previews.length, 1, "cancel also turns off auto preview");
  assert.deepEqual(h.backend.paid, []);
  await h.complete();
});
