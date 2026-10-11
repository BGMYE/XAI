import {
  buildPromptOptimizePayload,
  buildResponsesPayload,
  normalizeAPIMode,
  openAIAPIEndpoint,
} from "../../shared/kernel/requestModel.js";

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status ?? 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...init.headers,
    },
  });
}

function getBearer(request) {
  const raw = request.headers.get("authorization") || "";
  if (!raw.toLowerCase().startsWith("bearer ")) return "";
  return raw.slice(7).trim();
}

function resolveUpstreamBaseURL(env, request) {
  const url = new URL(request.url);
  const headerOverride = request.headers.get("x-image-studio-upstream-base-url") || "";
  return String(
    headerOverride
      || url.searchParams.get("baseURL")
      || env.IMAGE_STUDIO_UPSTREAM_BASE_URL
      || "",
  ).trim().replace(/\/+$/, "");
}

function makeUpstreamHeaders(request, apiKey) {
  const headers = new Headers();
  const passThrough = [
    "content-type",
    "accept",
    "user-agent",
    "openai-beta",
    "x-client-request-id",
  ];
  for (const key of passThrough) {
    const value = request.headers.get(key);
    if (value) headers.set(key, value);
  }
  headers.set("authorization", `Bearer ${apiKey}`);
  return headers;
}

const MAX_UPSTREAM_ERROR_BYTES = 64 * 1024;

// Preserve streaming backpressure. Cancelling the returned body also aborts
// the fetch, including when the caller does not abort its Request signal.
function relayBody(body, abortController, cleanup, byteLimit = Infinity) {
  if (!body) { cleanup(); return null; }
  const reader = body.getReader();
  let finished = false;
  let remaining = byteLimit;
  let onAbort;
  const finish = () => {
    if (finished) return;
    finished = true;
    abortController.signal.removeEventListener("abort", onAbort);
    cleanup();
  };
  return new ReadableStream({
    start(controller) {
      onAbort = () => {
        if (finished) return;
        const reason = abortController.signal.reason || new DOMException("Aborted", "AbortError");
        finish();
        controller.error(reason);
        void reader.cancel(reason).catch(() => {});
      };
      abortController.signal.addEventListener("abort", onAbort, { once: true });
      if (abortController.signal.aborted) onAbort();
    },
    async pull(controller) {
      try {
        const { value, done } = await reader.read();
        if (finished) return;
        if (done) { finish(); controller.close(); return; }
        const chunk = value.byteLength > remaining ? value.subarray(0, remaining) : value;
        if (chunk.byteLength) controller.enqueue(chunk);
        remaining -= chunk.byteLength;
        if (remaining <= 0) {
          finish();
          controller.close();
          const reason = new Error("Upstream error body reached the 64 KiB limit");
          abortController.abort(reason);
          void reader.cancel(reason).catch(() => {});
        }
      } catch (error) {
        if (finished) return;
        finish();
        controller.error(error);
        abortController.abort(error);
      }
    },
    cancel(reason) {
      finish();
      abortController.abort(reason);
      return reader.cancel(reason);
    },
  }, { highWaterMark: 0 });
}

