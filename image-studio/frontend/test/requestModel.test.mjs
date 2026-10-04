import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_AUTO_RETRY_COUNT,
  DEFAULT_PARTIAL_IMAGES,
  DEFAULT_REASONING_EFFORT,
  buildPromptOptimizePayload,
  buildResponsesPayload,
  describeProblem,
  extractInvalidSize,
  googleInteractionsEndpoint,
  isRetryableRaw,
  normalizeAutoRetryCount,
  normalizeOpenAIImageSize,
  openAIAPIEndpoint,
  repairSizeForOpenAI,
  normalizePartialImages,
  validateImageRequest,
  shouldUseImagesNewAPICompat,
  shouldUseGoogleNativeInteractions,
} from "../../../shared/kernel/requestModel.js";

test("prompt inference payload sends the canvas image and describe-only instructions", () => {
  const payload = buildPromptOptimizePayload({
    prompt: "",
    mode: "describe",
    textModelID: "gpt-5.5",
  }, ["data:image/png;base64,YWJj"]);
  assert.match(payload.instructions, /attached image/);
  assert.match(payload.instructions, /Simplified Chinese/);
  assert.equal(payload.input[0].content[0].type, "input_text");
  assert.equal(payload.input[0].content[1].type, "input_image");
  assert.equal(payload.input[0].content[1].image_url, "data:image/png;base64,YWJj");
});

test("verbatim preserves exact user text and assisted keeps the forced image tool", () => {
  const prompt = '  两只狐狸，招牌写着“早安”\n只改变天空。  ';
  const precise = buildResponsesPayload({ prompt }, []);
  assert.equal(precise.input[0].content[0].text, prompt);
  assert.match(precise.instructions, /VERBATIM/);
  const assisted = buildResponsesPayload({ prompt, promptMode: "assisted" }, []);
  assert.equal(assisted.input[0].content[0].text, prompt);
  assert.match(assisted.instructions, /exact requested text, subjects, counts, identities, and all edit constraints/);
  assert.deepEqual(assisted.tool_choice, { type: "image_generation" });
  assert.throws(() => buildResponsesPayload({ prompt: "  " }, []), /prompt must not be empty/);
});

test("capability rules preserve references and reject known unsupported edits", () => {
  const refs = ["data:image/png;base64,first", "data:image/png;base64,second"];
  assert.throws(() => buildResponsesPayload({ prompt: "edit", maskB64: "mask" }, []), /参考图/);
  assert.throws(() => buildResponsesPayload({ prompt: "edit", maskB64: "mask", modelCapabilities: { supportsMask: false } }, refs), /不支持蒙版/);
  assert.throws(() => buildResponsesPayload({ prompt: "edit", modelCapabilities: { maxInputImages: 1 } }, refs), /最多支持 1/);
  const payload = buildResponsesPayload({ prompt: "edit", modelCapabilities: {}, maskB64: "mask" }, refs);
  assert.deepEqual(payload.input[0].content.slice(1).map((item) => item.image_url), refs);
  assert.ok(payload.tools[0].input_image_mask);
});

test("resolved capability rules send only confirmed input fidelity and enforce choices", () => {
  const input = { prompt: "edit", imageModelID: "gpt-image-1", inputFidelity: "high" };
  const refs = ["data:image/png;base64,ref"];
  assert.equal(buildResponsesPayload(input, refs).tools[0].input_fidelity, "high");
  assert.equal(buildResponsesPayload({ ...input, modelCapabilities: {} }, refs).tools[0].input_fidelity, undefined);
  assert.equal(buildResponsesPayload({ ...input, imageModelID: "gpt-image-2", modelCapabilities: { supportsInputFidelity: true } }, refs).tools[0].input_fidelity, "high");
  assert.throws(() => buildResponsesPayload({ ...input, quality: "high", modelCapabilities: { qualities: ["low"] } }, refs), /不支持质量/);
  assert.throws(() => buildResponsesPayload({ ...input, modelCapabilities: { supportsInputFidelity: true, inputFidelityValues: ["low"] } }, refs), /input_fidelity=high/);
});

test("Images requires a separate confirmed optimization step and explicit edit mode", () => {
  assert.throws(() => validateImageRequest({ prompt: "cat", promptMode: "assisted" }, [], "images"), /先优化并确认提示词/);
  assert.throws(() => validateImageRequest({ prompt: "edit", mode: "generate" }, ["ref"], "images"), /必须使用编辑模式/);
  assert.doesNotThrow(() => validateImageRequest({ prompt: "confirmed", promptMode: "verbatim" }, [], "images"));
});

test("Responses payload defaults partial_images to streaming preview count", () => {
  const payload = buildResponsesPayload({
    prompt: "cat",
    size: "1024x1024",
    quality: "low",
    outputFormat: "png",
    imageModelID: "gpt-image-2",
    textModelID: "gpt-5.5",
    requestPolicy: "openai",
  }, []);
  assert.equal(payload.tools[0].partial_images, DEFAULT_PARTIAL_IMAGES);
  assert.equal(payload.reasoning.effort, DEFAULT_REASONING_EFFORT);
});

test("normalizePartialImages clamps OpenAI range", () => {
  assert.equal(normalizePartialImages(0), 0);
  assert.equal(normalizePartialImages(-1), DEFAULT_PARTIAL_IMAGES);
  assert.equal(normalizePartialImages(2.8), 2);
  assert.equal(normalizePartialImages(9), 3);
});

test("Go and JS use the explicit preview-disable flag instead of a zero-value count", () => {
  assert.equal(buildResponsesPayload({ prompt: "cat", partialImages: 0 }, []).tools[0].partial_images, DEFAULT_PARTIAL_IMAGES);
  assert.equal(buildResponsesPayload({ prompt: "cat", partialImages: 0, disablePreview: true }, []).tools[0].partial_images, 0);
});

