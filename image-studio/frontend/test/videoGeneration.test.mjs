import assert from "node:assert/strict";
import test from "node:test";

const video = await import("../src/lib/videoGeneration.ts");
const profiles = await import("../src/lib/profiles.ts");
const upstreamModels = await import("../src/lib/upstreamModels.ts");

test("video polling status continues only for non-terminal states", () => {
  assert.deepEqual(video.videoPollingDecision("queued"), { terminal: false, outcome: "pending" });
  assert.deepEqual(video.videoPollingDecision("processing"), { terminal: false, outcome: "pending" });
  assert.deepEqual(video.videoPollingDecision("completed"), { terminal: true, outcome: "completed" });
  assert.deepEqual(video.videoPollingDecision("failed"), { terminal: true, outcome: "failed" });
  assert.deepEqual(video.videoPollingDecision("cancelled"), { terminal: true, outcome: "cancelled" });
});

test("video results accept URL or base64 media without substituting models", () => {
  assert.equal(video.videoResultSource({ url: " https://cdn.example/video.mp4 " }), "https://cdn.example/video.mp4");
  assert.equal(video.videoResultSource({ b64_json: "YWJj" }), "data:video/mp4;base64,YWJj");
  assert.equal(video.videoResultSource({}), "");
  assert.equal(video.videoResultSource({ url: "javascript:alert(1)" }), "");
  assert.equal(video.videoResultSource({ url: "data:text/html;base64,PHNjcmlwdD4=" }), "");
});

test("video generation requires the profile video model explicitly", () => {
  assert.equal(video.requireExplicitVideoModelID({ videoModelID: " sora-2 " }), "sora-2");
  assert.throws(() => video.requireExplicitVideoModelID({ videoModelID: "" }), /请先在当前上游配置中填写视频模型 ID/);
  assert.throws(() => video.requireExplicitVideoModelID({ imageModelID: "gpt-image-2" }), /请先在当前上游配置中填写视频模型 ID/);
});

test("cancellable delay settles when aborted", async () => {
  const controller = new AbortController();
  const pending = video.cancellableDelay(10_000, controller.signal);
  controller.abort();
  await assert.rejects(pending, (error) => error?.name === "AbortError");
});

test("profile parsing preserves an explicit video model without adding a default", () => {
  const base = {
    id: "p-video",
    name: "视频上游",
    apiMode: "responses",
    requestPolicy: "openai",
    baseURL: "https://example.com",
    textModelID: "gpt-5.5",
    imageModelID: "gpt-image-2",
    reasoningEffort: "xhigh",
    concurrencyLimit: 0,
    createdAt: 1,
  };
  assert.equal(profiles.tryParseProfile({ ...base, videoModelID: " veo-3.1 " })?.videoModelID, "veo-3.1");
  assert.equal(profiles.tryParseProfile(base)?.videoModelID, "");
  assert.equal(profiles.makeBlankProfile().videoModelID, "");
});

test("upstream model catalog classifies common video models separately", () => {
  const catalog = upstreamModels.buildUpstreamModelCatalog([
    { id: "sora-2" },
    { id: "veo-3.1-generate-preview" },
    { id: "kling-v2.1" },
    { id: "runway-gen-4" },
    { id: "gpt-image-2" },
    { id: "gpt-5.5" },
  ]);
  assert.deepEqual(catalog.video.map((item) => item.id), [
    "sora-2",
    "veo-3.1-generate-preview",
    "kling-v2.1",
    "runway-gen-4",
  ]);
  assert.deepEqual(catalog.image.map((item) => item.id), ["gpt-image-2"]);
  assert.deepEqual(catalog.text.map((item) => item.id), ["gpt-5.5"]);
});
