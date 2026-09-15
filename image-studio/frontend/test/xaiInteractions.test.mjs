import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const proPanels = await readFile(new URL("../src/components/xai/XAIProPanels.tsx", import.meta.url), "utf8");
const xaiWorkspace = await readFile(new URL("../src/components/xai/XAIWorkspace.tsx", import.meta.url), "utf8");
const progress = await readFile(new URL("../src/components/xai/XAIProgress.tsx", import.meta.url), "utf8");
const settingsPanel = await readFile(new URL("../src/components/panel/SettingsPanel.tsx", import.meta.url), "utf8");
const canvasStage = await readFile(new URL("../src/components/canvas/CanvasStage.tsx", import.meta.url), "utf8");
const xaiTheme = await readFile(new URL("../src/components/xai/xai-theme.css", import.meta.url), "utf8");

test("desktop settings exposes the system-backed upstream manager", () => {
  assert.match(settingsPanel, /openUpstreamConfig\("settings"\)/);
  assert.match(settingsPanel, /testAPIKey/);
  assert.doesNotMatch(settingsPanel, /localStorage\.(?:setItem|getItem)\([^)]*apiKey/i);
});

test("professional workspace exposes local drawing through the mask edit pipeline", () => {
  assert.match(proPanels, /局部绘制/);
  const localPaintStart = proPanels.indexOf("activateLocalPaint");
  assert.ok(localPaintStart >= 0, "local drawing must have a dedicated activation handler");
  const localPaintHandler = proPanels.slice(localPaintStart, localPaintStart + 900);
  assert.match(localPaintHandler, /reuseAsSource/);
  assert.match(localPaintHandler, /mode\s*!==\s*"edit"/);
  assert.match(localPaintHandler, /setField\("tool",\s*"mask"\)/);
  assert.match(canvasStage, /effectiveTool === "mask"/);
  assert.match(canvasStage, /pushStroke\(finished\)/);
});

test("simple workspace exposes a real visual aspect-ratio picker", () => {
  assert.match(xaiWorkspace, /function AspectRatioPicker/);
  assert.match(xaiWorkspace, /role=\"listbox\"/);
  assert.match(xaiWorkspace, /role=\"option\"/);
  assert.match(xaiWorkspace, /buildAspectSizeSelection\(nextAspect/);
  assert.match(xaiWorkspace, /setOpen\(false\)/);
});

test("XAI controls expose Apple-like pointer, focus, and pressed feedback", () => {
  assert.match(xaiTheme, /button:not\(:disabled\)[\s\S]*cursor:\s*pointer/);
  assert.match(xaiTheme, /button:disabled[\s\S]*cursor:\s*not-allowed/);
  assert.match(xaiTheme, /\):focus-visible\s*\{[\s\S]*outline:\s*2px solid/);
  assert.match(xaiTheme, /\):active\s*\{[\s\S]*transform:\s*translateY\(1px\)/);
  assert.match(xaiTheme, /input\[type="range"\][\s\S]*cursor:\s*pointer/);
});

test("XAI workspaces expose live generation progress with batch counts", () => {
  assert.match(xaiWorkspace, /XAIProgress/);
  assert.match(proPanels, /XAIProgress/);
  assert.match(xaiWorkspace, /jobsCompleted, jobsTotal, progress/);
  assert.match(proPanels, /jobsCompleted, jobsTotal, progress/);
  assert.match(progress, /role="progressbar"/);
  assert.match(progress, /aria-valuenow=\{percent/);
  assert.match(progress, /\$\{percent\}% · \$\{completed\}\/\$\{total\}/);
});
