import assert from "node:assert/strict";
import test from "node:test";

const realLocalStorage = globalThis.localStorage;

function installStorage() {
  const store = new Map();
  globalThis.localStorage = {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
  };
  return store;
}

test.afterEach(() => {
  globalThis.localStorage = realLocalStorage;
});

test("save prompt suppression can be disabled and re-enabled", async () => {
  const store = installStorage();
  const pref = await import("../src/lib/savePromptPreference.ts");

  assert.equal(pref.readSavePromptSuppressed(), false);

  pref.writeSavePromptSuppressed(true);
  assert.equal(pref.readSavePromptSuppressed(), true);
  assert.equal(store.get(pref.savePromptSuppressedStorageKey()), "1");

  pref.writeSavePromptSuppressed(false);
  assert.equal(pref.readSavePromptSuppressed(), false);
  assert.equal(store.has(pref.savePromptSuppressedStorageKey()), false);
});

test("completion sound can be disabled and re-enabled without stale custom state", async () => {
  installStorage();
  const completionSound = await import("../src/lib/completionSound.ts");

  completionSound.persistCompletionSoundConfig({
    enabled: false,
    mode: "custom",
    customName: "ding.wav",
    customDataURL: "data:audio/wav;base64,AA==",
  });

  assert.deepEqual(completionSound.readCompletionSoundConfig(), {
    enabled: false,
    mode: "custom",
    customName: "ding.wav",
    customDataURL: "data:audio/wav;base64,AA==",
  });

  completionSound.persistCompletionSoundConfig({
    enabled: true,
    mode: "default",
    customName: "",
    customDataURL: "",
  });

  assert.deepEqual(completionSound.readCompletionSoundConfig(), {
    enabled: true,
    mode: "default",
    customName: "",
    customDataURL: "",
  });
});
