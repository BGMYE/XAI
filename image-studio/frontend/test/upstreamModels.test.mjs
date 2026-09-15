import assert from "node:assert/strict";
import test from "node:test";

const upstreamModels = await import("../src/lib/upstreamModels.ts");

test("buildUpstreamModelCatalog deduplicates and classifies text/image models", () => {
  const catalog = upstreamModels.buildUpstreamModelCatalog([
    { id: "gpt-image-2", displayName: "GPT Image 2" },
    { id: "gemini-3.1-flash-image", displayName: "Gemini 3.1 Flash Image" },
    { id: "gpt-5.5", displayName: "GPT 5.5" },
    { id: "gpt-image-2", displayName: "Duplicate" },
    { id: "relay-custom" },
  ]);

  assert.deepEqual(catalog.text.map((item) => item.id), ["gpt-5.5", "relay-custom"]);
  assert.deepEqual(catalog.image.map((item) => item.id), ["gpt-image-2", "gemini-3.1-flash-image"]);
  assert.equal(catalog.all.length, 4);
});

test("preferredModelsForAPIMode falls back to all models when image/text buckets are empty", () => {
  const onlyUnknown = upstreamModels.buildUpstreamModelCatalog([{ id: "relay-custom" }]);
  const imagesMode = upstreamModels.preferredModelsForAPIMode(onlyUnknown, "images");
  assert.deepEqual(imagesMode.image.map((item) => item.id), ["relay-custom"]);
});

test("formatUpstreamModelLabel prefers display name when available", () => {
  assert.equal(
    upstreamModels.formatUpstreamModelLabel({
      id: "gpt-image-2",
      object: "",
      ownedBy: "",
      displayName: "GPT Image 2",
    }),
    "GPT Image 2 (gpt-image-2)",
  );
});

test("model directory retains multiple custom IDs and removes case-insensitive duplicates", () => {
  const catalog = upstreamModels.buildUpstreamModelCatalog([
    { id: "custom-image-a" },
    { id: "CUSTOM-IMAGE-A", displayName: "Duplicate custom model" },
    { id: "custom-image-b", displayName: "Studio sketch" },
  ]);

  assert.deepEqual(catalog.all.map((item) => item.id), ["custom-image-a", "custom-image-b"]);
  assert.deepEqual(
    upstreamModels.preferredModelsForAPIMode(catalog, "images").image.map((item) => item.id),
    ["custom-image-a", "custom-image-b"],
  );
});

test("discovered image models remain selectable alongside manually added models", () => {
  const catalog = upstreamModels.buildUpstreamModelCatalog([
    { id: "gpt-image-2.5-sunburst" },
    { id: "manual-relay-image-model", object: "image_generation" },
  ]);

  const imageModels = upstreamModels.preferredModelsForAPIMode(catalog, "images").image;
  assert.deepEqual(imageModels.map((item) => item.id), ["gpt-image-2.5-sunburst", "manual-relay-image-model"]);
});