test("normalizeAutoRetryCount clamps retry count range", () => {
  assert.equal(normalizeAutoRetryCount(undefined), DEFAULT_AUTO_RETRY_COUNT);
  assert.equal(normalizeAutoRetryCount(-1), DEFAULT_AUTO_RETRY_COUNT);
  assert.equal(normalizeAutoRetryCount(3.8), 3);
  assert.equal(normalizeAutoRetryCount(99), 10);
});

test("OpenAI endpoint helper preserves Google compatibility base path", () => {
  assert.equal(
    openAIAPIEndpoint("https://generativelanguage.googleapis.com/v1beta/openai", "images/generations"),
    "https://generativelanguage.googleapis.com/v1beta/openai/images/generations",
  );
  assert.equal(
    openAIAPIEndpoint("https://relay.example.com/api/v1", "/images/edits"),
    "https://relay.example.com/api/v1/images/edits",
  );
});

test("OpenAI endpoint helper keeps explicit API versions like the Go client", () => {
  const cases = {
    "https://relay.example.com": "https://relay.example.com/v1/models",
    "https://relay.example.com/v1": "https://relay.example.com/v1/models",
    "https://relay.example.com/api/v1/": "https://relay.example.com/api/v1/models",
    "https://ark.example.com/api/v3": "https://ark.example.com/api/v3/models",
    "https://relay.example.com/v1beta": "https://relay.example.com/v1beta/models",
    "https://relay.example.com/v2alpha1": "https://relay.example.com/v2alpha1/models",
    "https://relay.example.com/video": "https://relay.example.com/video/v1/models",
    "https://relay.example.com/v1x": "https://relay.example.com/v1x/v1/models",
    "https://generativelanguage.googleapis.com/v1beta/openai": "https://generativelanguage.googleapis.com/v1beta/openai/models",
    // Judged as entered: ".../openai/v1" keeps its version (Azure OpenAI v1, Groq).
    "https://relay.example.com/V1/": "https://relay.example.com/V1/models",
    "https://api.groq.com/openai/v1": "https://api.groq.com/openai/v1/models",
    "https://res.openai.azure.com/openai/v1/": "https://res.openai.azure.com/openai/v1/models",
    "https://gateway.ai.cloudflare.com/v1/acct/gw/openai": "https://gateway.ai.cloudflare.com/v1/acct/gw/openai/models",
  };
  for (const [base, want] of Object.entries(cases)) {
    assert.equal(openAIAPIEndpoint(base, "models"), want, base);
  }
});

test("Gemini and Imagen image models use non-streaming Images compat mode", () => {
  assert.equal(shouldUseImagesNewAPICompat({ imageModelID: "gemini-3.1-flash-image" }), true);
  assert.equal(shouldUseImagesNewAPICompat({ imageModelID: "imagen-4.0-generate-001" }), true);
  assert.equal(shouldUseImagesNewAPICompat({ imageModelID: "gpt-image-2" }), false);
});

test("Google native Interactions routing is narrow to the official Nano Banana 2 endpoint", () => {
  assert.equal(
    shouldUseGoogleNativeInteractions(
      "https://generativelanguage.googleapis.com/v1beta/openai",
      "gemini-3.1-flash-image",
    ),
    true,
  );
  assert.equal(
    googleInteractionsEndpoint("https://generativelanguage.googleapis.com/v1beta/openai"),
    "https://generativelanguage.googleapis.com/v1beta/interactions",
  );
  assert.equal(
    shouldUseGoogleNativeInteractions("https://relay.example.com", "gemini-3.1-flash-image"),
    false,
  );
  assert.equal(
    shouldUseGoogleNativeInteractions(
      "https://generativelanguage.googleapis.com/v1beta/openai",
      "gemini-2.5-flash-image",
    ),
    false,
  );
});

test("Responses payload uses configured reasoning effort", () => {
  const payload = buildResponsesPayload({
    prompt: "cat",
    imageModelID: "gpt-image-2",
    textModelID: "gpt-5.5",
    reasoningEffort: "high",
  }, []);
  assert.equal(payload.reasoning.effort, "high");
});

test("describeProblem extracts refusal text from Responses SSE message events", () => {
  const raw = [
    'data: {"type":"response.output_item.done","item":{"type":"message","status":"completed","content":[{"type":"output_text","text":"抱歉，这个请求包含成人裸露，我无法生成这类真实照片风格图片。"}]}}',
    'data: {"type":"response.completed","response":{"status":"completed","output":[{"type":"image_generation_call","status":"failed"}]}}',
  ].join("\n");
  assert.equal(describeProblem(raw), "抱歉，这个请求包含成人裸露，我无法生成这类真实照片风格图片。");
});

test("isRetryableRaw treats upstream_error and 403 as retryable", () => {
  assert.equal(isRetryableRaw(JSON.stringify({
    error: {
      message: "Upstream request failed",
      type: "upstream_error",
      upstreamStatus: 403,
    },
  })), true);
  assert.equal(isRetryableRaw(JSON.stringify({ status: 403 })), true);
});

test("repairSizeForOpenAI snaps invalid sizes to nearest legal 16-aligned value", () => {
  assert.deepEqual(normalizeOpenAIImageSize("872x2048"), { width: 880, height: 2048 });
  assert.deepEqual(extractInvalidSize(`{"error":{"message":"Invalid size '872x2048'. Width and height must both be divisible by 16."}}`), {
    original: "872x2048",
    reason: "divisible_by_16",
  });
  assert.deepEqual(repairSizeForOpenAI({ size: "872x2048", prompt: "cat" }), {
    size: "880x2048",
    prompt: "cat",
  });
});
