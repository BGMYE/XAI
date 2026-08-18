import assert from "node:assert/strict";
import test from "node:test";

const preview = await import("../src/state/studioStore.streamPreview.ts");

function makeWorkspace(overrides = {}) {
  return {
    id: "ws-a",
    name: "图片 1",
    prompt: "cat",
    negativePrompt: "",
    mode: "generate",
    size: "1024x1024",
    quality: "medium",
    outputFormat: "png",
    seed: 0,
    batchCount: 1,
    sources: [],
    currentImageId: "img-original",
    batchResultIds: [],
    resultGridOpen: false,
    runningJobIds: [],
    jobsTotal: 0,
    jobsCompleted: 0,
    progress: null,
    streamPreview: null,
    streamPreviews: {},
    lastLogLine: "",
    errorMessage: null,
    lastPayload: null,
    ...overrides,
  };
}

test("streamPreviewStatePatch creates transient current image without history persistence", () => {
  const state = {
    activeWorkspaceId: "ws-a",
    workspaces: [makeWorkspace()],
    currentImage: null,
    streamPreview: null,
    streamPreviews: {},
    compareB: { id: "b" },
    resultGridOpen: true,
    annotations: [{ id: "a" }],
    strokes: [{ points: [0, 0] }],
    maskDataURL: "data:image/png;base64,mask",
    tool: "mask",
  };
  const patch = preview.streamPreviewStatePatch(state, "job-a", {
    imageB64: "YWJj",
    partialImageIndex: 0,
    revisedPrompt: "rev",
  }, {
    workspaceId: "ws-a",
    mode: "generate",
    prompt: "cat",
    size: "1024x1024",
    quality: "medium",
    outputFormat: "png",
    currentImage: null,
  });

  assert.equal(patch.currentImage.id, "preview-job-a");
  assert.equal(patch.currentImage.previewOnly, true);
  assert.equal(patch.streamPreview.imageB64, "YWJj");
  assert.equal(patch.streamPreviews["job-a"].imageB64, "YWJj");
  assert.equal(patch.workspaces[0].streamPreview.partialImageIndex, 0);
  assert.equal(patch.resultGridOpen, false);
  assert.deepEqual(patch.annotations, []);
  assert.deepEqual(patch.strokes, []);
  assert.equal(patch.tool, "pan");
});

test("multi-job stream previews are accumulated by job id", () => {
  const baseState = {
    activeWorkspaceId: "ws-a",
    workspaces: [makeWorkspace({ jobsTotal: 9 })],
    currentImage: null,
    streamPreview: null,
    streamPreviews: {},
    compareB: null,
    resultGridOpen: true,
    annotations: [],
    strokes: [],
    maskDataURL: null,
    tool: "pan",
    jobsTotal: 9,
  };
  const firstPatch = preview.streamPreviewStatePatch(baseState, "job-a", {
    imageB64: "YQ==",
  }, {
    workspaceId: "ws-a",
    mode: "generate",
    prompt: "cat",
    size: "1024x1024",
    quality: "medium",
    outputFormat: "png",
    currentImage: null,
    batchIndex: 0,
  });
  const nextState = {
    ...baseState,
    ...firstPatch,
    workspaces: firstPatch.workspaces,
  };
  const secondPatch = preview.streamPreviewStatePatch(nextState, "job-b", {
    imageB64: "Yg==",
  }, {
    workspaceId: "ws-a",
    mode: "generate",
    prompt: "cat",
    size: "1024x1024",
    quality: "medium",
    outputFormat: "png",
    currentImage: null,
    batchIndex: 1,
  });

  assert.equal(Object.keys(secondPatch.streamPreviews).length, 2);
  assert.equal(secondPatch.streamPreviews["job-a"].imageB64, "YQ==");
  assert.equal(secondPatch.streamPreviews["job-b"].imageB64, "Yg==");
  assert.equal(secondPatch.resultGridOpen, true);
  assert.equal(secondPatch.currentImage, undefined);
});

test("workspace stream preview can be rehydrated when switching tabs", () => {
  const original = {
    id: "img-original",
    imageB64: "b3JpZw==",
    prompt: "old",
    mode: "generate",
    size: "1024x1024",
    quality: "medium",
    outputFormat: "png",
    createdAt: 1,
  };
  const workspace = makeWorkspace({
    streamPreview: {
      jobId: "job-a",
      imageB64: "cHJldmlldw==",
      revisedPrompt: "rev",
      updatedAt: 2,
    },
  });
  const item = preview.streamPreviewItemFromWorkspace(workspace, original);
  assert.equal(item.id, "preview-job-a");
  assert.equal(item.imageB64, "cHJldmlldw==");
  assert.equal(item.prompt, "cat");
  assert.equal(item.previewOnly, true);
});

test("active snapshot keeps persisted current image id when current image is only preview", () => {
  assert.equal(
    preview.currentImageIdForWorkspaceSnapshot(
      { id: "preview-job-a" },
      { jobId: "job-a", imageB64: "abc", updatedAt: 1 },
      "img-original",
    ),
    "img-original",
  );
  assert.equal(
    preview.currentImageIdForWorkspaceSnapshot(
      { id: "img-next" },
      { jobId: "job-a", imageB64: "abc", updatedAt: 1 },
      "img-original",
    ),
    "img-next",
  );
});
