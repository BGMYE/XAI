import assert from "node:assert/strict";
import test from "node:test";

const profiles = await import("../src/lib/profiles.ts");

function makeProfile(name) {
  return {
    id: name,
    name,
    apiMode: "responses",
    requestPolicy: "openai",
    baseURL: "",
    textModelID: "",
    imageModelID: "",
    reasoningEffort: "xhigh",
    concurrencyLimit: 0,
    createdAt: 1,
  };
}

test("default profile names start from 配置1 even when 主配置 exists", () => {
  assert.equal(profiles.nextDefaultProfileName([makeProfile("主配置")]), "配置1");
});

test("default profile names use the first available numeric slot", () => {
  assert.equal(
    profiles.nextDefaultProfileName([
      makeProfile("主配置"),
      makeProfile("配置1"),
      makeProfile("配置3"),
    ]),
    "配置2",
  );
});

test("blank profiles use sequential default names", () => {
  const existing = [makeProfile("配置1")];
  assert.equal(profiles.makeBlankProfile("images", existing).name, "配置2");
});

test("blank responses profile defaults reasoning effort to xhigh", () => {
  assert.equal(profiles.makeBlankProfile("responses").reasoningEffort, "xhigh");
});

test("new Images profiles target Sunburst with OpenAI standard requests", () => {
  const profile = profiles.makeBlankProfile("images");
  assert.equal(profile.baseURL, "https://img.740414025.xyz");
  assert.equal(profile.imageModelID, "gpt-image-2.5-sunburst");
  assert.deepEqual(profile.modelIDs, ["gpt-image-2.5-sunburst"]);
  assert.equal(profile.apiMode, "images");
  assert.equal(profile.requestPolicy, "openai");
  assert.equal(profile.imagesNewAPICompat, false);
  assert.equal(Object.hasOwn(profile, "apiKey"), false);
});

test("profile parsing keeps multiple custom model IDs while trimming and deduplicating", () => {
  const parsed = profiles.tryParseProfile({
    ...makeProfile("custom-models"),
    modelIDs: [" custom-image-a ", "custom-image-b", "custom-image-a", "", 42, "  "],
  });
  assert.deepEqual(parsed?.modelIDs, ["custom-image-a", "custom-image-b"]);
});

test("profile parsing omits malformed custom model metadata", () => {
  const parsed = profiles.tryParseProfile({ ...makeProfile("malformed-models"), modelIDs: "custom-image" });
  assert.equal(parsed?.modelIDs, undefined);
});

test("profile parsing strips credentials from persisted metadata", () => {
  const profile = profiles.tryParseProfile({ ...makeProfile("sunburst"), apiKey: "test-secret" });
  assert.equal(Object.hasOwn(profile, "apiKey"), false);
  assert.equal(JSON.stringify(profile).includes("test-secret"), false);
});

test("legacy profiles without reasoningEffort normalize to xhigh", () => {
  const parsed = profiles.tryParseProfile({
    id: "p1",
    name: "配置1",
    apiMode: "responses",
    requestPolicy: "openai",
    baseURL: "",
    textModelID: "",
    imageModelID: "",
    concurrencyLimit: 0,
    createdAt: 1,
  });
  assert.equal(parsed?.reasoningEffort, "xhigh");
});

test("legacy profiles preserve fallbackProfileId when present", () => {
  const parsed = profiles.tryParseProfile({
    id: "p1",
    name: "配置1",
    apiMode: "responses",
    requestPolicy: "openai",
    baseURL: "",
    textModelID: "",
    imageModelID: "",
    reasoningEffort: "xhigh",
    concurrencyLimit: 0,
    fallbackProfileId: "backup-profile",
    createdAt: 1,
  });
  assert.equal(parsed?.fallbackProfileId, "backup-profile");
});

test("AI profile selection stays independent from the active image profile", () => {
  const imageProfile = { ...makeProfile("image"), apiMode: "images" };
  const aiProfile = makeProfile("ai");
  assert.equal(profiles.pickAIProfile([imageProfile, aiProfile], "ai", "image")?.id, "ai");
});

test("AI profile selection falls back only to Responses profiles", () => {
  const firstImage = { ...makeProfile("image-a"), apiMode: "images" };
  const activeAI = makeProfile("responses-active");
  assert.equal(profiles.pickAIProfile([firstImage, activeAI], "missing", "responses-active")?.id, "responses-active");
  assert.equal(profiles.pickAIProfile([firstImage], "missing", "image-a"), null);
});
