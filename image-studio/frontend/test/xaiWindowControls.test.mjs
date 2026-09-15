import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import { Children } from "react";
import ts from "typescript";

const componentURL = new URL("../src/components/xai/XAIWindowControls.tsx", import.meta.url).href;
const styleURL = new URL("../src/components/xai/xai-window-controls.css", import.meta.url).href;
const loader = registerHooks({
  load(url, context, nextLoad) {
    if (url === styleURL) return { format: "module", source: "", shortCircuit: true };
    if (url !== componentURL) return nextLoad(url, context);
    const { outputText } = ts.transpileModule(readFileSync(new URL(url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    });
    return { format: "module", source: outputText, shortCircuit: true };
  },
});
const { XAIWindowControls, handleWindowTitleBarDoubleClick } = await import(componentURL);
loader.deregister();

const realWindow = globalThis.window;
const cases = [
  { color: "red", label: "关闭窗口", method: "Quit" },
  { color: "yellow", label: "最小化窗口", method: "WindowMinimise" },
  { color: "green", label: "最大化或还原窗口", method: "WindowToggleMaximise" },
];

function findButton(label, onUnavailable) {
  const control = Children.toArray(XAIWindowControls({ onUnavailable }).props.children)
    .find((child) => child.props["aria-label"] === label);
  assert.ok(control, `missing accessible button: ${label}`);
  assert.equal(control.type, "button");
  return control;
}

test.afterEach(() => {
  globalThis.window = realWindow;
});

for (const { color, label, method } of cases) {
  test(`XAI ${color} window button invokes only ${method}`, () => {
    const calls = [];
    globalThis.window = {
      runtime: Object.fromEntries(cases.map(({ method: action }) => [action, () => calls.push(action)])),
      close() { assert.fail("window controls must not call browser window.close"); },
    };
    const button = findButton(label, () => assert.fail("native action should be available"));
    assert.ok(button.props.children.props.className.split(/\s+/).includes(color));

    button.props.onClick();

    assert.deepEqual(calls, [method]);
  });
}

test("XAI browser preview reports unavailable window actions without closing or navigating", () => {
  let unavailable = 0;
  const location = { href: "http://localhost:5174/?preview=windows-right-rail" };
  globalThis.window = {
    location,
    close() { assert.fail("browser preview must remain open"); },
  };

  for (const { label } of cases) {
    findButton(label, () => unavailable++).props.onClick();
  }

  assert.equal(unavailable, 3);
  assert.equal(location.href, "http://localhost:5174/?preview=windows-right-rail");
});

test("XAI reports a missing native window method without invoking another action", () => {
  let unavailable = 0;
  for (const { label, method } of cases) {
    globalThis.window = {
      runtime: Object.fromEntries(cases.filter((item) => item.method !== method)
        .map(({ method: action }) => [action, () => assert.fail(`unexpected native action: ${action}`)])),
      close() { assert.fail("missing native method must not fall back to window.close"); },
    };

    findButton(label, () => unavailable++).props.onClick();
  }

  assert.equal(unavailable, 3);
});

test("XAI title bar double click toggles the native window", () => {
  let toggles = 0;
  globalThis.window = { runtime: { WindowToggleMaximise() { toggles++; } } };

  handleWindowTitleBarDoubleClick({ target: { closest() { return null; } } },
    () => assert.fail("native maximise should be available"));

  assert.equal(toggles, 1);
});

test("XAI no-drag controls do not trigger an additional title bar double-click action", () => {
  let toggles = 0;
  globalThis.window = { runtime: { WindowToggleMaximise() { toggles++; } } };
  const button = findButton("最大化或还原窗口", () => assert.fail("native maximise should be available"));
  assert.ok(button.props.className.split(/\s+/).includes("no-drag"));

  button.props.onClick();
  button.props.onClick();
  handleWindowTitleBarDoubleClick({ target: { closest(selector) { return selector === ".no-drag" ? button : null; } } },
    () => assert.fail("no-drag double click should be ignored"));

  assert.equal(toggles, 2);
});

test("XAI browser title bar double click reports the unavailable action", () => {
  let unavailable = 0;
  globalThis.window = { close() { assert.fail("browser preview must remain open"); } };

  handleWindowTitleBarDoubleClick({ target: { closest() { return null; } } }, () => unavailable++);

  assert.equal(unavailable, 1);
});
