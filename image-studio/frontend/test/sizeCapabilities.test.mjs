import assert from "node:assert/strict";
import test from "node:test";

const caps = await import("../src/components/panel/sizeCapabilities.ts");

test("gpt-image paths expose explicit 2K/4K resolution presets", () => {
  const values = caps.availableResolutionPresets({
    apiMode: "responses",
    requestPolicy: "openai",
    imageModelID: "gpt-image-2",
  });
  assert.ok(values.includes("2k"));
  assert.ok(values.includes("4k"));
  assert.equal(
    caps.buildSizeSelection("3:2", "4k", {
      apiMode: "responses",
      requestPolicy: "openai",
      imageModelID: "gpt-image-2",
    }),
    "3520x2352",
  );
  assert.equal(
    caps.buildSizeSelection("16:9", "4k", {
      apiMode: "responses",
      requestPolicy: "openai",
      imageModelID: "gpt-image-2",
    }),
    "3840x2160",
  );
});

test("blank image model falls back to default gpt-image-2 capabilities", () => {
  const input = {
    apiMode: "responses",
    requestPolicy: "openai",
    imageModelID: "",
  };
  const values = caps.availableResolutionPresets(input);
  assert.ok(values.includes("2k"));
  assert.ok(values.includes("4k"));
  assert.deepEqual(
    caps.listAspectPresetOptions(input).map((item) => item.value),
    ["auto", "1:1", "3:2", "2:3", "16:9", "9:16"],
  );
  assert.equal(caps.buildSizeSelection("9:16", "4k", input), "2160x3840");
});

test("legacy gpt-image models stay on documented base sizes", () => {
  const input = {
    apiMode: "images",
    requestPolicy: "openai",
    imageModelID: "gpt-image-1.5",
  };
  assert.deepEqual(caps.availableResolutionPresets(input), ["auto", "1k"]);
  assert.equal(
    caps.buildSizeSelection("16:9", "1k", input),
    "1024x1024",
  );
  assert.equal(
    caps.buildSizeSelection("3:2", "1k", input),
    "1536x1024",
  );
});

test("dall-e-3 uses only official aspect/size combinations", () => {
  const input = {
    apiMode: "images",
    requestPolicy: "openai",
    imageModelID: "dall-e-3",
  };
  const values = caps.availableResolutionPresets(input);
  assert.deepEqual(values, ["1k"]);
  const aspects = caps.listAspectPresetOptions(input).map((item) => item.value);
  assert.deepEqual(aspects, ["1:1", "7:4", "4:7"]);
  assert.equal(caps.buildSizeSelection("7:4", "1k", input), "1792x1024");
  assert.equal(caps.buildSizeSelection("4:7", "1k", input), "1024x1792");
});

test("dall-e-2 stays on square sizes only", () => {
  const input = {
    apiMode: "images",
    requestPolicy: "openai",
    imageModelID: "dall-e-2",
  };
  assert.deepEqual(caps.availableResolutionPresets(input), ["256", "512", "1k"]);
  const aspects = caps.listAspectPresetOptions(input).map((item) => item.value);
  assert.deepEqual(aspects, ["1:1"]);
  assert.equal(caps.buildSizeSelection("1:1", "256", input), "256x256");
  assert.equal(caps.buildSizeSelection("3:2", "1k", input), "1024x1024");
});

test("non-gpt-image openai-standard paths stay on base resolution presets", () => {
  const values = caps.availableResolutionPresets({
    apiMode: "responses",
    requestPolicy: "openai",
    imageModelID: "custom-relay-image",
  });
  assert.ok(!values.includes("2k"));
  assert.ok(!values.includes("4k"));
  assert.equal(caps.normalizeSizeSelection("3840x2160", {
    apiMode: "responses",
    requestPolicy: "openai",
    imageModelID: "custom-relay-image",
  }), "1536x864");
});

