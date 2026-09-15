import assert from "node:assert/strict";
import test from "node:test";
import { restoreHistorySources } from "../src/state/historyRegeneration.ts";

const source = (path) => ({ path, name: path.split("/").pop(), size: 0 });
const unusedMaterialize = async () => { throw new Error("unexpected materialization"); };

test("edit regeneration restores every recorded source in order rather than a different current image", async () => {
  const reads = [];
  const restored = await restoreHistorySources(
    { mode: "edit", sourcePaths: ["/original-a.png", "/original-b.png"], parentId: "/obsolete.png" },
    [{ id: "current-result", savedPath: "/unrelated.png" }],
    async (path) => { reads.push(path); return source(path); },
    unusedMaterialize,
  );
  assert.deepEqual(restored.map((image) => image.path), ["/original-a.png", "/original-b.png"]);
  assert.deepEqual(reads, ["/original-a.png", "/original-b.png"]);
});

test("legacy edit histories restore their parent path", async () => {
  const restored = await restoreHistorySources(
    { mode: "edit", parentId: "C:\\pictures\\original.png" }, [],
    async (path) => source(path), unusedMaterialize,
  );
  assert.equal(restored[0].path, "C:\\pictures\\original.png");
});

test("parent ids are resolved through history materialization", async () => {
  const parent = { id: "parent-result", imageB64: "saved-image" };
  const restored = await restoreHistorySources(
    { mode: "edit", parentId: parent.id }, [parent],
    async (path) => { assert.equal(path, "memory://restored-parent"); return source(path); },
    async (item) => { assert.equal(item, parent); return { ...item, savedPath: "memory://restored-parent" }; },
  );
  assert.equal(restored[0].path, "memory://restored-parent");
});

test("stale source paths can recover from a matching materialized history item", async () => {
  const parent = { id: "parent", savedPath: "memory://expired" };
  const restored = await restoreHistorySources(
    { mode: "edit", sourcePaths: [parent.savedPath] }, [parent],
    async (path) => { if (path === "memory://expired") throw new Error("expired"); return source(path); },
    async (item) => ({ ...item, savedPath: "memory://restored" }),
  );
  assert.equal(restored[0].path, "memory://restored");
});

test("missing original references stop regeneration instead of substituting another result", async () => {
  await assert.rejects(restoreHistorySources(
    { mode: "edit" }, [{ id: "current-result", savedPath: "/unrelated.png" }],
    async () => { assert.fail("must not read an unrelated result"); }, unusedMaterialize,
  ), /没有保存原参考图/);
  await assert.rejects(restoreHistorySources(
    { mode: "edit", sourcePaths: ["/available.png", "/missing.png"] }, [],
    async (path) => { if (path === "/missing.png") throw new Error("not found"); return source(path); },
    unusedMaterialize,
  ), /missing\.png.*已停止重新生成/);
});

test("text-to-image regeneration does not reuse any source reference", async () => {
  const restored = await restoreHistorySources(
    { mode: "generate", sourcePaths: ["/stale.png"], parentId: "/stale-parent.png" }, [],
    async () => { assert.fail("text generation must not read a reference"); }, unusedMaterialize,
  );
  assert.deepEqual(restored, []);
});
