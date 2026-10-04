import assert from "node:assert/strict";
import test from "node:test";

const realWindow = globalThis.window;
const realLocalStorage = globalThis.localStorage;

function installStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
  return store;
}

// A fake desktop registry with the semantics the Go engine implements.
function installRegistry({ keys = {} } = {}) {
  const profiles = new Map();
  const retired = new Set();
  const calls = [];
  const studio = {
    async ListProfiles() {
      return [...profiles.values()].map((p) => ({ ...p }));
    },
    async SaveProfile(p, key) {
      calls.push(["SaveProfile", p.id, key]);
      const old = profiles.get(p.id);
      const saved = {
        ...p,
        hasKey: Boolean(key) || Boolean(old?.hasKey),
        createdAt: old?.createdAt ?? p.createdAt,
        updatedAt: "now",
      };
      if (key) keys[p.id] = key;
      profiles.set(p.id, saved);
      return { ...saved };
    },
    async DeleteProfile(id) {
      profiles.delete(id);
      retired.add(id);
      delete keys[id];
    },
    async DuplicateProfile(id) {
      const copy = { ...profiles.get(id), id: `${id}-copy`, name: `${profiles.get(id).name} · 副本` };
      keys[copy.id] = keys[id];
      profiles.set(copy.id, copy);
      return { ...copy };
    },
    async GetProfileKey(id) {
      return keys[id] ?? "";
    },
    async ClearProfileKey(id) {
      delete keys[id];
      const p = { ...profiles.get(id), hasKey: false };
      profiles.set(id, p);
      return p;
    },
    async ImportClassicProfiles(list) {
      calls.push(["ImportClassicProfiles", list.length]);
      let n = 0;
      for (const p of list) {
        if (profiles.has(p.id) || retired.has(p.id)) continue;
        profiles.set(p.id, { ...p, hasKey: Boolean(keys[p.id]) });
        n++;
      }
      return n;
    },
    async SetNetworkProxy(mode, url) {
      calls.push(["SetNetworkProxy", mode, url]);
      return { proxyMode: mode, proxyUrl: url };
    },
  };
  globalThis.window = { go: { backend: { StudioV2: studio } } };
  return { profiles, calls, keys };
}

