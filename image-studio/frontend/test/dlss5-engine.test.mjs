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

// Render the actual component with React, keeping deferred native calls under
// test control. No browser, video decoder, native engine or network is needed.
const require = createRequire(import.meta.url);
const directory = await mkdtemp(join(tmpdir(), "dlss5-engine-"));
after(() => rm(directory, { recursive: true, force: true }));
const componentPath = fileURLToPath(new URL("../src/studio/DLSS5EngineSettings.tsx", import.meta.url));
const output = join(directory, "component.mjs");
await build({
  entryPoints: [componentPath], outfile: output, bundle: true, platform: "node", format: "esm", logLevel: "silent",
  plugins: [{ name: "test-host", setup(builder) {
    builder.onResolve({ filter: /^react(?:\/.*)?$/ }, (args) => ({ path: pathToFileURL(require.resolve(args.path)).href, external: true }));
    builder.onResolve({ filter: /^\.\/client$/ }, (args) => args.importer === componentPath ? { path: "client", namespace: "test-host" } : null);
    builder.onResolve({ filter: /^lucide-react$/ }, () => ({ path: "icons", namespace: "test-host" }));
    builder.onLoad({ filter: /.*/, namespace: "test-host" }, (args) => ({ contents: args.path === "icons"
      ? "export const Loader2 = () => null, RefreshCw = () => null;"
      : "export const client = new Proxy({}, {get: (_, key) => globalThis.__dlss5EngineTest.client[key]}); export const isDesktop = () => globalThis.__dlss5EngineTest.desktop; export const mediaURL = id => '/studio-assets/' + id;",
    }));
  } }],
});
const { DLSS5EngineSettings } = await import(pathToFileURL(output).href);

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
async function harness(t, desktop = true) {
  const original = { host: globalThis.__dlss5EngineTest, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const calls = [], published = [];
  globalThis.__dlss5EngineTest = { desktop, client: { probeDLSS5() { const held = deferred(); calls.push(held); return held.promise; } } };
  const container = { children: [] };
  const root = renderer.createContainer(container, LegacyRoot, null, false, null, "", (error) => { throw error; }, null);
  const render = () => renderer.updateContainer(React.createElement(DLSS5EngineSettings, { onProbe: value => published.push(value) }), root, null, null);
  t.after(async () => {
    await act(async () => renderer.updateContainer(null, root, null, null));
    globalThis.__dlss5EngineTest = original.host;
    globalThis.IS_REACT_ACT_ENVIRONMENT = original.act;
  });
  await act(async () => { render(); });
  return {
    calls, published, container,
    get text() { return text(container); },
    get button() { return all(container, node => node.type === "button")[0]; },
    async click() { await act(async () => all(container, node => node.type === "button")[0].props.onClick()); },
    async complete(value, index = calls.length - 1) { await act(async () => { calls[index].resolve(value); }); },
    async unmount() { await act(async () => renderer.updateContainer(null, root, null, null)); },
    async rerender() { await act(async () => render()); },
  };
}

test("desktop automatically probes once, blocks duplicate detection, and exposes GPU and packaged versions", async t => {
  const h = await harness(t);
  assert.equal(h.calls.length, 1);
  assert.equal(h.button.props.disabled, true);
  await h.click(); await h.rerender();
  assert.equal(h.calls.length, 1, "rerenders and disabled clicks must not reinitialize the GPU");
  await h.complete({ available: true, status: "ready", bundleVersion: "xai-2", engineVersion: "nr-1", gpu: "Test GPU", supportsFlow: ["off"] });
  assert.match(h.text, /内置引擎已就绪/);
  assert.match(h.text, /Test GPU/);
  assert.match(h.text, /xai-2 · nr-1/);
  assert.equal(h.published.at(-1).available, true);
  assert.equal(h.button.props.disabled, false);
  await h.click();
  assert.equal(h.calls.length, 2);
  assert.equal(h.published.at(-1).available, false, "rechecking immediately disables work until ready");
});

test("missing bundle explains a complete XAI install without paths, dependency setup or fictitious downloads", async t => {
  const h = await harness(t);
  await h.complete({ available: false, status: "missing_runtime", reason: "Package files are missing" });
  assert.match(h.text, /重新安装或完整解压配套的 XAI Windows 版本/);
  assert.match(h.text, /Package files are missing/);
  assert.doesNotMatch(h.text, /Python|DLSS5Tool|DLL|保存配置|选择.*路径|下载/);
  assert.equal(all(h.container, node => node.type === "input" || node.type === "select").length, 0);
  assert.deepEqual(all(h.container, node => node.type === "button").map(text), ["重新检测"]);
  assert.equal(h.published.at(-1).available, false);
});

test("incompatible engine and unsupported platform have distinct user-facing recovery explanations", async t => {
  const h = await harness(t);
  await h.complete({ available: false, status: "incompatible_runtime" });
  assert.match(h.text, /增强组件与当前设备不兼容/);
  assert.match(h.text, /配套的完整安装包/);
  await h.click();
  await h.complete({ available: false, status: "unsupported_platform" });
  assert.match(h.text, /当前设备暂不支持视频增强/);
  assert.match(h.text, /其他创作功能仍可正常使用/);
});

test("unmount discards a late detection response", async t => {
  const h = await harness(t);
  await h.unmount();
  const count = h.published.length;
  await h.complete({ available: true, status: "ready" });
  assert.equal(h.published.length, count);
});

test("browser shows desktop-only execution and never calls native detection", async t => {
  const h = await harness(t, false);
  assert.equal(h.calls.length, 0);
  assert.match(h.text, /XAI 桌面应用/);
  assert.equal(h.button.props.disabled, true);
  await h.click();
  assert.equal(h.calls.length, 0);
  assert.equal(h.published.at(-1).available, false);
});
