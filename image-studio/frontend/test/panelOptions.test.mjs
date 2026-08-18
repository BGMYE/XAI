import assert from "node:assert/strict";
import test from "node:test";

const options = await import("../src/components/panel/panelOptions.ts");

test("gpt-image models use auto/low/medium/high quality options", () => {
  const values = options.availableQualityOptions("gpt-image-2").map((item) => item.value);
  assert.deepEqual(values, ["auto", "low", "medium", "high"]);
});

test("dall-e-3 uses auto/standard/hd quality options", () => {
  const values = options.availableQualityOptions("dall-e-3").map((item) => item.value);
  assert.deepEqual(values, ["auto", "standard", "hd"]);
  assert.equal(options.normalizeQualitySelection("high", "dall-e-3"), "auto");
  assert.equal(options.normalizeQualitySelection("hd", "dall-e-3"), "hd");
});

test("dall-e-2 uses auto/standard quality options", () => {
  const values = options.availableQualityOptions("dall-e-2").map((item) => item.value);
  assert.deepEqual(values, ["auto", "standard"]);
  assert.equal(options.normalizeQualitySelection("medium", "dall-e-2"), "auto");
  assert.equal(options.normalizeQualitySelection("standard", "dall-e-2"), "standard");
});
