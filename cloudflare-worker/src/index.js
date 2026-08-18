import {
  DEFAULT_AUTO_RETRY_COUNT,
  buildPromptOptimizePayload,
  buildResponsesPayload,
  describeProblem,
  isRetryableRaw,
  normalizeAutoRetryCount,
  normalizeAPIMode,
  normalizeBaseURL,
  RETRY_BACKOFF_MS,
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

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveUpstreamBaseURL(env, request) {
  const url = new URL(request.url);
  const headerOverride = request.headers.get("x-image-studio-upstream-base-url") || "";
  return normalizeBaseURL(
    headerOverride
      || url.searchParams.get("baseURL")
      || env.IMAGE_STUDIO_UPSTREAM_BASE_URL
      || "",
  );
}

function makeUpstreamHeaders(request, apiKey) {
  const headers = new Headers();
  const passThrough = [
    "content-type",
    "accept",
    "user-agent",
    "openai-beta",
  ];
  for (const key of passThrough) {
    const value = request.headers.get(key);
    if (value) headers.set(key, value);
  }
  headers.set("authorization", `Bearer ${apiKey}`);
  return headers;
}

async function forwardRawWithRetry({
  upstreamURL,
  method,
  headers,
  bodyBuffer,
  maxAttempts,
  shouldRetry,
}) {
  let lastRaw = "";
  let lastStatus = 502;
  let lastContentType = "application/json; charset=utf-8";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await fetch(upstreamURL, {
      method,
      headers,
      body: bodyBuffer,
    });
    lastStatus = response.status;
    lastContentType = response.headers.get("content-type") || lastContentType;
    lastRaw = await response.text();
    if (response.ok) {
      return new Response(lastRaw, {
        status: response.status,
        headers: {
          "content-type": lastContentType,
        },
      });
    }
    if (attempt < maxAttempts && shouldRetry(lastRaw, response.status)) {
      await sleep(RETRY_BACKOFF_MS);
      continue;
    }
    break;
  }

  return json({
    error: {
      message: describeProblem(lastRaw),
      upstreamStatus: lastStatus,
      raw: lastRaw.slice(0, 1500),
    },
  }, { status: lastStatus || 502 });
}

function resolveMaxAttempts(autoRetryCount) {
  return normalizeAutoRetryCount(autoRetryCount ?? DEFAULT_AUTO_RETRY_COUNT) + 1;
}

function sanitizePayload(input) {
  return {
    apiKey: String(input?.apiKey || ""),
    mode: input?.mode === "edit" ? "edit" : "generate",
    prompt: String(input?.prompt || ""),
    size: String(input?.size || ""),
    quality: String(input?.quality || ""),
    outputFormat: String(input?.outputFormat || ""),
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
    partialImages: Number(input?.partialImages || 0),
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

async function forwardResponses(env, payload, apiKey) {
  const upstreamBaseURL = normalizeBaseURL(payload.baseURL || env.IMAGE_STUDIO_UPSTREAM_BASE_URL || "");
  if (!upstreamBaseURL) {
    return json({ error: { message: "Worker 未配置上游 BASE_URL" } }, { status: 400 });
  }
  if (!apiKey) {
    return json({ error: { message: "缺少 Bearer API Key" } }, { status: 401 });
  }

  const sourceDataURLs = collectSourceDataURLs(payload);
  const requestBody = buildResponsesPayload(payload, sourceDataURLs);
  let lastRaw = "";
  let lastStatus = 502;
  const maxAttempts = resolveMaxAttempts(payload.autoRetryCount);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await fetch(`${upstreamBaseURL}/v1/responses`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        accept: "text/event-stream, application/json",
      },
      body: JSON.stringify(requestBody),
    });
    lastStatus = response.status;
    lastRaw = await response.text();
    if (response.ok) {
      return new Response(lastRaw, {
        status: response.status,
        headers: {
          "content-type": response.headers.get("content-type") || "text/event-stream; charset=utf-8",
        },
      });
    }
    if (attempt < maxAttempts && (isRetryableRaw(lastRaw) || [403, 502, 503, 504, 524].includes(response.status))) {
      await sleep(RETRY_BACKOFF_MS);
      continue;
    }
    break;
  }

  return json({
    error: {
      message: describeProblem(lastRaw),
      upstreamStatus: lastStatus,
      raw: lastRaw.slice(0, 1500),
    },
  }, { status: lastStatus || 502 });
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
  const upstreamURL = `${upstreamBaseURL}${url.pathname}${url.search}`;
  const bodyBuffer = request.method === "GET" || request.method === "HEAD"
    ? null
    : await request.arrayBuffer();
  let parsedBody = null;
  if (bodyBuffer) {
    try {
      parsedBody = JSON.parse(new TextDecoder().decode(bodyBuffer));
    } catch {
      parsedBody = null;
    }
  }
  return forwardRawWithRetry({
    upstreamURL,
    method: request.method,
    headers: makeUpstreamHeaders(request, apiKey),
    bodyBuffer,
    maxAttempts: resolveMaxAttempts(parsedBody?.autoRetryCount),
    shouldRetry: (raw, status) => isRetryableRaw(raw) || [403, 502, 503, 504, 524].includes(status),
  });
}

async function forwardPromptOptimize(env, body, apiKey) {
  const upstreamBaseURL = normalizeBaseURL(body.baseURL || env.IMAGE_STUDIO_UPSTREAM_BASE_URL || "");
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
  const response = await fetch(`${upstreamBaseURL}/v1/responses`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(requestBody),
  });
  const raw = await response.text();
  return new Response(raw, {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") || "application/json; charset=utf-8",
    },
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
  const response = await fetch(`${upstreamBaseURL}/v1/models`, {
    method: "GET",
    headers: {
      authorization: `Bearer ${apiKey}`,
      accept: "application/json",
    },
  });
  return new Response(await response.text(), {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") || "application/json; charset=utf-8",
    },
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
      return forwardPromptOptimize(env, body, apiKey);
    }

    if (request.method === "POST" && url.pathname === "/kernel/generate") {
      const body = sanitizePayload(await request.json().catch(() => ({})));
      if (normalizeAPIMode(body.apiMode) !== "responses") {
        return json({ error: { message: "当前 Worker 入口只代理 Responses API 模式" } }, { status: 400 });
      }
      return forwardResponses(env, body, apiKey);
    }

    return json({ error: { message: "Not found" } }, { status: 404 });
  },
};
