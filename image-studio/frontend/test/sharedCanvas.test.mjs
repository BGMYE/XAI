import assert from "node:assert/strict";
import test from "node:test";
import { collectClassicAssets, createClassicReferenceSync } from "../src/state/sharedCanvas.ts";

test("classic references include background canvases, videos and open image viewers", () => {
  assert.deepEqual(
    collectClassicAssets({
      canvasNodes: [
        { assetId: "image" },
        { src: "/studio-media/video" },
        { src: "https://example.com/not-shared" },
      ],
      workspaces: [{ canvasNodes: [{ assetId: "background" }, { assetId: "image" }] }],
      currentImage: { assetId: "current" },
      compareB: { assetId: "compare" },
      batchResults: [{ assetId: "batch" }],
    }),
    ["background", "batch", "compare", "current", "image", "video"],
  );
});

test("reference saves serialize and publish the latest removal without duplicate writes", async () => {
  const calls = [];
  let release;
  const sync = createClassicReferenceSync(async (ids) => {
    calls.push(ids);
    if (calls.length === 1)
      await new Promise((r) => {
        release = r;
      });
  }, assert.fail);
  const first = sync({ canvasNodes: [{ assetId: "image" }] });
  await Promise.resolve();
  const latest = sync({ canvasNodes: [] });
  release();
  await Promise.all([first, latest]);
  assert.deepEqual(calls, [["image"], []]);
  await sync({ canvasNodes: [] });
  assert.equal(calls.length, 2);
});

test("a reference update in the save completion microtask is persisted", async () => {
  const calls = [];
  const sync = createClassicReferenceSync(async (ids) => { calls.push(ids); }, assert.fail);
  const first = sync({ canvasNodes: [{ assetId: "first" }] });
  const last = Promise.resolve().then(() => sync({ canvasNodes: [{ assetId: "last" }] }));
  await Promise.all([first, last]);
  assert.deepEqual(calls, [["first"], ["last"]]);
});