test("precise custom sizes stay untouched when the active model path supports them", () => {
  const input = {
    apiMode: "responses",
    requestPolicy: "openai",
    imageModelID: "gpt-image-2",
  };
  assert.equal(caps.normalizeSizeSelection("2000x1000", input), "2000x1008");
  assert.deepEqual(caps.deriveExactSizeSelection("2000x1008", input), {
    value: "2000x1008",
    width: 2000,
    height: 1008,
    label: "2000×1008",
  });
});

test("precise custom sizes obey the shared OpenAI edge, ratio, and pixel limits", () => {
  assert.deepEqual(caps.normalizeExactSizeDimensions(5000, 1000), {
    width: 3008,
    height: 1008,
  });
  assert.deepEqual(caps.normalizeExactSizeDimensions(1000, 5000), {
    width: 1008,
    height: 3008,
  });
  assert.deepEqual(caps.normalizeExactSizeDimensions(5000, 5000), {
    width: 2880,
    height: 2880,
  });
  assert.equal(caps.buildExactSizeValue(5000, 1000), "3008x1008");
  assert.equal(caps.normalizeSizeSelection("5000x5000", {
    apiMode: "responses",
    requestPolicy: "openai",
    imageModelID: "gpt-image-2",
  }), "2880x2880");
});

test("compat mode can keep large resolution presets available for compatible relays", () => {
  const values = caps.availableResolutionPresets({
    apiMode: "responses",
    requestPolicy: "compat",
    imageModelID: "relay-image-model",
  });
  assert.ok(values.includes("2k"));
  assert.ok(values.includes("4k"));
});

test("ratio stays independent from resolution preset", () => {
  assert.equal(
    caps.buildSizeSelection("1:1", "2k", {
      apiMode: "responses",
      requestPolicy: "openai",
      imageModelID: "gpt-image-2",
    }),
    "2048x2048",
  );
  assert.equal(
    caps.buildSizeSelection("9:16", "4k", {
      apiMode: "responses",
      requestPolicy: "openai",
      imageModelID: "gpt-image-2",
    }),
    "2160x3840",
  );
});

test("explicit aspect selection can leave Auto size", () => {
  assert.equal(
    caps.buildAspectSizeSelection("9:16", "auto", {
      apiMode: "responses",
      requestPolicy: "openai",
      imageModelID: "gpt-image-2",
    }),
    "864x1536",
  );
});

test("explicit resolution selection can leave Auto size", () => {
  assert.equal(
    caps.buildResolutionSizeSelection("auto", "2k", {
      apiMode: "responses",
      requestPolicy: "openai",
      imageModelID: "gpt-image-2",
    }),
    "2048x2048",
  );
});

test("explicit Auto selections keep upstream-determined size", () => {
  const input = {
    apiMode: "responses",
    requestPolicy: "openai",
    imageModelID: "gpt-image-2",
  };
  assert.equal(caps.buildAspectSizeSelection("auto", "2k", input), "auto");
  assert.equal(caps.buildResolutionSizeSelection("16:9", "auto", input), "auto");
});

test("custom aspect ratios can build sizes and round-trip back to the active custom button", () => {
  const input = {
    apiMode: "responses",
    requestPolicy: "compat",
    imageModelID: "relay-image-model",
  };
  const customRatios = [
    { id: "4:5", label: "4:5", width: 4, height: 5, createdAt: 1 },
  ];
  const value = caps.buildCustomAspectValue("4:5");
  const size = caps.buildAspectSizeSelection(value, "2k", input, customRatios);
  assert.equal(size, "1488x1872");
  assert.equal(caps.deriveAspectPreset(size, customRatios), value);
  assert.equal(caps.deriveResolutionPreset(size), "2k");
  assert.equal(caps.normalizeSizeSelection(size, input, customRatios), size);
  assert.equal(caps.deriveExactSizeSelection(size, input, customRatios), null);
});

