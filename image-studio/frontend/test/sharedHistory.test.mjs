import assert from "node:assert/strict";
import test from "node:test";
import { importSharedHistory, mergeSharedHistory, deleteSharedHistory } from "../src/state/sharedHistory.ts";
import { applyChanges } from "../src/studio/sync.mjs";

test("shared history keeps local annotations, removes deleted jobs and recovers new results", () => {
  const old = [
    { id: "local", sharedJobId: "a", createdAt: 1, favorite: true },
    { id: "gone", sharedJobId: "removed" },
    { id: "unimported", createdAt: 2 },
  ];
  const merged = mergeSharedHistory(old, [
    { jobId: "a", assetId: "asset", createdAt: "2026-10-01T00:00:00Z", prompt: "prompt" },
    { jobId: "new", assetId: "new-asset", createdAt: "2026-10-02T00:00:00Z" },
  ]);
  assert.deepEqual(
    merged.map((x) => x.id),
    ["new", "local", "unimported"],
  );
  assert.equal(merged[1].favorite, true);
});

test("legacy import sends metadata only, retains failed items, and uses stable IDs for deletion", async () => {
  const previous = globalThis.window;
  const calls = [];
  const errors = [];
  globalThis.window = {
    go: {
      backend: {
        Service: {
          async ImportClassicHistory(items) {
            calls.push(items);
            return [
              { id: "one", jobId: "legacy-one", assetId: "asset" },
              { id: "bad", error: "file missing" },
            ];
          },
          async DeleteGenerationHistory(ids) {
            calls.push(ids);
          },
        },
      },
    },
  };
  try {
    const local = [
      {
        id: "one",
        createdAt: 1,
        savedPath: "one.png",
        prompt: "prompt",
        mode: "edit",
        revisedPrompt: "revised",
        imageB64: "very-large",
        size: "auto",
      },
      { id: "bad", createdAt: 2, savedPath: "bad.png" },
    ];
    const imported = await importSharedHistory(local, (error) => errors.push(error));
    assert.equal(calls[0][0].imageB64, undefined);
    assert.equal(calls[0][0].id, "one");
    assert.equal(calls[0][0].mode, "edit");
    assert.equal(calls[0][0].revisedPrompt, "revised");
    assert.equal(imported[0].sharedJobId, "legacy-one");
    assert.equal(imported[1].sharedJobId, undefined);
    assert.match(errors[0], /1/);
    await deleteSharedHistory(imported);
    assert.deepEqual(calls[1], ["legacy-one"]);
  } finally {
    globalThis.window = previous;
  }
});

test("incremental deletion drops projects, assets and jobs without a full snapshot", () => {
  const base = {
    epoch: "e",
    revision: 1,
    projects: [{ id: "p" }],
    assets: [{ id: "a" }],
    jobs: [{ id: "j" }],
    profiles: [],
    promptCards: [],
  };
  const next = applyChanges(base, {
    epoch: "e",
    revision: 2,
    removed: { projects: ["p"], assets: ["a"], jobs: ["j"] },
  });
  assert.equal(next.projects.length + next.assets.length + next.jobs.length, 0);
});
