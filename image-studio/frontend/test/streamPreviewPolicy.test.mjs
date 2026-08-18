import assert from "node:assert/strict";
import test from "node:test";

const policy = await import("../src/state/streamPreviewPolicy.ts");

test("Android disables streaming preview at concurrency 2 and above", () => {
  assert.equal(policy.shouldForceDisableStreamingPreview({ isAndroid: true, requestedConcurrency: 1, resolvedSize: "1024x1024" }), false);
  assert.equal(policy.shouldForceDisableStreamingPreview({ isAndroid: true, requestedConcurrency: 2, resolvedSize: "1024x1024" }), true);
});

test("Desktop disables streaming preview at concurrency 8 and above", () => {
  assert.equal(policy.shouldForceDisableStreamingPreview({ isAndroid: false, requestedConcurrency: 7, resolvedSize: "1024x1024" }), false);
  assert.equal(policy.shouldForceDisableStreamingPreview({ isAndroid: false, requestedConcurrency: 8, resolvedSize: "1024x1024" }), true);
});

test("Android disables streaming preview for 2K and 4K style sizes even at single concurrency", () => {
  assert.equal(policy.getStreamPreviewDisableReason({ isAndroid: true, requestedConcurrency: 1, resolvedSize: "2048x1152" }), "android_large_size");
  assert.equal(policy.getStreamPreviewDisableReason({ isAndroid: true, requestedConcurrency: 1, resolvedSize: "3456x2304" }), "android_large_size");
  assert.equal(policy.getStreamPreviewDisableReason({ isAndroid: true, requestedConcurrency: 1, resolvedSize: "auto" }), null);
});

test("disabled protection never forces preview off", () => {
  assert.equal(policy.getStreamPreviewDisableReason({
    enabled: false,
    isAndroid: true,
    requestedConcurrency: 9,
    resolvedSize: "3456x2304",
  }), null);
});
