import assert from "node:assert/strict";
import test from "node:test";

const templateInsert = await import("../src/lib/promptTemplateInsert.ts");

test("appendPromptTemplateText appends with comma when prompt already has content", () => {
  assert.equal(
    templateInsert.appendPromptTemplateText("主体，夜景", "cinematic rim light"),
    "主体，夜景, cinematic rim light",
  );
});

test("appendPromptTemplateText uses template text directly when prompt is empty", () => {
  assert.equal(
    templateInsert.appendPromptTemplateText("   ", "cinematic rim light"),
    "cinematic rim light",
  );
});

test("appendPromptTemplateText ignores blank template text", () => {
  assert.equal(
    templateInsert.appendPromptTemplateText("主体", "   "),
    "主体",
  );
});
