import test from "node:test";
import assert from "node:assert/strict";
import { createLegacyMigration } from "../src/studio/legacyMigrationPlan.mjs";

test("Studio restores compatibility before upstream/history import and persists only migration IDs once", async () => {
  const calls = [];
  const local = [{ id: "saved", sharedJobId: "existing" }, { id: "legacy", savedPath: "/original.png", image: { original: true } }];
  const migration = createLegacyMigration({
    async restoreCompatibility() { calls.push("restore"); },
    async prepareUpstreams() { calls.push("upstreams"); },
    async withHistoryLock(action) { calls.push("lock"); return action(); },
    async loadHistory() { calls.push("load"); return local; },
    async importHistory(history) { assert.equal(history, local); return [history[0], { ...history[1], sharedJobId: "imported" }]; },
    async persistHistory(changed) {
      calls.push("persist");
      assert.equal(changed.length, 1);
      assert.equal(changed[0].savedPath, "/original.png");
      assert.equal(changed[0].image, local[1].image);
      assert.equal(changed[0].sharedJobId, "imported");
    },
  });
  await Promise.all([migration.prepare(), migration.prepare()]);
  await migration.prepare();
  assert.deepEqual(calls, ["restore", "upstreams", "lock", "load", "persist"]);
  assert.equal(local[1].sharedJobId, undefined);
  assert.equal(migration.takeWarning(), "");
});

test("migration failure remains visible and does not block Studio or overwrite old history", async () => {
  let writes = 0;
  const migration = createLegacyMigration({
    async restoreCompatibility() { throw Error("unavailable"); },
    async prepareUpstreams() {},
    async withHistoryLock(action) { return action(); },
    async loadHistory() { return [{ id: "original", savedPath: "/original.png" }]; },
    async importHistory() { throw Error("disk read failed"); },
    async persistHistory() { writes++; },
  });
  await migration.prepare();
  const warning = migration.takeWarning();
  assert.match(warning, /旧版备份/);
  assert.match(warning, /原文件和本地记录已保留/);
  assert.equal(writes, 0);
  assert.equal(migration.takeWarning(), "");
});

test("partial migration records successful IDs and reports missing original files", async () => {
  const local = [{ id: "good", savedPath: "/good.png" }, { id: "missing", imageB64: "preserved" }];
  let written;
  const migration = createLegacyMigration({
    async restoreCompatibility() {},
    async prepareUpstreams() {},
    async withHistoryLock(action) { return action(); },
    async loadHistory() { return local; },
    async importHistory(history) { return [{ ...history[0], sharedJobId: "job" }, history[1]]; },
    async persistHistory(history) { written = history; },
  });
  await migration.prepare();
  assert.deepEqual(written, [{ id: "good", savedPath: "/good.png", sharedJobId: "job" }]);
  assert.match(migration.takeWarning(), /1 条旧历史没有可定位的原文件/);
  assert.equal(local[1].imageB64, "preserved");
});
