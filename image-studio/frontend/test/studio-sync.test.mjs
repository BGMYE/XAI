import test from "node:test";
import assert from "node:assert/strict";
import { applyChanges, setJobProgress, withProgress } from "../src/studio/sync.mjs";

const job = (id, createdAt, state = "running", progress = 0) => ({ id, createdAt, state, progress });
const card = (id, updatedAt) => ({ id, updatedAt, title: id });
const base = () => ({
  epoch: "e1",
  revision: 4,
  profiles: [{ id: "p1", name: "B" }],
  projects: [{ id: "c1", updatedAt: "2026-10-01T00:00:00Z" }],
  assets: [{ id: "a1", createdAt: "2026-10-01T00:00:00Z" }],
  jobs: [job("j1", "2026-10-01T00:00:00Z")],
  promptCards: [card("k1", "2026-10-01T00:00:00Z")],
});
const delta = (patch) => ({
  epoch: "e1",
  revision: 4,
  full: false,
  profiles: [],
  projects: [],
  assets: [],
  jobs: [],
  promptCards: [],
  removed: { profiles: [], promptCards: [] },
  progress: {},
  ...patch,
});

test("studio sync: an empty delta keeps the snapshot and every collection", () => {
  const s = base();
  assert.equal(applyChanges(s, delta({ progress: { j1: 0 } })), s);
});

test("studio sync: changes replace entities in backend order and keep untouched lists", () => {
  const s = base();
  const next = applyChanges(
    s,
    delta({
      revision: 6,
      profiles: [{ id: "p2", name: "A" }],
      jobs: [
        job("j2", "2026-10-02T00:00:00Z", "queued"),
        { ...s.jobs[0], state: "succeeded", progress: 100 },
      ],
      removed: { profiles: [], promptCards: ["k1"] },
    }),
  );
  assert.equal(next.revision, 6);
  assert.deepEqual(
    next.profiles.map((p) => p.name),
    ["A", "B"],
  );
  assert.deepEqual(
    next.jobs.map((j) => [j.id, j.state]),
    [
      ["j2", "queued"],
      ["j1", "succeeded"],
    ],
  );
  assert.deepEqual(next.promptCards, []);
  assert.equal(next.projects, s.projects, "unchanged collections keep their identity");
  assert.equal(next.assets, s.assets);
  assert.equal(s.jobs[0].state, "running", "the previous snapshot is not modified");
});

test("studio sync: a full change set replaces everything", () => {
  const s = base();
  const next = applyChanges(
    s,
    delta({
      epoch: "e2",
      revision: 1,
      full: true,
      jobs: [job("j9", "2026-10-03T00:00:00Z")],
      progress: { j9: 40 },
    }),
  );
  assert.equal(next.epoch, "e2");
  assert.deepEqual(next.profiles, []);
  assert.equal(next.jobs[0].progress, 40);
});

test("studio sync: progress applies only to running jobs and copies only what changes", () => {
  const jobs = [job("run", "2", "running", 10), job("done", "1", "succeeded", 100)];
  assert.equal(withProgress(jobs, { done: 50, missing: 3, run: 10 }), jobs);
  const next = withProgress(jobs, { run: 55 });
  assert.equal(next[0].progress, 55);
  assert.equal(next[1], jobs[1]);
  assert.equal(jobs[0].progress, 10);
  const s = base();
  assert.equal(setJobProgress(s, "j1", 0), s);
  assert.equal(setJobProgress(s, "j1", 30).jobs[0].progress, 30);
});
