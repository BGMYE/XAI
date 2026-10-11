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

test("responses proxy retries on retryable 524 and returns final SSE body", async () => {
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
    assert.equal(response.status, 200);
    assert.match(text, /image_generation_call/);
    assert.equal(seen.length, 2);
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
