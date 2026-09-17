import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const componentURL = new URL("../src/components/xai/DesktopPrimitives.tsx", import.meta.url).href;
const loader = registerHooks({
  load(url, context, nextLoad) {
    if (url !== componentURL) return nextLoad(url, context);
    return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText };
  },
});
const { StudioButton, IconButton, SegmentedControl } = await import(componentURL);
loader.deregister();

test("desktop buttons preserve native form and disabled behavior", () => {
  assert.equal(StudioButton({ children: "取消" }).props.type, "button");
  const submit = StudioButton({ children: "保存", type: "submit", disabled: true });
  assert.equal(submit.props.type, "submit");
  assert.equal(submit.props.disabled, true);
  const icon = IconButton({ label: "展开属性" });
  assert.equal(icon.props["aria-label"], "展开属性");
  assert.equal(icon.props.title, "展开属性");
});

test("segmented controls render labelled native radio groups with isolated names", () => {
  const props = { label: "工作模式", value: "simple", options: [{ value: "simple", label: "简洁模式" }, { value: "pro", label: "专业模式" }], onChange() {} };
  const markup = renderToStaticMarkup(createElement("div", null,
    createElement(SegmentedControl, props), createElement(SegmentedControl, { ...props, label: "另一个工作区", value: "pro" })));
  assert.equal((markup.match(/role="radiogroup"/g) ?? []).length, 2);
  assert.match(markup, /aria-label="工作模式"/);
  const inputs = [...markup.matchAll(/<input ([^>]+)>/g)].map((match) => match[1]);
  assert.equal(inputs.length, 4);
  assert.ok(inputs.every((input) => input.includes('type="radio"')));
  const names = inputs.map((input) => input.match(/name="([^"]+)"/)[1]);
  assert.equal(names[0], names[1]);
  assert.equal(names[2], names[3]);
  assert.notEqual(names[0], names[2]);
  assert.deepEqual(inputs.map((input) => input.includes('checked=""')), [true, false, false, true]);
});

function luminance(hex) {
  const rgb = hex.match(/[a-f\d]{2}/gi).map((pair) => parseInt(pair, 16) / 255)
    .map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
}
function contrast(a, b) { const values = [luminance(a), luminance(b)].sort((x, y) => y - x); return (values[0] + .05) / (values[1] + .05); }

test("light and dark desktop semantic text meets WCAG AA contrast", () => {
  const css = readFileSync(new URL("../src/components/xai/desktop-design.css", import.meta.url), "utf8");
  const blocks = [...css.matchAll(/:root(?:\.dark)?\[data-desktop-studio="true"\][^{]*\{([^}]+)\}/g)].slice(0, 2);
  assert.equal(blocks.length, 2);
  for (const [index, block] of blocks.entries()) {
    const tokens = Object.fromEntries([...block[1].matchAll(/--studio-([\w-]+):\s*(#[a-f\d]{6})/gi)].map((entry) => [entry[1], entry[2]]));
    for (const foreground of ["text", "secondary", "tertiary", "accent", "danger", "success"]) {
      for (const background of ["background", "content", "content-secondary"]) {
        assert.ok(contrast(tokens[foreground], tokens[background]) >= 4.5, `${index === 0 ? "light" : "dark"} ${foreground} on ${background} must reach 4.5:1`);
      }
    }
    assert.ok(contrast(tokens["accent-text"], tokens.accent) >= 4.5);
  }
});
