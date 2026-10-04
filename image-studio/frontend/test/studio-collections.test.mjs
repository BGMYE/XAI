import assert from "node:assert/strict";
import test from "node:test";
import { normalizeProjectCollections, normalizeSnapshotCollections, normalizeChangeSetCollections } from "../src/studio/snapshotCollections.mjs";
import { applyChanges } from "../src/studio/sync.mjs";
import { newProject, orderGraph } from "../src/studio/graph.mjs";

const snapshot = (projects = []) => ({ epoch: "e", revision: 1, profiles: [], projects, jobs: [], assets: [], promptCards: [] });
test("legacy null projects are safe for the home page, workflow list and graph editor", () => {
  const old = { ...newProject("Legacy"), nodes: null, edges: null };
  const clean = normalizeSnapshotCollections(snapshot([old]));
  assert.equal(clean.projects[0].nodes.some((node) => node.kind === "image"), false);
  assert.equal(clean.projects[0].edges.length, 0);
  assert.deepEqual(orderGraph(clean.projects[0]), []);
  assert.equal(old.nodes, null, "source data is not mutated");
});
test("null collections from full and incremental responses normalize before synchronization", () => {
  const old = { ...newProject("Imported"), id: "classic", nodes: null, edges: null };
  for (const full of [false, true]) {
    const changes = normalizeChangeSetCollections({ ...snapshot([old]), revision: 2, full, removed: {}, progress: {} });
    const next = applyChanges(snapshot(), changes);
    assert.deepEqual(next.projects[0].nodes, []);
    assert.deepEqual(next.projects[0].edges, []);
  }
  const empty = normalizeSnapshotCollections({ profiles: null, projects: null, assets: null, jobs: null });
  assert.deepEqual(empty, { profiles: [], projects: [], assets: [], jobs: [], promptCards: [] });
});
test("valid collections preserve identities, malformed data is rejected without erasure", () => {
  const project = newProject("Untouched");
  const current = snapshot([project]);
  assert.equal(normalizeSnapshotCollections(current), current);
  assert.equal(normalizeProjectCollections(project), project);
  assert.throws(() => normalizeProjectCollections({ ...project, nodes: { unexpected: true } }), /格式异常/);
  assert.equal(project.nodes.length, 0);
});