// Generation POSTs are submitted exactly once. A timeout or broken stream
// cannot prove that the provider did not generate (and charge for) an image.
async function forwardOnce({ upstreamURL, method, headers, bodyBuffer, signal, generation = true }) {
  const upstreamAbort = new AbortController();
  const onClientAbort = () => upstreamAbort.abort(signal.reason);
  signal?.addEventListener("abort", onClientAbort, { once: true });
  const cleanup = () => signal?.removeEventListener("abort", onClientAbort);
  if (signal?.aborted) onClientAbort();
  try {
    if (upstreamAbort.signal.aborted) throw upstreamAbort.signal.reason;
    const response = await fetch(upstreamURL, {
      method, headers, body: bodyBuffer, signal: upstreamAbort.signal,
      redirect: "manual",
    });
    const outgoingHeaders = new Headers();
    for (const key of ["content-type", "cache-control", "x-request-id", "request-id", "openai-request-id", "retry-after"]) {
      const value = response.headers.get(key);
      if (value) outgoingHeaders.set(key, value);
    }
    if (generation && response.status >= 500) outgoingHeaders.set("x-image-studio-generation-status", "uncertain");
    const errorLimit = response.status >= 400 ? MAX_UPSTREAM_ERROR_BYTES : Infinity;
    if (Number.isFinite(errorLimit)) outgoingHeaders.set("x-image-studio-error-body-limit", String(errorLimit));
    // Successful SSE is never buffered; only error bodies have a byte cap.
    const body = relayBody(response.body, upstreamAbort, cleanup, errorLimit);
    return new Response(body, { status: response.status, headers: outgoingHeaders });
  } catch {
    cleanup();
    if (signal?.aborted) {
      return json({ error: { type: "request_cancelled", message: "客户端已取消请求。", retryable: false } }, { status: 499 });
    }
    return json({ error: {
      type: generation ? "generation_uncertain" : "upstream_unavailable",
      message: generation
        ? "上游连接中断，生成状态不确定；请求没有自动重发，请先核对上游任务与费用。"
        : "上游连接中断，请检查连接后重试。",
      retryable: false,
    }, ...(generation ? { status: "uncertain" } : {}) }, { status: 502 });
  }
}

function sanitizePayload(input) {
  return {
    apiKey: String(input?.apiKey || ""),
    mode: input?.mode === "edit" ? "edit" : "generate",
    prompt: String(input?.prompt || ""),
    promptMode: input?.promptMode === "assisted" ? "assisted" : "verbatim",
    modelCapabilities: input?.modelCapabilities && typeof input.modelCapabilities === "object" ? input.modelCapabilities : undefined,
    size: String(input?.size || ""),
    quality: String(input?.quality || ""),
    outputFormat: String(input?.outputFormat || ""),
    background: String(input?.background || ""),
    outputCompression: input?.outputCompression,
    inputFidelity: String(input?.inputFidelity || ""),
    moderation: String(input?.moderation || ""),
    reasoningEffort: String(input?.reasoningEffort || ""),
    userIdentifier: String(input?.userIdentifier || ""),
    disablePreview: input?.disablePreview === true,
    imagePaths: Array.isArray(input?.imagePaths) ? input.imagePaths.map((item) => String(item || "")) : [],
    imagePath: String(input?.imagePath || ""),
    imageDataURLs: Array.isArray(input?.imageDataURLs) ? input.imageDataURLs.map((item) => String(item || "")) : [],
    maskB64: String(input?.maskB64 || ""),
    seed: Number(input?.seed || 0),
    negativePrompt: String(input?.negativePrompt || ""),
    baseURL: String(input?.baseURL || ""),
    textModelID: String(input?.textModelID || ""),
    imageModelID: String(input?.imageModelID || ""),
    apiMode: String(input?.apiMode || ""),
    requestPolicy: input?.requestPolicy === "compat" ? "compat" : "openai",
    noPromptRevision: !!input?.noPromptRevision,
    partialImages: input?.partialImages,
    autoRetryCount: Number(input?.autoRetryCount || 0),
  };
}

function collectSourceDataURLs(payload) {
  const merged = [];
  for (const item of payload.imageDataURLs || []) {
    if (typeof item === "string" && item.trim()) merged.push(item.trim());
  }
  return merged;
}

async function forwardResponses(env, payload, apiKey, signal) {
  const upstreamBaseURL = String(payload.baseURL || env.IMAGE_STUDIO_UPSTREAM_BASE_URL || "").trim();
  if (!upstreamBaseURL) {
    return json({ error: { message: "Worker 未配置上游 BASE_URL" } }, { status: 400 });
  }
  if (!apiKey) {
    return json({ error: { message: "缺少 Bearer API Key" } }, { status: 401 });
  }

  const sourceDataURLs = collectSourceDataURLs(payload);
  let requestBody;
  try {
    requestBody = buildResponsesPayload(payload, sourceDataURLs);
  } catch (error) {
    return json({ error: { message: error.message } }, { status: 400 });
  }
  return forwardOnce({
    upstreamURL: openAIAPIEndpoint(upstreamBaseURL, "responses"),
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      accept: "text/event-stream, application/json",
    },
    bodyBuffer: JSON.stringify(requestBody),
    signal,
  });
}

