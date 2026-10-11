import assert from "node:assert/strict";
import test from "node:test";
import { defaultDLSS5Options, validateDLSS5Options } from "../src/studio/DLSS5Options.mjs";
import { applyDLSS5Preset, selectedDLSS5Preset, loadDLSS5Preferences, saveDLSS5Preferences } from "../src/studio/DLSS5Preferences.mjs";
function storage() {
  const values = new Map();
  return { getItem: name => values.get(name) ?? null, setItem: (name, value) => values.set(name, value) };
}
test("XAI appearance presets preserve enabled state, independent output sizes and temporal options", () => {
  const original = { ...defaultDLSS5Options(), enabled: true, flowBackend: "raft", flowWidth: 768, flowIterations: 12,
    previewResolution: { mode: "custom", width: 960, height: 540 }, exportResolution: { mode: "custom", width: 3840, height: 2160 } };
  const before = structuredClone(original);
  for (const preset of ["natural", "detail", "cinematic"]) {
    const output = applyDLSS5Preset(original, preset);
    assert.equal(selectedDLSS5Preset(output), preset);
    assert.equal(validateDLSS5Options(output), null);
    for (const key of ["enabled", "previewResolution", "exportResolution", "flowBackend", "flowWidth", "flowIterations"]) assert.deepEqual(output[key], before[key]);
  }
  assert.deepEqual(original, before);
  assert.deepEqual(applyDLSS5Preset(original, "custom"), original);
});
test("valid previous options survive reopening without persisting machine paths or unknown fields", () => {
  const saved = storage();
  const options = { ...applyDLSS5Preset(defaultDLSS5Options(), "natural"), enabled: true, pythonPath: "private", toolRoot: "private",
    previewResolution: { mode: "custom", width: 1280, height: 720, unrelated: "private" }, exportResolution: { mode: "custom", width: 1920, height: 1080 } };
  assert.equal(saveDLSS5Preferences(options, saved), true);
  const restored = loadDLSS5Preferences(saved);
  assert.equal(selectedDLSS5Preset(restored), "natural");
  assert.equal(restored.enabled, true);
  assert.deepEqual(restored.previewResolution, { mode: "custom", width: 1280, height: 720 });
  assert.deepEqual(restored.exportResolution, { mode: "custom", width: 1920, height: 1080 });
  assert.equal("pythonPath" in restored, false);
  assert.equal("toolRoot" in restored, false);
});
test("incomplete numeric edits and storage failures leave a valid recoverable default", () => {
  const saved = storage();
  const good = applyDLSS5Preset(defaultDLSS5Options(), "detail");
  saveDLSS5Preferences(good, saved);
  assert.equal(saveDLSS5Preferences({ ...good, intensity: NaN }, saved), false);
  assert.deepEqual(loadDLSS5Preferences(saved), good);
  assert.deepEqual(loadDLSS5Preferences({ getItem: () => "{broken" }), defaultDLSS5Options());
  assert.equal(saveDLSS5Preferences(good, { setItem() { throw Error("storage denied"); } }), false);
  assert.deepEqual(loadDLSS5Preferences({ getItem() { throw Error("storage denied"); } }), defaultDLSS5Options());
});
