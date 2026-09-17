import assert from "node:assert/strict";
import test from "node:test";
import { activateLocalPaint, professionalPanelDefaults, selectedCropRect } from "../src/components/xai/proCanvasActions.ts";

function paintState(overrides = {}) {
  const state = {
    currentImage: { id: "image-a", savedPath: "a.png" },
    isRunning: false, mode: "generate", sources: [], tool: "pan",
    setField(key, value) { state[key] = value; },
    selectCanvasNode(id) { state.selectedNodeId = id; },
    pushToast(message) { state.notice = message; },
    async reuseAsSource(image) {
      state.mode = "edit";
      state.sources = [{ path: image.savedPath }];
    },
    ...overrides,
  };
  return state;
}

test("local painting materializes the selected result and enters edit mode before enabling mask", async () => {
  const state = paintState();
  assert.equal(await activateLocalPaint(() => state), true);
  assert.equal(state.mode, "edit");
  assert.equal(state.tool, "mask");
  assert.equal(state.selectedNodeId, "image-a");
  assert.deepEqual(state.sources, [{ path: "a.png" }]);
});

test("local painting preserves an already editable image without replacing references", async () => {
  const state = paintState({ mode: "edit", sources: [{ path: "a.png" }, { path: "b.png" }], reuseAsSource() { assert.fail("must not rematerialize"); } });
  assert.equal(await activateLocalPaint(() => state), true);
  assert.equal(state.sources.length, 2);
});

test("failed materialization does not enable a mask that would be omitted from generation", async () => {
  const state = paintState({ async reuseAsSource() {} });
  assert.equal(await activateLocalPaint(() => state), false);
  assert.equal(state.tool, "pan");
  assert.match(state.notice, /重新添加素材/);
});

test("a selection change during image materialization cannot paint the new selection", async () => {
  const state = paintState({ async reuseAsSource() { state.currentImage = { id: "image-b", savedPath: "b.png" }; state.mode = "edit"; } });
  assert.equal(await activateLocalPaint(() => state), false);
  assert.equal(state.tool, "pan");
  assert.equal(state.selectedNodeId, undefined);
});

test("an active generation is never switched into local painting", async () => {
  const state = paintState({ isRunning: true, reuseAsSource() { assert.fail("must not change active generation source"); } });
  assert.equal(await activateLocalPaint(() => state), false);
  assert.equal(state.tool, "pan");
});

test("crop selection normalizes a rectangle drawn in reverse and excludes nonrectangular annotations", () => {
  const state = { currentImage: { savedPath: "a.png" }, selectedAnnotationId: "rect", annotations: [{ id: "rect", kind: "rect", x: 80, y: 90, width: -40, height: -30 }] };
  assert.deepEqual(selectedCropRect(state), { x: 40, y: 60, width: 40, height: 30 });
  assert.equal(selectedCropRect({ ...state, currentImage: null }), null);
  assert.equal(selectedCropRect({ ...state, selectedAnnotationId: "missing" }), null);
  assert.equal(selectedCropRect({ ...state, annotations: [{ ...state.annotations[0], kind: "arrow" }] }), null);
});

test("professional sidebars make room for the canvas at narrow widths and 200% text", () => {
  assert.deepEqual(professionalPanelDefaults(1440, 1), { materials: true, inspector: true });
  assert.deepEqual(professionalPanelDefaults(960, 1), { materials: true, inspector: false });
  assert.deepEqual(professionalPanelDefaults(960, 2), { materials: false, inspector: false });
});