async function forwardOpenAIPath(env, request, apiKey) {
  const upstreamBaseURL = resolveUpstreamBaseURL(env, request);
  if (!upstreamBaseURL) {
    return json({ error: { message: "Worker 未配置上游 BASE_URL" } }, { status: 400 });
  }
  if (!apiKey) {
    return json({ error: { message: "缺少 Bearer API Key" } }, { status: 401 });
  }
  const url = new URL(request.url);
  url.searchParams.delete("baseURL");
  const upstreamURL = `${openAIAPIEndpoint(upstreamBaseURL, url.pathname.replace(/^\/v1\//, ""))}${url.search}`;
  const bodyBuffer = request.method === "GET" || request.method === "HEAD"
    ? null
    : await request.arrayBuffer();
  return forwardOnce({
    upstreamURL,
    method: request.method,
    headers: makeUpstreamHeaders(request, apiKey),
    bodyBuffer,
    signal: request.signal,
  });
}

async function forwardPromptOptimize(env, body, apiKey, signal) {
  const upstreamBaseURL = String(body.baseURL || env.IMAGE_STUDIO_UPSTREAM_BASE_URL || "").trim();
  if (!upstreamBaseURL) {
    return json({ error: { message: "Worker 未配置上游 BASE_URL" } }, { status: 400 });
  }
  if (!apiKey) {
    return json({ error: { message: "缺少 Bearer API Key" } }, { status: 401 });
  }
  const sourceDataURLs = Array.isArray(body.sourceDataURLs)
    ? body.sourceDataURLs.filter((item) => typeof item === "string" && item.trim())
    : [];
  const requestBody = buildPromptOptimizePayload(body, sourceDataURLs);
  return forwardOnce({
    upstreamURL: openAIAPIEndpoint(upstreamBaseURL, "responses"),
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    bodyBuffer: JSON.stringify(requestBody),
    signal,
    generation: false,
  });
}

async function forwardModels(env, request, apiKey) {
  const upstreamBaseURL = resolveUpstreamBaseURL(env, request);
  if (!upstreamBaseURL) {
    return json({ error: { message: "Worker 未配置上游 BASE_URL" } }, { status: 400 });
  }
  if (!apiKey) {
    return json({ error: { message: "缺少 Bearer API Key" } }, { status: 401 });
  }
  return forwardOnce({
    upstreamURL: openAIAPIEndpoint(upstreamBaseURL, "models"),
    method: "GET",
    headers: {
      authorization: `Bearer ${apiKey}`,
      accept: "application/json",
    },
    signal: request.signal,
    generation: false,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const apiKey = getBearer(request);

    if (request.method === "GET" && url.pathname === "/healthz") {
      return json({ ok: true, service: "image-studio-kernel-worker" });
    }

    if (request.method === "GET" && url.pathname === "/v1/models") {
      return forwardModels(env, request, apiKey);
    }

    if (
      request.method === "POST"
      && (
        url.pathname === "/v1/responses"
        || url.pathname === "/v1/images/generations"
        || url.pathname === "/v1/images/edits"
      )
    ) {
      return forwardOpenAIPath(env, request, apiKey);
    }

    if (request.method === "POST" && url.pathname === "/kernel/prompt-optimize") {
      const body = await request.json().catch(() => ({}));
      return forwardPromptOptimize(env, body, apiKey, request.signal);
    }

    if (request.method === "POST" && url.pathname === "/kernel/generate") {
      const body = sanitizePayload(await request.json().catch(() => ({})));
      if (normalizeAPIMode(body.apiMode) !== "responses") {
        return json({ error: { message: "当前 Worker 入口只代理 Responses API 模式" } }, { status: 400 });
      }
      return forwardResponses(env, body, apiKey, request.signal);
    }

    return json({ error: { message: "Not found" } }, { status: 404 });
  },
};
