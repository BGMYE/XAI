import assert from "node:assert/strict";
import test from "node:test";
import { acceptDesktopDroppedImages } from "../src/app/hooks/desktopDrop.ts";

test("native drops import a mixed batch in order and report rejected files afterwards", async () => {
  const sequence = [];
  await acceptDesktopDroppedImages({
    images: [{ path: "managed/a.png", name: "first.png", size: 12 }, { path: "managed/b.png", name: "second.png", size: 24 }],
    errors: ["document.txt：仅支持 PNG、JPG 和 WebP 图片"],
  }, async (image, name, size) => {
    await Promise.resolve();
    sequence.push([image.path, name, size]);
  }, (error) => sequence.push(error));
  assert.deepEqual(sequence, [
    ["managed/a.png", "first.png", 12],
    ["managed/b.png", "second.png", 24],
    "document.txt：仅支持 PNG、JPG 和 WebP 图片",
  ]);
});
