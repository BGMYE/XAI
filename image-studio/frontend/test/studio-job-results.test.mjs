import assert from "node:assert/strict";
import test from "node:test";
import { buildAssetPromptIndex, resultAssetIDs } from "../src/studio/jobResults.mjs";

test("every final image is visible and searchable, including legacy and metadata-only results", () => {
  const job = { resultAssetId: "first", resultAssetIds: ["first", "second"], resultImages: [{ assetId: "second" }, { assetId: "third" }], request: { prompt: "Ceramic Cup" } };
  assert.deepEqual(resultAssetIDs(job), ["first", "second", "third"]);
  const index = buildAssetPromptIndex([job, { resultAssetId: "old", request: { prompt: "Legacy" } }]);
  for (const id of ["first", "second", "third"]) assert.match(index.get(id), /ceramic cup/);
  assert.match(index.get("old"), /legacy/);
  assert.equal(index.size, 4);
});

test("shared content assets retain searchable prompts from every generating job", () => {
  const index = buildAssetPromptIndex([
    { resultAssetIds: ["shared"], request: { prompt: "First idea" } },
    { resultAssetIds: ["shared"], request: { prompt: "SECOND idea" } },
  ]);
  assert.match(index.get("shared"), /first idea\nsecond idea/);
  assert.deepEqual(resultAssetIDs({}), []);
});

test("reusing legacy image settings hydrates current controls and removes hidden fallbacks", async () => {
  const { reusableGenerationSettings } = await import("../src/studio/jobResults.mjs");
  const request = { kind: "image", parameters: { quality: "high", outputFormat: "jpeg", inputFidelity: "high", size: "1024x1024" }, image: { quality: "medium", seed: 42 } };
  const reused = reusableGenerationSettings(request);
  assert.deepEqual(reused.parameters, { size: "1024x1024" });
  assert.deepEqual(reused.image, { quality: "medium", outputFormat: "jpeg", inputFidelity: "high", seed: 42 });
  reused.image.quality = undefined;
  assert.equal(reused.parameters.quality, undefined, "selecting upstream default cannot revive legacy high quality");
  assert.equal(request.parameters.quality, "high", "history remains unchanged");
  const video = reusableGenerationSettings({ kind: "video", parameters: { quality: "high", seconds: 4 } });
  assert.equal(video.parameters.quality, "high");
});
