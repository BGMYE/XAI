import assert from "node:assert/strict";
import test from "node:test";
import { browserStoredAPIKey, setBrowserStoredAPIKey } from "../src/platform/runtime/hostBrowser.ts";

test("browser credential fallback removes legacy plaintext and refuses new secrets", () => {
  const previousStorage = globalThis.localStorage;
  const values = new Map([["image-studio.browser-key.profile:test", "legacy-secret"]]);
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  try {
    assert.equal(browserStoredAPIKey("profile:test"), "");
    assert.equal(values.size, 0);
    assert.throws(() => setBrowserStoredAPIKey("profile:test", "new-secret"), /系统凭据存储/);
    assert.equal(values.size, 0);
    assert.doesNotThrow(() => setBrowserStoredAPIKey("profile:test", ""));
  } finally {
    globalThis.localStorage = previousStorage;
  }
});
