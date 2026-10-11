import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

const realFetch = globalThis.fetch;
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;

async function withPatchedGlobals(setup, run) {
  try {
    await setup();
    return await run();
  } finally {
    globalThis.fetch = realFetch;
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
  }
}

function immediateTimers() {
  globalThis.setTimeout = (fn, _ms, ...args) => {
    queueMicrotask(() => fn(...args));
    return 0;
  };
  globalThis.clearTimeout = () => {};
}

function headerValue(init, name) {
  const headers = init.headers;
  if (!headers) return null;
  if (headers instanceof Headers) return headers.get(name);
  if (Array.isArray(headers)) {
    const found = headers.find(([key]) => String(key).toLowerCase() === name.toLowerCase());
    return found ? found[1] : null;
  }
  return headers[name] ?? headers[name.toLowerCase()] ?? null;
}

async function readBodyText(body) {
  if (body == null) return "";
  if (typeof body === "string") return body;
  if (body instanceof ArrayBuffer) return Buffer.from(body).toString("utf8");
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength).toString("utf8");
  if (typeof body.text === "function") return await body.text();
  if (typeof body.arrayBuffer === "function") {
    return Buffer.from(await body.arrayBuffer()).toString("utf8");
  }
  return String(body);
}

async function readBodyBuffer(body) {
  if (body == null) return Buffer.alloc(0);
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  if (typeof body.arrayBuffer === "function") return Buffer.from(await body.arrayBuffer());
  return Buffer.from(await readBodyText(body));
}

test("responses proxy preserves an uncertain 524 without replaying generation", async () => {
  const seen = [];
  await withPatchedGlobals(async () => {
    immediateTimers();
    let call = 0;
    globalThis.fetch = async (url, init) => {
      call += 1;
      seen.push({ url: String(url), init });
      if (call === 1) {
        return new Response("<html>Error code 524 | 524: A timeout occurred</html>", {
          status: 524,
          headers: { "content-type": "text/html" },
        });
      }
      return new Response(
        'data: {"type":"response.output_item.done","item":{"type":"image_generation_call","result":"abc"}}\n',
        {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        },
      );
    };
  }, async () => {
    const request = new Request("https://worker.example/v1/responses", {
      method: "POST",
      headers: {
        authorization: "Bearer test-key",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        apiMode: "responses",
        prompt: "a red cat",
      }),
    });
    const response = await worker.fetch(request, {
      IMAGE_STUDIO_UPSTREAM_BASE_URL: "https://upstream.example",
    });
    const text = await response.text();
    assert.equal(response.status, 524);
    assert.match(text, /524/);
    assert.equal(response.headers.get("x-image-studio-generation-status"), "uncertain");
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, "https://upstream.example/v1/responses");
  });
});

