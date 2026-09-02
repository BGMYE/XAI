import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { UpscaleImage } from "../src/platform/runtime/host.ts";

test("local upscale is explicitly unavailable without a Wails desktop binding", async () => {
  await assert.rejects(
    UpscaleImage("/tmp/not-managed.png", 2),
    /浏览器预览环境未注入 UpscaleImage（本地 CPU 放大） 宿主能力/,
  );
});

test("upscale locks before async materialization and guards the original target", async () => {
  const source = await readFile(new URL("../src/state/studioStore.media.ts", import.meta.url), "utf8");
  const lock = source.indexOf("upscaleRunning: true");
  const materialize = source.indexOf("await materializeHistoryItem");
  assert.ok(lock >= 0 && materialize >= 0 && lock < materialize, "lock must be acquired before the first await");
  assert.match(source, /const workspaceId = snapshot\.activeWorkspaceId/);
  assert.match(source, /sameTarget = activeTarget && state\.currentImage\?\.id === source\.id/);
  assert.match(source, /upsertCanvasNodeList/);
});
