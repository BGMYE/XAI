import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import worker from "../../../cloudflare-worker/src/index.js";

const realFetch = globalThis.fetch;
const realAtob = globalThis.atob;
const realBtoa = globalThis.btoa;

function installBase64() {
  globalThis.atob = (value) => Buffer.from(value, "base64").toString("binary");
  globalThis.btoa = (value) => Buffer.from(value, "binary").toString("base64");
}

async function readIncomingBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function startMockUpstream() {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const body = await readIncomingBody(req);
    requests.push({
      method: req.method,
      url: req.url,
      headers: req.headers,
      body,
    });

    if (req.method === "GET" && req.url === "/v1/models") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "gpt-5.5" }, { id: "gpt-image-2" }] }));
      return;
    }

    if (req.method === "POST" && req.url === "/v1/responses") {
      const parsed = JSON.parse(body.toString("utf8") || "{}");
      if (parsed.instructions && !parsed.tools) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ output_text: "optimized prompt via worker" }));
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end('data: {"type":"response.output_item.done","item":{"type":"image_generation_call","result":"d29ya2VyLWltYWdl","revised_prompt":"worker revised"}}\n');
      return;
    }

    if (req.method === "POST" && req.url === "/v1/images/generations") {
      const parsed = JSON.parse(body.toString("utf8") || "{}");
      if (parsed.stream) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end('data: {"type":"image_generation.partial_image","partial_image_index":0,"b64_json":"aW1hZ2VzLXBhcnRpYWw="}\n' +
          'data: {"type":"image_generation.completed","b64_json":"aW1hZ2VzLWdlbg=="}\n');
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ b64_json: "aW1hZ2VzLWdlbg==", revised_prompt: "images revised" }] }));
      return;
    }

    if (req.method === "POST" && req.url === "/v1/images/edits") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ b64_json: "ZWRpdGVkLWltYWdl", revised_prompt: "edit revised" }] }));
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "not found" } }));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseURL = `http://127.0.0.1:${address.port}`;
  return {
    baseURL,
    requests,
    async close() {
      await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    },
  };
}