test("images generations path proxies raw OpenAI request body", async () => {
  let captured = null;
  await withPatchedGlobals(async () => {
    globalThis.fetch = async (url, init) => {
      captured = {
        url: String(url),
        method: init.method,
        contentType: headerValue(init, "content-type"),
        body: JSON.parse(await readBodyText(init.body)),
      };
      return new Response('{"data":[{"b64_json":"xyz"}]}', {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
  }, async () => {
    const request = new Request("https://worker.example/v1/images/generations", {
      method: "POST",
      headers: {
        authorization: "Bearer test-key",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-image-2",
        prompt: "blue bird",
        size: "1024x1024",
      }),
    });
    const response = await worker.fetch(request, {
      IMAGE_STUDIO_UPSTREAM_BASE_URL: "https://upstream.example",
    });
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(await response.text()), { data: [{ b64_json: "xyz" }] });
    assert.equal(captured.url, "https://upstream.example/v1/images/generations");
    assert.equal(captured.method, "POST");
    assert.equal(captured.contentType, "application/json");
    assert.equal(captured.body.prompt, "blue bird");
  });
});

test("images edits path preserves multipart content-type and body", async () => {
  let captured = null;
  await withPatchedGlobals(async () => {
    globalThis.fetch = async (url, init) => {
      const raw = await readBodyBuffer(init.body);
      captured = {
        url: String(url),
        method: init.method,
        contentType: headerValue(init, "content-type"),
        length: raw.length,
        preview: raw.toString("utf8", 0, Math.min(raw.length, 120)),
      };
      return new Response('{"data":[{"b64_json":"edited"}]}', {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
  }, async () => {
    const form = new FormData();
    form.append("image", new Blob(["png-bytes"], { type: "image/png" }), "source.png");
    form.append("prompt", "make it orange");
    const request = new Request("https://worker.example/v1/images/edits", {
      method: "POST",
      headers: {
        authorization: "Bearer test-key",
      },
      body: form,
    });
    const response = await worker.fetch(request, {
      IMAGE_STUDIO_UPSTREAM_BASE_URL: "https://upstream.example",
    });
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(await response.text()), { data: [{ b64_json: "edited" }] });
    assert.equal(captured.url, "https://upstream.example/v1/images/edits");
    assert.equal(captured.method, "POST");
    assert.match(captured.contentType, /^multipart\/form-data; boundary=/);
    assert.ok(captured.length > 0);
    assert.match(captured.preview, /form-data/);
  });
});

test("prompt optimize endpoint forwards shared prompt-optimize payload", async () => {
  let captured = null;
  await withPatchedGlobals(async () => {
    globalThis.fetch = async (url, init) => {
      captured = {
        url: String(url),
        method: init.method,
        contentType: headerValue(init, "content-type"),
        body: JSON.parse(await readBodyText(init.body)),
      };
      return new Response('{"output_text":"optimized prompt"}', {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
  }, async () => {
    const request = new Request("https://worker.example/kernel/prompt-optimize", {
      method: "POST",
      headers: {
        authorization: "Bearer test-key",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        baseURL: "https://upstream.example",
        prompt: "cat",
        mode: "generate",
        textModelID: "gpt-5.5",
        sourceDataURLs: ["data:image/png;base64,AAAA"],
      }),
    });
    const response = await worker.fetch(request, {
      IMAGE_STUDIO_UPSTREAM_BASE_URL: "",
    });
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(await response.text()), { output_text: "optimized prompt" });
    assert.equal(captured.url, "https://upstream.example/v1/responses");
    assert.equal(captured.method, "POST");
    assert.equal(captured.contentType, "application/json");
    assert.equal(captured.body.model, "gpt-5.5");
    assert.equal(captured.body.input[0].content[1].type, "input_image");
  });
});

test("kernel generate keeps requestPolicy for shared payload building", async () => {
  let captured = null;
  await withPatchedGlobals(async () => {
    globalThis.fetch = async (url, init) => {
      captured = {
        url: String(url),
        body: JSON.parse(await readBodyText(init.body)),
      };
      return new Response(
        'data: {"type":"response.output_item.done","item":{"type":"image_generation_call","result":"abc"}}\n',
        {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        },
      );
    };
  }, async () => {
    const request = new Request("https://worker.example/kernel/generate", {
      method: "POST",
      headers: {
        authorization: "Bearer test-key",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        apiMode: "responses",
        requestPolicy: "compat",
        prompt: "a red cat",
        size: "1024x1024",
        quality: "low",
        outputFormat: "png",
        seed: 123,
        negativePrompt: "avoid blur",
      }),
    });
    const response = await worker.fetch(request, {
      IMAGE_STUDIO_UPSTREAM_BASE_URL: "https://upstream.example",
    });
    assert.equal(response.status, 200);
    assert.equal(captured.url, "https://upstream.example/v1/responses");
    assert.ok(captured.body.instructions.includes("VERBATIM"));
    assert.equal(captured.body.tools[0].seed, 123);
    assert.equal(captured.body.tools[0].negative_prompt, "avoid blur");
  });
});

test("kernel generate carries assisted mode, exact API root, and request ID", async () => {
  let captured;
  await withPatchedGlobals(async () => {
    globalThis.fetch = async (url, init) => {
      captured = { url: String(url), body: JSON.parse(init.body) };
      return new Response('data: {"type":"response.completed"}\n\n', {
        headers: { "content-type": "text/event-stream", "x-request-id": "req-preserved" },
      });
    };
  }, async () => {
    const response = await worker.fetch(new Request("https://worker.example/kernel/generate", {
      method: "POST",
      headers: { authorization: "Bearer test-key", "content-type": "application/json" },
      body: JSON.stringify({ baseURL: "https://upstream.example/api/v3", prompt: "  原文  ", promptMode: "assisted" }),
    }), {});
    assert.equal(captured.url, "https://upstream.example/api/v3/responses");
    assert.equal(captured.body.input[0].content[0].text, "  原文  ");
    assert.match(captured.body.instructions, /exact requested text/);
    assert.deepEqual(captured.body.tool_choice, { type: "image_generation" });
    assert.equal(response.headers.get("x-request-id"), "req-preserved");
  });
});

test("worker never replays a generation after a network failure", async () => {
  let calls = 0;
  await withPatchedGlobals(async () => {
    globalThis.fetch = async () => { calls++; throw new Error("socket closed after submit"); };
  }, async () => {
    const response = await worker.fetch(new Request("https://worker.example/v1/images/generations", {
      method: "POST",
      headers: { authorization: "Bearer test-key", "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-image-2", prompt: "cat", autoRetryCount: 10 }),
    }), { IMAGE_STUDIO_UPSTREAM_BASE_URL: "https://upstream.example" });
    const body = await response.json();
    assert.equal(calls, 1);
    assert.equal(response.status, 502);
    assert.equal(body.status, "uncertain");
    assert.equal(body.error.retryable, false);
  });
});

test("worker delivers the first SSE chunk before upstream EOF", async () => {
  let streamController;
  await withPatchedGlobals(async () => {
    globalThis.fetch = async () => new Response(new ReadableStream({
      start(controller) { streamController = controller; },
    }), { headers: { "content-type": "text/event-stream" } });
  }, async () => {
    const response = await worker.fetch(new Request("https://worker.example/v1/responses", {
      method: "POST", headers: { authorization: "Bearer test-key" }, body: "{}",
    }), { IMAGE_STUDIO_UPSTREAM_BASE_URL: "https://upstream.example" });
    assert.equal(response.status, 200);
    streamController.enqueue(new TextEncoder().encode('data: {"type":"response.created"}\n\n'));
    const reader = response.body.getReader();
    const first = await reader.read();
    assert.equal(first.done, false);
    assert.match(new TextDecoder().decode(first.value), /response.created/);
    // Upstream remains open throughout the first read.
    streamController.close();
    assert.equal((await reader.read()).done, true);
  });
});

const proxyRoutes = [
  { path: "/v1/responses", endpoint: "responses", method: "POST" },
  { path: "/v1/images/generations", endpoint: "images/generations", method: "POST" },
  { path: "/v1/images/edits", endpoint: "images/edits", method: "POST" },
  { path: "/v1/models", endpoint: "models", method: "GET" },
  { path: "/kernel/generate", endpoint: "responses", method: "POST" },
  { path: "/kernel/prompt-optimize", endpoint: "responses", method: "POST" },
];

function proxyRequest(route, options = {}) {
  return new Request(`https://worker.example${route.path}${options.query || ""}`, {
    method: route.method,
    headers: { authorization: "Bearer test-key", "content-type": "application/json", ...options.headers },
    ...(route.method === "POST" ? { body: JSON.stringify({ prompt: "cat", apiMode: "responses", ...options.body }) } : {}),
    signal: options.signal,
  });
}

test("all Worker routes preserve the configured OpenAI API root", async () => {
  const roots = [
    ["", "/v1"], ["/v1", "/v1"], ["/api/v3", "/api/v3"],
    ["/openai", "/openai"], ["/openai/v1", "/openai/v1"],
  ];
  let captured;
  await withPatchedGlobals(async () => {
    globalThis.fetch = async (url, init) => {
      captured = { url: String(url), method: init.method, redirect: init.redirect };
      return new Response("{}", { headers: { "content-type": "application/json" } });
    };
  }, async () => {
    for (const [inputRoot, outputRoot] of roots) {
      for (const route of proxyRoutes) {
        const response = await worker.fetch(proxyRequest(route), {
          IMAGE_STUDIO_UPSTREAM_BASE_URL: `https://upstream.example${inputRoot}/`,
        });
        await response.text();
        assert.deepEqual(captured, {
          url: `https://upstream.example${outputRoot}/${route.endpoint}`,
          method: route.method, redirect: "manual",
        }, `${inputRoot || "/"} + ${route.path}`);
      }
    }
  });
});

test("API-root overrides preserve path semantics and never leak baseURL into upstream query", async () => {
  const seen = [];
  await withPatchedGlobals(async () => {
    globalThis.fetch = async (url) => { seen.push(String(url)); return new Response("{}"); };
  }, async () => {
    for (const route of proxyRoutes) {
      const kernelRoute = route.path.startsWith("/kernel/");
      const request = kernelRoute
        ? proxyRequest(route, { body: { baseURL: "https://override.example/openai/v1/" } })
        : proxyRequest(route, {
          query: "?baseURL=https%3A%2F%2Fignored.example%2Fv1&trace=kept",
          headers: { "x-image-studio-upstream-base-url": "https://override.example/openai/v1/" },
        });
      await (await worker.fetch(request, { IMAGE_STUDIO_UPSTREAM_BASE_URL: "https://ignored.example/api/v3" })).text();
      const expectedQuery = !kernelRoute && route.method === "POST" ? "?trace=kept" : "";
      assert.equal(seen.at(-1), `https://override.example/openai/v1/${route.endpoint}${expectedQuery}`);
    }
  });
});

test("all Worker routes preserve upstream request IDs and response headers", async () => {
  const responseHeaders = {
    "content-type": "application/json", "cache-control": "no-store", "retry-after": "17",
    "x-request-id": "x-id", "request-id": "plain-id", "openai-request-id": "openai-id",
  };
  await withPatchedGlobals(async () => {
    globalThis.fetch = async () => new Response("{}", { headers: responseHeaders });
  }, async () => {
    for (const route of proxyRoutes) {
      const response = await worker.fetch(proxyRequest(route), { IMAGE_STUDIO_UPSTREAM_BASE_URL: "https://upstream.example" });
      for (const [header, value] of Object.entries(responseHeaders)) assert.equal(response.headers.get(header), value, `${route.path} ${header}`);
      await response.text();
    }
  });
});

test("raw proxy keeps client correlation and native OpenAI request headers", async () => {
  let captured;
  await withPatchedGlobals(async () => {
    globalThis.fetch = async (_url, init) => { captured = init; return new Response("{}"); };
  }, async () => {
    const headers = { "x-client-request-id": "client-id", "openai-beta": "responses=v1", accept: "text/event-stream", "user-agent": "image-studio/test" };
    await (await worker.fetch(proxyRequest(proxyRoutes[0], { headers }), { IMAGE_STUDIO_UPSTREAM_BASE_URL: "https://upstream.example" })).text();
    for (const [header, value] of Object.entries(headers)) assert.equal(headerValue(captured, header), value);
    assert.equal(headerValue(captured, "authorization"), "Bearer test-key");
  });
});

test("cancelling a client stream aborts the upstream fetch and reader on every route", async () => {
  let capturedSignal;
  let cancellations;
  await withPatchedGlobals(async () => {
    globalThis.fetch = async (_url, init) => {
      capturedSignal = init.signal;
      return new Response(new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode("first chunk")); },
        cancel() { cancellations++; },
      }), { headers: { "content-type": "text/event-stream" } });
    };
  }, async () => {
    for (const route of proxyRoutes) {
      cancellations = 0;
      const response = await worker.fetch(proxyRequest(route), { IMAGE_STUDIO_UPSTREAM_BASE_URL: "https://upstream.example" });
      const reader = response.body.getReader();
      assert.equal((await reader.read()).done, false);
      await reader.cancel("client closed stream");
      assert.equal(capturedSignal.aborted, true, route.path);
      assert.equal(cancellations, 1, route.path);
    }
  });
});

