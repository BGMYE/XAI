import assert from "node:assert/strict";
import test from "node:test";

const savePromptState = await import("../src/lib/savePromptState.ts");

function makeItem(id, createdAt) {
  return {
    id,
    prompt: `prompt-${id}`,
    mode: "generate",
    size: "1024x1024",
    quality: "medium",
    createdAt,
  };
}

test("normalizeSavePromptRequestForTest keeps batch items in request order", () => {
  const one = makeItem("one", 1);
  const two = makeItem("two", 2);
  const request = savePromptState.normalizeSavePromptRequest({
    kind: "batch",
    items: [two, one],
    workspaceId: "ws-1",
  });

  assert.equal(request?.kind, "batch");
  assert.deepEqual(request?.items.map((item) => item.id), ["two", "one"]);
});

test("normalizeSavePromptRequest keeps single requests intact", () => {
  const one = makeItem("one", 1);
  const request = savePromptState.normalizeSavePromptRequest({
    kind: "single",
    item: one,
  });

  assert.equal(request?.kind, "single");
  assert.equal(request?.item.id, "one");
});

test("normalizeSavePromptRequest rejects empty batch requests", () => {
  const request = savePromptState.normalizeSavePromptRequest({
    kind: "batch",
    items: [],
    workspaceId: "ws-1",
  });

  assert.equal(request, null);
});