function loadRemoteKernel() {
  return import(`../src/platform/runtime/remoteKernel.ts?worker-test=${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

async function withWorkerProxy(upstreamBaseURL, fn) {
  installBase64();
  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? (init ? new Request(input, init) : input) : new Request(input, init);
    const url = new URL(request.url);
    if (url.hostname === "worker.local") {
      return worker.fetch(request, {
        IMAGE_STUDIO_UPSTREAM_BASE_URL: upstreamBaseURL,
      });
    }
    return realFetch(input, init);
  };
  try {
    return await fn();
  } finally {
    globalThis.fetch = realFetch;
    globalThis.atob = realAtob;
    globalThis.btoa = realBtoa;
  }
}

test("desktop remote kernel can reach mock upstream through worker for responses", async () => {
  const upstream = await startMockUpstream();
  try {
    await withWorkerProxy(upstream.baseURL, async () => {
      const kernel = await loadRemoteKernel();
      const result = await kernel.runRemoteImageJob(
        {
          payload: {
            apiKey: "worker-key",
            mode: "generate",
            prompt: "cat",
            size: "1024x1024",
            quality: "low",
            outputFormat: "png",
            imagePaths: [],
            imagePath: "",
            maskB64: "",
            seed: 0,
            negativePrompt: "",
            baseURL: "https://worker.local",
            textModelID: "gpt-5.5",
            imageModelID: "gpt-image-2",
            apiMode: "responses",
            noPromptRevision: false,
            concurrencyLimit: 0,
          },
        },
        { signal: new AbortController().signal },
      );
      assert.equal(result.imageB64, "d29ya2VyLWltYWdl");
      assert.equal(result.revisedPrompt, "worker revised");
      assert.equal(upstream.requests[0].url, "/v1/responses");
      const responseBody = JSON.parse(upstream.requests[0].body.toString("utf8"));
      assert.ok(responseBody.instructions.includes("VERBATIM"));
      assert.equal(responseBody.tools[0].partial_images, 1);
    });
  } finally {
    await upstream.close();
  }
});

test("desktop remote kernel can reach mock upstream through worker for images api and prompt optimize", async () => {
  const upstream = await startMockUpstream();
  try {
    await withWorkerProxy(upstream.baseURL, async () => {
      const kernel = await loadRemoteKernel();

      const imagesResult = await kernel.runRemoteImageJob(
        {
          payload: {
            apiKey: "worker-key",
            mode: "generate",
            prompt: "bird",
            size: "1024x1024",
            quality: "medium",
            outputFormat: "png",
            imagePaths: [],
            imagePath: "",
            maskB64: "",
            seed: 0,
            negativePrompt: "",
            baseURL: "https://worker.local",
            textModelID: "",
            imageModelID: "gpt-image-2",
            apiMode: "images",
            requestPolicy: "openai",
            noPromptRevision: false,
            concurrencyLimit: 0,
          },
        },
        { signal: new AbortController().signal },
      );
      assert.equal(imagesResult.imageB64, "aW1hZ2VzLWdlbg==");
      assert.equal(imagesResult.sourceEvent, "images_api");

      const editResult = await kernel.runRemoteImageJob(
        {
          payload: {
            apiKey: "worker-key",
            mode: "edit",
            prompt: "make it orange",
            size: "1024x1024",
            quality: "medium",
            outputFormat: "png",
            imagePaths: [],
            imagePath: "",
            maskB64: "",
            seed: 0,
            negativePrompt: "",
            baseURL: "https://worker.local",
            textModelID: "",
            imageModelID: "gpt-image-2",
            apiMode: "images",
            requestPolicy: "openai",
            noPromptRevision: false,
            concurrencyLimit: 0,
          },
          sourceImages: [{ name: "source.png", imageB64: "AAAA" }],
        },
        { signal: new AbortController().signal },
      );
      assert.equal(editResult.imageB64, "ZWRpdGVkLWltYWdl");
      assert.equal(editResult.revisedPrompt, "edit revised");

      const optimized = await kernel.optimizePromptRemote({
        apiKey: "worker-key",
        prompt: "cat",
        mode: "generate",
        baseURL: "https://worker.local",
        textModelID: "gpt-5.5",
        imagePaths: [],
        imagePath: "",
      }, new AbortController().signal);
      assert.equal(optimized, "optimized prompt via worker");

      const generationReq = upstream.requests.find((req) => req.url === "/v1/images/generations");
      const editReq = upstream.requests.find((req) => req.url === "/v1/images/edits");
      const optimizeReq = upstream.requests.filter((req) => req.url === "/v1/responses").pop();
      assert.ok(generationReq);
      assert.ok(editReq);
      assert.ok(optimizeReq);
      const generationBody = JSON.parse(generationReq.body.toString("utf8"));
      assert.equal(generationBody.stream, true);
      assert.equal(generationBody.partial_images, 1);
      assert.match(editReq.headers["content-type"], /^multipart\/form-data; boundary=/);
    });
  } finally {
    await upstream.close();
  }
});

test("desktop remote kernel honors configured auto retry count for 503 retries", async () => {
  const requests = [];
  let attempt = 0;
  const server = http.createServer(async (req, res) => {
    const body = await readIncomingBody(req);
    requests.push({ method: req.method, url: req.url, body });
    if (req.method === "POST" && req.url === "/v1/responses") {
      attempt++;
      if (attempt <= 3) {
        res.writeHead(503, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Upstream request failed", type: "upstream_error", upstreamStatus: 503 } }));
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end('data: {"type":"response.output_item.done","item":{"type":"image_generation_call","result":"cmV0cnktb2s=","revised_prompt":"retry ok"}}\n');
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "not found" } }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const upstreamBaseURL = `http://127.0.0.1:${address.port}`;
  try {
    await withWorkerProxy(upstreamBaseURL, async () => {
      const kernel = await loadRemoteKernel();
      const result = await kernel.runRemoteImageJob(
        {
          payload: {
            apiKey: "worker-key",
            mode: "generate",
            prompt: "cat",
            size: "1024x1024",
            quality: "low",
            outputFormat: "png",
            imagePaths: [],
            imagePath: "",
            maskB64: "",
            seed: 0,
            negativePrompt: "",
            baseURL: "https://worker.local",
            textModelID: "gpt-5.5",
            imageModelID: "gpt-image-2",
            apiMode: "responses",
            requestPolicy: "openai",
            noPromptRevision: false,
            concurrencyLimit: 0,
            autoRetryEnabled: true,
            autoRetryCount: 3,
          },
        },
        { signal: new AbortController().signal },
      );
      assert.equal(result.imageB64, "cmV0cnktb2s=");
      assert.equal(attempt, 4);
    });
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("desktop remote kernel worker path supports NewAPI image compat mode", async () => {
  const upstream = await startMockUpstream();
  try {
    await withWorkerProxy(upstream.baseURL, async () => {
      const kernel = await loadRemoteKernel();

      const result = await kernel.runRemoteImageJob(
        {
          payload: {
            apiKey: "worker-key",
            mode: "generate",
            prompt: "bird",
            size: "1024x1024",
            quality: "medium",
            outputFormat: "png",
            imagePaths: [],
            imagePath: "",
            maskB64: "",
            seed: 0,
            negativePrompt: "",
            baseURL: "https://worker.local",
            textModelID: "",
            imageModelID: "gpt-image-2",
            apiMode: "images",
            requestPolicy: "openai",
            imagesNewAPICompat: true,
            noPromptRevision: false,
            concurrencyLimit: 0,
          },
        },
        { signal: new AbortController().signal },
      );
      assert.equal(result.imageB64, "aW1hZ2VzLWdlbg==");
      assert.equal(result.revisedPrompt, "images revised");

      const generationReq = upstream.requests.find((req) => req.url === "/v1/images/generations");
      assert.ok(generationReq);
      const generationBody = JSON.parse(generationReq.body.toString("utf8"));
      assert.equal(generationBody.response_format, "b64_json");
      assert.equal("stream" in generationBody, false);
      assert.equal("partial_images" in generationBody, false);
    });
  } finally {
    await upstream.close();
  }
});
