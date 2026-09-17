import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import ts from "typescript";

const hookURL = new URL("../src/app/hooks/useGlobalImageImport.ts", import.meta.url).href;
const dropURL = new URL("../src/app/hooks/desktopDrop.ts", import.meta.url).href;
const bridge = "globalThis.__desktopDropTest";
const mocks = new Map(Object.entries({
  react: `export const useEffect = (effect) => { ${bridge}.effect = effect; }; export const useState = (value) => [value, (next) => { ${bridge}.hover = next; }];`,
  "../../platform/runtime/desktop": `export const hasDesktopSettingsHost = () => ${bridge}.native;`,
  "../../platform/runtime/host": `export const EventsOn = (name, callback) => { ${bridge}.events.set(name, callback); return () => ${bridge}.events.delete(name); };`,
  "../../state/studioStore": `export const useStudioStore = { getState: () => ({ acceptImportedImage: ${bridge}.accept }), setState: (patch) => ${bridge}.patches.push(patch) };`,
}));
const loader = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === hookURL) {
      if (mocks.has(specifier)) return { url: `drop-test:${specifier}`, shortCircuit: true };
      if (specifier === "./desktopDrop") return { url: dropURL, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith("drop-test:")) return { format: "module", source: mocks.get(url.slice(10)), shortCircuit: true };
    if (url !== hookURL) return nextLoad(url, context);
    return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText };
  },
});
const { useGlobalImageImport } = await import(hookURL);
loader.deregister();

function mount(native) {
  const originals = { window: globalThis.window, document: globalThis.document, MutationObserver: globalThis.MutationObserver };
  const attributes = new Map();
  const calls = [];
  const context = {
    native, events: new Map(), patches: [], hover: false,
    accept: async (image, name, size) => calls.push(["native", image.path, name, size]),
  };
  globalThis.__desktopDropTest = context;
  globalThis.window = new EventTarget();
  globalThis.document = Object.assign(new EventTarget(), { documentElement: {
    setAttribute: (name, value) => attributes.set(name, value), removeAttribute: (name) => attributes.delete(name),
    classList: { contains: () => false },
  } });
  globalThis.MutationObserver = class { observe() {} disconnect() {} };
  useGlobalImageImport(async (file) => calls.push(["dom", file.name]), async (item) => calls.push(["history", item.id]));
  const cleanup = context.effect();
  return { calls, context, attributes, cleanup: () => { cleanup(); Object.assign(globalThis, originals); delete globalThis.__desktopDropTest; } };
}

function drop(files, history) {
  const event = new Event("drop", { cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { files, types: ["Files"], getData: () => history ? JSON.stringify(history) : "" } });
  window.dispatchEvent(event);
}

test("Windows DOM plus native drop imports once, internal history and paste stay available", async () => {
  const harness = mount(true);
  try {
    assert.equal(harness.attributes.has("data-file-drop-target"), true);
    drop([new File(["image"], "reference.png", { type: "image/png" })]);
    harness.context.events.get("desktop-images-dropped")({ images: [{ path: "managed/reference.png", name: "reference.png", size: 5 }], errors: [] });
    await new Promise(setImmediate);
    assert.deepEqual(harness.calls, [["native", "managed/reference.png", "reference.png", 5]]);
    drop([], { id: "prior-result", prompt: "previous work", mode: "generate", size: "auto", quality: "medium", createdAt: 1 });
    const paste = new Event("paste", { cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: { items: [{ kind: "file", type: "image/png", getAsFile: () => new File(["paste"], "paste.png", { type: "image/png" }) }] } });
    document.dispatchEvent(paste);
    await new Promise(setImmediate);
    assert.deepEqual(harness.calls.slice(1), [["history", "prior-result"], ["dom", "paste.png"]]);
  } finally { harness.cleanup(); }
  assert.equal(harness.context.events.size, 0);
  assert.equal(harness.attributes.size, 0);
});

test("browser and Android previews still import dropped File objects without native listeners", async () => {
  const harness = mount(false);
  try {
    drop([new File(["image"], "preview.png", { type: "image/png" })]);
    await new Promise(setImmediate);
    assert.deepEqual(harness.calls, [["dom", "preview.png"]]);
    assert.equal(harness.context.events.size, 0);
    assert.equal(harness.attributes.size, 0);
  } finally { harness.cleanup(); }
});
