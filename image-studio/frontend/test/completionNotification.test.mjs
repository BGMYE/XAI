import assert from "node:assert/strict";
import test from "node:test";

const realLocalStorage = globalThis.localStorage;
const realNotification = globalThis.Notification;
const realWindow = globalThis.window;

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
  globalThis.Notification = realNotification;
  globalThis.window = realWindow;
});

test("completion notification persists enabled state", async () => {
  const store = installStorage();
  const completionNotification = await import("../src/lib/completionNotification.ts");

  completionNotification.persistCompletionNotificationConfig({ enabled: false });
  assert.deepEqual(completionNotification.readCompletionNotificationConfig(), { enabled: false });
  assert.equal(store.get("gptcodex.completionNotification.enabled"), "0");

  completionNotification.persistCompletionNotificationConfig({ enabled: true });
  assert.deepEqual(completionNotification.readCompletionNotificationConfig(), { enabled: true });
  assert.equal(store.get("gptcodex.completionNotification.enabled"), "1");
});

test("completion notification only fires for the final hidden task", async () => {
  const completionNotification = await import("../src/lib/completionNotification.ts");

  assert.equal(completionNotification.shouldSendCompletionNotification({
    config: { enabled: true },
    completedNow: 1,
    totalNow: 3,
    windowHidden: true,
  }), false);

  assert.equal(completionNotification.shouldSendCompletionNotification({
    config: { enabled: true },
    completedNow: 3,
    totalNow: 3,
    windowHidden: false,
  }), false);

  assert.equal(completionNotification.shouldSendCompletionNotification({
    config: { enabled: true },
    completedNow: 3,
    totalNow: 3,
    windowHidden: true,
  }), true);
});

test("system notification only shows after permission is granted", async () => {
  const seen = [];
  globalThis.window = { focus() {} };
  globalThis.Notification = class MockNotification {
    static permission = "granted";
    static async requestPermission() {
      return this.permission;
    }
    constructor(title, options) {
      seen.push({ title, body: options.body });
      this.onclick = null;
    }
    close() {}
  };

  const completionNotification = await import("../src/lib/completionNotification.ts");
  assert.equal(completionNotification.showSystemNotification("done", "body"), true);
  assert.deepEqual(seen, [{ title: "done", body: "body" }]);

  globalThis.Notification.permission = "denied";
  assert.equal(completionNotification.showSystemNotification("blocked", "body"), false);
  assert.equal(seen.length, 1);
});