test("all custom resolution presets keep OpenAI aspect and pixel limits", () => {
  const input = {
    apiMode: "responses",
    requestPolicy: "compat",
    imageModelID: "relay-image-model",
  };
  const customRatios = [
    { id: "4:1", label: "4:1", width: 4, height: 1, createdAt: 1 },
  ];
  const custom = caps.buildCustomAspectValue("4:1");
  assert.equal(caps.buildAspectSizeSelection(custom, "1k", input, customRatios), "1536x512");
  assert.equal(caps.buildAspectSizeSelection(custom, "2k", input, customRatios), "2048x688");
  assert.equal(caps.buildAspectSizeSelection(custom, "4k", input, customRatios), "3840x1280");
});

test("21:9 custom aspect supports 1K 2K and 4K presets", () => {
  const input = {
    apiMode: "responses",
    requestPolicy: "openai",
    imageModelID: "gpt-image-2",
  };
  const customRatios = [
    { id: "7:3", label: "21:9", width: 21, height: 9, createdAt: 1 },
  ];
  const custom = caps.buildCustomAspectValue("7:3");
  assert.equal(caps.buildAspectSizeSelection(custom, "1k", input, customRatios), "1536x656");
  assert.equal(caps.buildAspectSizeSelection(custom, "2k", input, customRatios), "2048x880");
  assert.equal(caps.buildAspectSizeSelection(custom, "4k", input, customRatios), "3840x1648");
  assert.equal(caps.deriveResolutionPreset("2048x880"), "2k");
});

test("4K custom aspect sizing follows OpenAI max-side, max-ratio, max-pixels, and 16px alignment rules", () => {
  const input = {
    apiMode: "responses",
    requestPolicy: "compat",
    imageModelID: "relay-image-model",
  };
  const customRatios = [
    { id: "4:1", label: "4:1", width: 4, height: 1, createdAt: 1 },
    { id: "1:4", label: "1:4", width: 1, height: 4, createdAt: 2 },
    { id: "3:2", label: "3:2", width: 3, height: 2, createdAt: 3 },
  ];
  assert.equal(
    caps.buildAspectSizeSelection(caps.buildCustomAspectValue("4:1"), "4k", input, customRatios),
    "3840x1280",
  );
  assert.equal(
    caps.buildAspectSizeSelection(caps.buildCustomAspectValue("1:4"), "4k", input, customRatios),
    "1280x3840",
  );
  assert.equal(
    caps.buildAspectSizeSelection(caps.buildCustomAspectValue("3:2"), "4k", input, customRatios),
    "3520x2352",
  );
  assert.equal(caps.deriveAspectPreset("3840x1280", customRatios), caps.buildCustomAspectValue("4:1"));
  assert.equal(caps.deriveResolutionPreset("3840x1280"), "4k");
});

test("auto aspect can resolve 2K/4K against a reference image ratio", () => {
  const input = {
    apiMode: "responses",
    requestPolicy: "openai",
    imageModelID: "gpt-image-2",
  };
  const reference = caps.buildReferenceAspectRatio(2000, 1000, []);
  const ratios = reference ? [reference] : [];
  const referenceAspect = caps.deriveAspectPreset("2000x1000", ratios);
  assert.equal(
    caps.buildResolutionSizeSelection("auto", "2k", input, ratios, referenceAspect),
    "2048x1024",
  );
  assert.equal(
    caps.buildResolutionSizeSelection("auto", "4k", input, ratios, referenceAspect),
    "3840x1920",
  );
});

test("reference resolution selection can use source image ratio directly", () => {
  const input = {
    apiMode: "responses",
    requestPolicy: "openai",
    imageModelID: "gpt-image-2",
  };
  assert.equal(
    caps.buildReferenceResolutionSizeSelection("2k", { width: 1200, height: 1600 }, input, []),
    "1440x1920",
  );
  assert.equal(
    caps.buildReferenceResolutionSizeSelection("4k", { width: 1600, height: 1200 }, input, []),
    "3312x2496",
  );
});
