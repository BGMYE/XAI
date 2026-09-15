import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import { createElement } from "react";
import Reconciler from "react-reconciler";
import { DefaultEventPriority } from "react-reconciler/constants.js";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import ts from "typescript";

const panelURL = new URL("../src/components/panel/SettingsPanel.tsx", import.meta.url).href;
const primitivesURL = new URL("../src/components/panel/settingsPrimitives.tsx", import.meta.url).href;
let settingsStore;
const unexpectedAction = () => assert.fail("category navigation must not call system or persistence actions");
const bridgeKey = "__xaiSettingsNavigationTest";
globalThis[bridgeKey] = {
  useStudioStore: Object.assign(() => useStore(settingsStore), { getState: () => settingsStore.getState() }),
  unexpectedAction,
};
const bridge = `globalThis.${bridgeKey}`;
const mocks = new Map(Object.entries({
  "../../state/studioStore": `export const useStudioStore = ${bridge}.useStudioStore;`,
  "../../platform/context": "export const usePlatform = () => ({ isMac: false, usesFluentUI: true, isAndroid: false, isAndroidPad: false });",
  "../../platform/runtime/host": `export const GetOutputDir = async () => "C:/test-output";
    export const OpenOutputDir = ${bridge}.unexpectedAction, OpenExternalURL = OpenOutputDir,
    ChooseOutputDir = OpenOutputDir, SetOutputDir = OpenOutputDir,
    GetStoredAPIKey = async () => "configured-key",
    probeCurrentUpstream = async () => ({ models: [], modelCount: 0 });`,
  "../common/Modal": 'import { createElement } from "react"; export const Modal = ({ open, children, bodyRef }) => open ? createElement("div", { role: "dialog", ref: bodyRef }, children) : null;',
  "../../lib/storage": `export const rememberTrustedOutputRoot = ${bridge}.unexpectedAction;`,
  "../../lib/profiles": "export const keyringUserFor = (id) => `profile:${id}`;",
  "../../lib/compatState": `export const scheduleCompatibilityExport = ${bridge}.unexpectedAction;`,
  "../../platform": 'export const platformOutputRootLabel = () => "C:/test-output";',
  "../../platform/android/bridge": `export const androidTarget = { isAndroid: false };
    export const openExternalURLForPlatform = ${bridge}.unexpectedAction, openOutputLocationForPlatform = openExternalURLForPlatform;`,
  "../../platform/android/settings/AndroidSettingsPanel": "export const AndroidSettingsPanel = () => null;",
  "./AboutImageStudioModal": "export const AboutImageStudioModal = () => null;",
  "../../lib/completionSound": `export const importCompletionSoundFile = ${bridge}.unexpectedAction;`,
  "../../../../../shared/kernel/requestModel.js": "export const MAX_AUTO_RETRY_COUNT = 10;",
  "../../styles/_xai-typography.css": "",
  "./settings-navigation.css": "",
}));
const loader = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.startsWith("settings-test:")) return nextResolve(specifier, { ...context, parentURL: import.meta.url });
    if (context.parentURL === panelURL || context.parentURL === primitivesURL) {
      if (specifier === "./settingsPrimitives") return { url: primitivesURL, shortCircuit: true };
      if (mocks.has(specifier)) return { url: `settings-test:${specifier}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith("settings-test:")) return { format: "module", source: mocks.get(url.slice(14)), shortCircuit: true };
    if (url !== panelURL && url !== primitivesURL) return nextLoad(url, context);
    const { outputText } = ts.transpileModule(readFileSync(new URL(url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    });
    return { format: "module", source: outputText, shortCircuit: true };
  },
});
const { SettingsPanel } = await import(panelURL);
loader.deregister();

// Mount the real React settings components without a browser or native host.
const appendChild = (parent, child) => parent.children.push(child);
const removeChild = (parent, child) => parent.children.splice(parent.children.indexOf(child), 1);
const hostContext = {};
const renderer = Reconciler({
  supportsMutation: true,
  isPrimaryRenderer: true,
  getRootHostContext: () => hostContext,
  getChildHostContext: () => hostContext,
  getPublicInstance: (node) => node,
  prepareForCommit: () => null,
  resetAfterCommit() {},
  createInstance: (type, props) => ({ type, props, children: [], scrollTop: 0 }),
  createTextInstance: (text) => ({ text, children: [] }),
  appendInitialChild: appendChild,
  appendChild,
  appendChildToContainer: appendChild,
  removeChild,
  removeChildFromContainer: removeChild,
  insertBefore: (parent, child, before) => parent.children.splice(parent.children.indexOf(before), 0, child),
  finalizeInitialChildren: () => false,
  shouldSetTextContent: () => false,
  prepareUpdate: (_node, _type, _oldProps, newProps) => newProps,
  commitUpdate: (node, props) => { node.props = props; },
  commitTextUpdate: (node, _oldText, text) => { node.text = text; },
  clearContainer: (node) => { node.children.length = 0; },
  detachDeletedInstance() {},
  getCurrentEventPriority: () => DefaultEventPriority,
  scheduleTimeout: setTimeout,
  cancelTimeout: clearTimeout,
  noTimeout: -1,
});
const categories = [
  ["runtime", "行旅 · 运行与网络"],
  ["files", "归处 · 输出与缓存"],
  ["alerts", "回响 · 通知与提示"],
  ["appearance", "光影 · 外观与字号"],
  ["data", "旧页 · 数据与重置"],
  ["about", "来处 · 关于与反馈"],
];
const descendants = (node) => [node, ...node.children.flatMap(descendants)];
const textContent = (node) => node.text ?? node.children.map(textContent).join("");

async function mountSettings() {
  const writes = [];
  settingsStore = createStore((set) => ({
    kernelRuntimeMode: "local", proxyMode: "none", proxyURL: "", autoRetryEnabled: true,
    autoRetryCount: 2, protectStreamPreview: true, theme: "light", fontScale: 1,
    history: [],
    profiles: [{ id: "profile:sunburst", name: "Sunburst", imageModelID: "gpt-image-2.5-sunburst", apiMode: "images", baseURL: "https://img.740414025.xyz" }],
    activeProfileId: "profile:sunburst", apiKey: "configured-key", baseURL: "https://img.740414025.xyz", apiMode: "images",
    completionSound: { enabled: true, mode: "default", customName: "", customDataURL: "" },
    completionNotification: { enabled: false }, completionNotificationPermission: "default",
    setTheme: (theme) => { writes.push(["theme", theme]); set({ theme }); },
    setFontScale: (fontScale) => { writes.push(["fontScale", fontScale]); set({ fontScale }); },
    setField: unexpectedAction, setAPIKey: unexpectedAction, setProxyConfig: unexpectedAction,
    updateProfile: async () => true,
    openUpstreamConfig: (target) => { writes.push(["upstream", target]); },
    testAPIKey: () => { writes.push(["test-key"]); }, isTestingKey: false,
    clearHistory: unexpectedAction, pushToast: unexpectedAction,
  }));
  const container = { children: [] };
  const root = renderer.createContainer(container, 0, null, false, null, "", (error) => { throw error; }, null);
  renderer.flushSync(() => renderer.updateContainer(createElement(SettingsPanel, { open: true, onClose: unexpectedAction }), root, null));
  renderer.flushPassiveEffects();
  await new Promise(setImmediate);
  return {
    container, writes,
    click(button) { assert.ok(button); renderer.flushSync(() => button.props.onClick()); },
    nav(title) { return descendants(container).find((node) => node.type === "button" && node.props.className?.includes("settings-anchor-item") && textContent(node) === title); },
    unmount() { renderer.flushSync(() => renderer.updateContainer(null, root, null)); renderer.flushPassiveEffects(); },
  };
}

function assertCategory(container, id, title) {
  const nodes = descendants(container);
  const visible = nodes.filter((node) => node.type === "section");
  assert.deepEqual(visible.map((node) => node.props.id), [`settings-${id}`]);
  assert.equal(textContent(descendants(visible[0]).find((node) => node.type === "h4")), title);
  const active = nodes.filter((node) => node.type === "button" && node.props["aria-pressed"] === true);
  assert.deepEqual(active.map(textContent), [title]);
}

test("each settings category opens with one click, including rapid reverse navigation", async () => {
  const view = await mountSettings();
  try {
    assertCategory(view.container, ...categories[0]);
    for (const [id, title] of [...categories.slice(1), ...categories.toReversed(), categories[0]]) {
      const content = descendants(view.container).find((node) => node.props?.className === "settings-category-content");
      assert.ok(content, "settings content must scroll independently from navigation");
      content.scrollTop = 700;
      view.click(view.nav(title));
      assertCategory(view.container, id, title);
      assert.equal(content.scrollTop, 0, "one click must open the category at its beginning");
    }
    assert.deepEqual(view.writes, [], "navigation must not change preferences");
  } finally { view.unmount(); }
});

test("settings edits remain selected after visiting other categories", async () => {
  const view = await mountSettings();
  try {
    view.click(view.nav(categories[3][1]));
    const button = (label) => descendants(view.container).find((node) => node.type === "button" && textContent(node).trim() === label);
    view.click(button("夜色 · 深色"));
    view.click(button("舒展"));
    for (const [, title] of categories) view.click(view.nav(title));
    view.click(view.nav(categories[3][1]));

    assertCategory(view.container, ...categories[3]);
    assert.equal(settingsStore.getState().theme, "dark");
    assert.equal(settingsStore.getState().fontScale, 1.15);
    assert.ok(button("夜色 · 深色").props.className.split(/\s+/).includes("active"));
    assert.ok(button("舒展").props.className.split(/\s+/).includes("active"));
    assert.deepEqual(view.writes, [["theme", "dark"], ["fontScale", 1.15]]);
  } finally { view.unmount(); }
});

test("desktop runtime settings opens upstream manager with one click", async () => {
  const view = await mountSettings();
  try {
    const trigger = descendants(view.container).find((node) =>
      node.type === "button" && textContent(node).trim() === "打理上游配置",
    );
    assert.ok(trigger, "desktop settings must expose the upstream manager");
    view.click(trigger);
    assert.deepEqual(view.writes, [["upstream", "settings"]]);
  } finally { view.unmount(); }
});

test.after(() => { delete globalThis[bridgeKey]; });
