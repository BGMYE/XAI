import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../src/platform/runtime/desktopAppearance.ts", import.meta.url), "utf8");
const globals = ["document", "window", "navigator", "matchMedia"];
const originals = new Map(globals.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
test.afterEach(() => { for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } delete globalThis.__appearanceHost; });

async function environment({ android = false, dark = false, native = false, preferences = {} } = {}) {
  const queries = new Map();
  const events = new Map();
  const classes = new Set();
  const root = { dataset: { platform: android ? "android" : "windows" }, classList: { toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); }, remove(name) { classes.delete(name); } }, style: {} };
  Object.defineProperty(globalThis, "navigator", { value: { userAgent: android ? "Android" : "Windows" }, configurable: true });
  globalThis.document = { documentElement: root, hidden: false };
  globalThis.window = { addEventListener(name, cb) { events.set(name, cb); }, setInterval(cb) { events.set("poll", cb); } };
  globalThis.matchMedia = (query) => { const media = { matches: query.includes("color-scheme") && dark, addEventListener(_name, cb) { this.changed = cb; } }; queries.set(query, media); return media; };
  globalThis.__appearanceHost = { native, preferences };
  const transformed = ts.transpile(source.replace(/import .* from "\.\/desktop";/, 'const hasDesktopSettingsHost = () => globalThis.__appearanceHost.native; const invokeDesktopHost = async () => globalThis.__appearanceHost.preferences;'), { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext });
  const module = await import(`data:text/javascript;base64,${Buffer.from(transformed + `\n// ${Math.random()}`).toString("base64")}`);
  module.installDesktopAppearance();
  await Promise.resolve();
  return { root, queries, events, classes };
}

test("desktop starts light even when the operating system is dark", async () => {
  const { root, queries, classes } = await environment({ dark: true });
  assert.equal(root.dataset.theme, "light");
  assert.equal(root.style.colorScheme, "light");
  assert.equal(root.style.backgroundColor, "#F5F5F7");
  assert.equal(classes.has("dark"), false);
  assert.equal(queries.has("(prefers-color-scheme: dark)"), false);
});

test("native accessibility preferences fill missing WebView media queries and refresh on focus", async () => {
  const { root, events } = await environment({ native: true, preferences: { dark: true, highContrast: true, reduceMotion: true, reduceTransparency: true } });
  assert.equal(root.dataset.theme, "light");
  for (const key of ["highContrast", "reduceMotion", "reduceTransparency"]) assert.equal(root.dataset[key], "true");
  globalThis.__appearanceHost.preferences = { dark: false, highContrast: false, reduceMotion: false, reduceTransparency: false };
  events.get("focus")(); await Promise.resolve();
  assert.equal(root.dataset.theme, "light");
  assert.equal(root.dataset.reduceMotion, "false");
});

test("desktop appearance does not install listeners or modify Android theme behavior", async () => {
  const { root, events, queries } = await environment({ android: true });
  assert.equal(root.dataset.desktopStudio, undefined);
  assert.equal(events.size, 0); assert.equal(queries.size, 0);
});