test("request abort interrupts a pending upstream read without another submission", async () => {
  let calls = 0;
  let cancellations = 0;
  let capturedSignal;
  await withPatchedGlobals(async () => {
    globalThis.fetch = async (_url, init) => {
      calls++;
      capturedSignal = init.signal;
      return new Response(new ReadableStream({ cancel() { cancellations++; } }));
    };
  }, async () => {
    const controller = new AbortController();
    const response = await worker.fetch(proxyRequest(proxyRoutes[0], { signal: controller.signal }), { IMAGE_STUDIO_UPSTREAM_BASE_URL: "https://upstream.example" });
    const read = response.body.getReader().read();
    controller.abort(new Error("client cancelled"));
    await assert.rejects(read, /client cancelled/);
    assert.equal(capturedSignal.aborted, true);
    assert.equal(cancellations, 1);
    assert.equal(calls, 1);
  });
});

test("already-aborted client requests never reach the upstream", async () => {
  let calls = 0;
  await withPatchedGlobals(async () => {
    globalThis.fetch = async () => { calls++; return new Response("{}"); };
  }, async () => {
    const controller = new AbortController();
    controller.abort();
    const response = await worker.fetch(proxyRequest(proxyRoutes[0], { signal: controller.signal }), { IMAGE_STUDIO_UPSTREAM_BASE_URL: "https://upstream.example" });
    assert.equal(response.status, 499);
    assert.equal(calls, 0);
  });
});

test("oversized upstream error streams are bounded and cancelled without replay", async () => {
  let calls = 0;
  let cancellations = 0;
  let capturedSignal;
  await withPatchedGlobals(async () => {
    globalThis.fetch = async (_url, init) => {
      calls++;
      capturedSignal = init.signal;
      return new Response(new ReadableStream({
        start(controller) { controller.enqueue(new Uint8Array(128 * 1024).fill(65)); },
        cancel() { cancellations++; },
      }), { status: 503, headers: { "content-type": "text/plain", "x-request-id": "large-error" } });
    };
  }, async () => {
    const response = await worker.fetch(proxyRequest(proxyRoutes[0]), { IMAGE_STUDIO_UPSTREAM_BASE_URL: "https://upstream.example" });
    assert.equal((await response.arrayBuffer()).byteLength, 64 * 1024);
    assert.equal(response.headers.get("x-image-studio-error-body-limit"), "65536");
    assert.equal(response.headers.get("x-request-id"), "large-error");
    assert.equal(response.status, 503);
    assert.equal(capturedSignal.aborted, true);
    assert.equal(cancellations, 1);
    assert.equal(calls, 1);
  });
});
