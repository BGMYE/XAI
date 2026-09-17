import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const proPanels = await readFile(new URL("../src/components/xai/XAIProPanels.tsx", import.meta.url), "utf8");
const proActions = await readFile(new URL("../src/components/xai/proCanvasActions.ts", import.meta.url), "utf8");
const xaiWorkspace = await readFile(new URL("../src/components/xai/XAIWorkspace.tsx", import.meta.url), "utf8");
const progress = await readFile(new URL("../src/components/xai/XAIProgress.tsx", import.meta.url), "utf8");
const settingsPanel = await readFile(new URL("../src/components/panel/SettingsPanel.tsx", import.meta.url), "utf8");
const canvasStage = await readFile(new URL("../src/components/canvas/CanvasStage.tsx", import.meta.url), "utf8");

test("desktop settings exposes the system-backed upstream manager", () => {
  assert.match(settingsPanel, /openUpstreamConfig\("settings"\)/);
  assert.match(settingsPanel, /testAPIKey/);
  assert.doesNotMatch(settingsPanel, /localStorage\.(?:setItem|getItem)\([^)]*apiKey/i);
});

test("professional workspace exposes local drawing through the mask edit pipeline", () => {
  assert.match(proPanels, /局部绘制/);
  assert.match(proPanels, /activateLocalPaint\(useStudioStore.getState\)/);
  assert.match(proActions, /reuseAsSource/);
  assert.match(proActions, /mode\s*!==\s*"edit"/);
  assert.match(proActions, /setField\("tool",\s*"mask"\)/);
  assert.match(canvasStage, /effectiveTool === "mask"/);
  assert.match(canvasStage, /pushStroke\(finished\)/);
});

test("simple workspace uses a labelled native aspect control bound to generation size", () => {
  assert.match(xaiWorkspace, /<select aria-label="图像比例"/);
  assert.match(xaiWorkspace, /buildAspectSizeSelection\(event.target.value/);
  assert.match(xaiWorkspace, /setField\("size", buildAspectSizeSelection\(/);
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