async function freshModule() {
  return import(`../src/lib/upstreamRegistry.ts?case=${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

const classic = (id, extra = {}) => ({
  id,
  name: `配置 ${id}`,
  apiMode: "images",
  responsesTransport: "sse",
  requestPolicy: "openai",
  imagesNewAPICompat: false,
  allowInsecureConnection: false,
  baseURL: "https://img.example.com",
  textModelID: "",
  imageModelID: "gpt-image-2",
  modelIDs: ["gpt-image-2"],
  videoModelID: "",
  reasoningEffort: "xhigh",
  concurrencyLimit: 2,
  createdAt: 1700000000000,
  ...extra,
});

test.afterEach(() => {
  globalThis.window = realWindow;
  globalThis.localStorage = realLocalStorage;
});

test("classic profiles convert to the shared shape and back without loss", async () => {
  const mod = await freshModule();
  const original = classic("a", {
    apiMode: "responses",
    responsesTransport: "websocket",
    requestPolicy: "compat",
    imagesNewAPICompat: true,
    allowInsecureConnection: true,
    textModelID: "gpt-5.5",
    videoModelID: "sora-2",
    reasoningEffort: "medium",
    fallbackProfileId: "b",
  });
  const shared = mod.toRegistryProfile(original);
  assert.equal(shared.protocol, "openai");
  assert.equal(shared.imageApi, "responses");
  assert.equal(shared.createdAt, new Date(original.createdAt).toISOString());
  const back = mod.toClassicProfile({ ...shared, hasKey: true, updatedAt: "x" }, 42);
  assert.deepEqual(back, { ...original, lastUsedAt: 42 });
});

test("local upstreams keep working and long names fit the registry", async () => {
  const mod = await freshModule();
  assert.equal(mod.toRegistryProfile(classic("a", { baseURL: "http://127.0.0.1:3000/" })).allowLocal, true);
  assert.equal(mod.toRegistryProfile(classic("a", { baseURL: "http://localhost:3000" })).allowLocal, true);
  assert.equal(
    mod.toRegistryProfile(classic("a", { baseURL: "http://api.localhost:3000" })).allowLocal,
    true,
  );
  assert.equal(
    mod.toRegistryProfile(classic("a", { baseURL: "https://localhost:8443/v1" })).allowLocal,
    true,
  );
  assert.equal(mod.toRegistryProfile(classic("a", { baseURL: "https://img.example.com" })).allowLocal, false);
  const name = mod.toRegistryProfile(classic("a", { name: "图".repeat(100) })).name;
  assert.ok(new TextEncoder().encode(name).length <= 160 && name.length === 53);
});

test("the desktop imports stored classic profiles and then reads the registry", async () => {
  installStorage({ "gptcodex.profiles": JSON.stringify([classic("a"), classic("b")]) });
  const fake = installRegistry({ keys: { a: "sk-a" } });
  fake.profiles.set("x", {
    id: "x",
    name: "xAI",
    protocol: "xai",
    baseUrl: "https://api.x.ai/v1",
    imageModel: "grok",
    videoModel: "",
    hasKey: true,
    allowLocal: false,
    updatedAt: "",
  });
  const mod = await freshModule();
  const list = await mod.syncClassicProfiles([classic("a"), classic("b")]);
  assert.deepEqual(list.map((p) => p.id).sort(), ["a", "b"], "xAI profiles stay Studio-only");
  assert.equal(mod.registryActive(), true);
  assert.equal(await mod.readProfileKey("a", async () => "legacy"), "sk-a");
  // Deleted profiles are never imported again from the stale local copy.
  await mod.deleteRegistryProfile("b");
  await mod.syncClassicProfiles([classic("a"), classic("b")]);
  assert.equal(fake.profiles.has("b"), false);
});

test("without the desktop registry the classic editor keeps its own storage", async () => {
  installStorage();
  globalThis.window = { go: { backend: { Service: {} } } };
  const mod = await freshModule();
  assert.equal(await mod.syncClassicProfiles([classic("a")]), null);
  assert.equal(mod.registryActive(), false);
  assert.equal(await mod.readProfileKey("a", async () => "legacy"), "legacy");
});

test("a registry that cannot be used says why and leaves browser storage in charge", async () => {
  installStorage();
  const fake = installRegistry();
  fake.profiles.set("a", { id: "a", protocol: "openai" });
  window.go.backend.StudioV2.ImportClassicProfiles = async () => {
    throw new Error("工作室数据无法打开");
  };
  const mod = await freshModule();
  const reasons = [];
  assert.equal(await mod.syncClassicProfiles([classic("a")], (reason) => reasons.push(reason)), null);
  assert.deepEqual(reasons, ["工作室数据无法打开"]);
  assert.equal(mod.registryActive(), false);
  assert.equal(await mod.readProfileKey("a", async () => "legacy"), "legacy");
});

test("saving keeps fields the classic editor does not show", async () => {
  installStorage();
  const fake = installRegistry();
  fake.profiles.set("a", {
    ...(await freshModule()).toRegistryProfile(classic("a")),
    allowLocal: true,
    hasKey: true,
    updatedAt: "",
  });
  const mod = await freshModule();
  await mod.loadRegistryProfiles();
  const saved = await mod.saveRegistryProfile({ ...classic("a"), name: "renamed", lastUsedAt: 7 });
  assert.equal(fake.profiles.get("a").allowLocal, true);
  assert.equal(saved.name, "renamed");
  assert.equal(saved.lastUsedAt, 7);
  assert.deepEqual(fake.calls.at(-1), ["SaveProfile", "a", ""]);
});

test("the proxy setting is shared once at startup and debounced while typing", async () => {
  installStorage({ "gptcodex.proxyMode": "custom", "gptcodex.proxyURL": "http://127.0.0.1:7890" });
  const fake = installRegistry();
  const mod = await freshModule();
  await mod.prepareSharedUpstreams();
  await mod.prepareSharedUpstreams();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(
    fake.calls.filter((c) => c[0] === "SetNetworkProxy"),
    [["SetNetworkProxy", "custom", "http://127.0.0.1:7890"]],
  );
  mod.shareProxySetting({ mode: "custom", url: "http://127.0.0.1:1" }, 5);
  mod.shareProxySetting({ mode: "custom", url: "http://127.0.0.1:12" }, 5);
  mod.shareProxySetting({ mode: "system", url: "ignored" }, 5);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(fake.calls.filter((c) => c[0] === "SetNetworkProxy").at(-1), [
    "SetNetworkProxy",
    "system",
    "",
  ]);
  assert.equal(fake.calls.filter((c) => c[0] === "SetNetworkProxy").length, 2);
});
