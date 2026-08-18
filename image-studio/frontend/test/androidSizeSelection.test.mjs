import assert from "node:assert/strict";
import test from "node:test";

const androidSize = await import("../src/platform/android/parameters/androidSizeSelection.ts");

const baseInput = {
  apiMode: "responses",
  requestPolicy: "openai",
  imageModelID: "gpt-image-2",
};

test("Android parameter picker can leave Auto by selecting an aspect", () => {
  assert.equal(
    androidSize.buildAndroidAspectSizeSelection("9:16", "auto", baseInput),
    "864x1536",
  );
});

test("Android parameter picker can leave Auto by selecting a resolution", () => {
  assert.equal(
    androidSize.buildAndroidResolutionSizeSelection("auto", "2k", baseInput),
    "2048x2048",
  );
});

test("Android parameter picker still returns Auto when Auto is selected explicitly", () => {
  assert.equal(
    androidSize.buildAndroidAspectSizeSelection("auto", "2k", baseInput),
    "auto",
  );
  assert.equal(
    androidSize.buildAndroidResolutionSizeSelection("16:9", "auto", baseInput),
    "auto",
  );
});
