import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultDLSS5Options,
  validateDLSS5Options,
  validateDLSS5Clip,
  dlss5AspectRatio,
} from "../src/studio/DLSS5Options.mjs";

const enabled = (overrides = {}) => ({ ...defaultDLSS5Options(), enabled: true, ...overrides });
const custom = (width, height) => ({ mode: "custom", width, height });

test("defaults are valid, disabled, and give each resolution its own fresh object", () => {
  const first = defaultDLSS5Options();
  const second = defaultDLSS5Options();
  assert.equal(first.enabled, false);
  assert.equal(first.flowBackend, "off");
  assert.equal(validateDLSS5Options(first), null);
  assert.equal(validateDLSS5Options({ ...first, enabled: true }), null);
  assert.notEqual(first.previewResolution, first.exportResolution);
  assert.notEqual(first.previewResolution, second.previewResolution);
  assert.notEqual(first.exportResolution, second.exportResolution);
  first.previewResolution.width = 128;
  first.exportResolution.height = 128;
  assert.equal(second.previewResolution.width, 1920);
  assert.equal(second.exportResolution.height, 1080);
});

test("disabled processing ignores invalid settings, while enabled validation does not alter inputs", () => {
  assert.equal(validateDLSS5Options({ enabled: false, style: NaN, previewResolution: null }), null);
  assert.match(validateDLSS5Options(null), /启用/);
  const options = enabled({ intensity: -0.1 });
  Object.freeze(options.previewResolution);
  Object.freeze(options.exportResolution);
  Object.freeze(options);
  assert.match(validateDLSS5Options(options), /总强度/);
  assert.equal(options.intensity, -0.1, "an invalid request must not be silently clamped");
});

test("styles and all five fractional controls have strict inclusive bounds", () => {
  for (const style of [0, 1, 2]) assert.equal(validateDLSS5Options(enabled({ style })), null);
  for (const style of [-1, 3, 0.5, "0", NaN])
    assert.match(validateDLSS5Options(enabled({ style })), /风格/);
  for (const [key, label] of [
    ["intensity", "总强度"], ["localTone", "局部色调"], ["localStructure", "局部结构"],
    ["skinStructure", "皮肤结构"], ["outputMix", "输出混合"],
  ]) {
    for (const value of [0, 0.5, 1])
      assert.equal(validateDLSS5Options(enabled({ [key]: value })), null, `${key}=${value}`);
    for (const value of [-0.001, 1.001, NaN, Infinity, -Infinity, "0.5", undefined])
      assert.ok(validateDLSS5Options(enabled({ [key]: value })).includes(label), `${key}=${value}`);
  }
});

test("flow controls reject unknown backends and non-integer or out-of-range values", () => {
  for (const flowBackend of ["off", "raft", "nvofa"])
    assert.equal(validateDLSS5Options(enabled({ flowBackend })), null);
  assert.match(validateDLSS5Options(enabled({ flowBackend: "automatic" })), /光流后端/);
  for (const flowWidth of [128, 129, 2048])
    assert.equal(validateDLSS5Options(enabled({ flowWidth })), null);
  for (const flowWidth of [127, 2049, 128.5, NaN, Infinity, "512"])
    assert.match(validateDLSS5Options(enabled({ flowWidth })), /光流宽度/);
  for (const flowIterations of [1, 32])
    assert.equal(validateDLSS5Options(enabled({ flowIterations })), null);
  for (const flowIterations of [0, 33, 1.5, NaN, Infinity, "6"])
    assert.match(validateDLSS5Options(enabled({ flowIterations })), /迭代次数/);
  assert.match(validateDLSS5Options(enabled({ autoMask: "true" })), /自动蒙版/);
});

test("source resolutions ignore dimensions but unknown resolution modes are rejected", () => {
  assert.equal(validateDLSS5Options(enabled({
    previewResolution: { mode: "source", width: NaN, height: -1 },
    exportResolution: { mode: "source", width: undefined, height: Infinity },
  })), null);
  for (const key of ["previewResolution", "exportResolution"])
    for (const resolution of [null, {}, { mode: "auto", width: 1920, height: 1080 }])
      assert.match(validateDLSS5Options(enabled({ [key]: resolution })), /分辨率请选择/);
});

test("custom resolutions enforce even edges and total pixels independently in both orientations", () => {
  for (const [key, label, edge, fullWidth, fullHeight] of [
    ["previewResolution", "预览", 4096, 3840, 2160],
    ["exportResolution", "导出", 8192, 7680, 4320],
  ]) {
    for (const [width, height] of [[128, 128], [edge, 128], [128, edge], [fullWidth, fullHeight], [fullHeight, fullWidth]])
      assert.equal(validateDLSS5Options(enabled({ [key]: custom(width, height) })), null, `${key}: ${width}x${height}`);
    for (const [width, height] of [[126, 128], [128, 126], [129, 128], [128, 129], [edge + 2, 128], [128, edge + 2], [128.5, 128], [NaN, 128], [128, Infinity]])
      assert.ok(validateDLSS5Options(enabled({ [key]: custom(width, height) })).includes(`${label}分辨率的宽高`));
    for (const [width, height] of [[fullWidth, fullHeight + 2], [fullHeight + 2, fullWidth], [edge, edge]])
      assert.ok(validateDLSS5Options(enabled({ [key]: custom(width, height) })).includes(`${label}分辨率不得超过`));
  }
});

test("clip validation accepts fractional seconds and the ten-second limit", () => {
  for (const [start, duration] of [[0, 10], [12.5, 0.001], [0, 0.5]])
    assert.equal(validateDLSS5Clip(start, duration), null);
  for (const start of [-0.001, NaN, Infinity, "0"])
    assert.match(validateDLSS5Clip(start, 1), /开始时间/);
  for (const duration of [0, -1, 10.001, NaN, Infinity, "10"])
    assert.match(validateDLSS5Clip(0, duration), /片段时长/);
  assert.match(validateDLSS5Clip(-1, 11), /开始时间/, "report the first actionable issue");
});

test("aspect ratio is reduced for landscape, portrait and square without accepting invalid dimensions", () => {
  assert.equal(dlss5AspectRatio(1920, 1080), "16:9");
  assert.equal(dlss5AspectRatio(1080, 1920), "9:16");
  assert.equal(dlss5AspectRatio(2048, 2048), "1:1");
  assert.equal(dlss5AspectRatio(127, 131), "127:131");
  for (const value of [0, -1, 1.5, NaN, Infinity, "1920", Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(dlss5AspectRatio(value, 1080), "—");
    assert.equal(dlss5AspectRatio(1920, value), "—");
  }
});

test("image requests omit video enhancement without clearing remembered video settings", async () => {
  const { generationParameters } = await import("../src/studio/DLSS5Options.mjs");
  const parameters = { size: "1024x1024", promptMode: "verbatim", dlss5: { ...defaultDLSS5Options(), enabled: true, intensity: 0.45 } };
  const original = structuredClone(parameters);
  const imageRequest = generationParameters("image", parameters);
  assert.deepEqual(imageRequest, { size: "1024x1024", promptMode: "verbatim" });
  assert.equal(Object.hasOwn(imageRequest, "dlss5"), false);
  assert.deepEqual(parameters, original, "creating an image request must not alter the form's remembered video options");
  assert.deepEqual(generationParameters("video", parameters).dlss5, original.dlss5);
});
