import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import worker from "../cloudflare-worker/src/index.js";
import { pickFreePort } from "./pick-free-port.mjs";
import { resolveVerifyOutputPath } from "./verify-output-paths.mjs";
import {
  buildPromptOptimizePayload,
  buildResponsesPayload,
  normalizeBaseURL,
} from "../shared/kernel/requestModel.js";

async function loadEnvOverrides() {
  const candidates = [".env.live", ".env.local", ".env"];
  const loaded = {};
  for (const file of candidates) {
    try {
      const raw = await readFile(file, "utf8");
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const idx = trimmed.indexOf("=");
        if (idx <= 0) continue;
        const key = trimmed.slice(0, idx).trim();
        const value = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, "");
        if (!(key in loaded)) loaded[key] = value;
      }
    } catch {
      // ignore missing local env file
    }
  }
  return loaded;
}

const envOverrides = await loadEnvOverrides();
const effectiveEnv = { ...envOverrides, ...process.env };
const envValue = (key, fallback = "") => process.env[key] || envOverrides[key] || fallback;

const upstreamBaseURL = normalizeBaseURL(envValue("IMAGE_STUDIO_UPSTREAM_BASE_URL"));
const apiKey = envValue("IMAGE_STUDIO_API_KEY").trim();
const textModelID = envValue("IMAGE_STUDIO_TEXT_MODEL_ID", "gpt-5.5").trim();
const imageModelID = envValue("IMAGE_STUDIO_IMAGE_MODEL_ID", "gpt-image-2").trim();
const port = envValue("LIVE_VERIFY_PORT").trim()
  ? Number(envValue("LIVE_VERIFY_PORT"))
  : await pickFreePort();
const workerOrigin = `http://127.0.0.1:${port}`;
const outputPath = resolveVerifyOutputPath("IMAGE_STUDIO_LIVE_VERIFY_OUTPUT_PATH", "live-verify.json", effectiveEnv);
const summary = {
  startedAt: new Date().toISOString(),
  status: "running",
  environment: {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    textModelID,
    imageModelID,
    port,
  },
  upstreamBaseURL,
  workerOrigin,
  checks: [],
};

if (!upstreamBaseURL || !apiKey) {
  const message = "Missing IMAGE_STUDIO_UPSTREAM_BASE_URL or IMAGE_STUDIO_API_KEY (checked process env, .env.live, .env.local, .env)";
  summary.status = "failed";
  summary.completedAt = new Date().toISOString();
  summary.error = message;
  await writeOutputIfRequested(summary);
  console.error(message);
  process.exit(2);
}

function summarizeJSON(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.data)) {
      return {
        kind: "data",
        count: parsed.data.length,
        firstId: parsed.data[0]?.id ?? null,
        lastId: parsed.data[parsed.data.length - 1]?.id ?? null,
        hasB64: !!parsed.data[0]?.b64_json,
        firstRevisedPrompt: parsed.data[0]?.revised_prompt ?? null,
      };
    }
    if (typeof parsed?.output_text === "string") {
      return {
        kind: "output_text",
        outputText: parsed.output_text,
      };
    }
    return {
      kind: "json",
      keys: Object.keys(parsed),
    };
  } catch {
    return { kind: "raw", preview: raw.slice(0, 160) };
  }
}

function summarizeSSE(raw) {
  const lines = raw.split(/\r?\n/).filter((line) => line.startsWith("data: "));
  const lastPayload = lines.length > 0 ? lines[lines.length - 1].slice(6).trim() : "";
  let parsed = null;
  try {
    parsed = lastPayload ? JSON.parse(lastPayload) : null;
  } catch {
    parsed = null;
  }
  return {
    lineCount: lines.length,
    lastType: parsed?.type ?? null,
    hasImageResult: !!parsed?.item?.result,
    revisedPrompt: parsed?.item?.revised_prompt ?? null,
  };
}

function recordParityCheck(name, condition, detail) {
  summary.checks.push({
    name,
    status: condition ? "passed" : "failed",
    detail,
  });
}

async function writeOutputIfRequested(payload) {
  if (!outputPath) return;
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function requestJSON(url, init) {
  const response = await fetch(url, init);
  const raw = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  return {
    status: response.status,
    contentType: response.headers.get("content-type") || "",
    raw,
    parsed,
    summary: summarizeJSON(raw),
  };
}

async function requestText(url, init) {
  const response = await fetch(url, init);
  const raw = await response.text();
  return {
    status: response.status,
    contentType: response.headers.get("content-type") || "",
    raw,
    summary: summarizeSSE(raw),
  };
}

const proxyServer = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", workerOrigin);
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const body = Buffer.concat(chunks);
  const request = new Request(workerOrigin + url.pathname + url.search, {
    method: req.method,
    headers: {
      ...Object.fromEntries(Object.entries(req.headers).filter(([, value]) => typeof value === "string")),
      "x-image-studio-upstream-base-url": upstreamBaseURL,
    },
    body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
  });
  const response = await worker.fetch(request, {
    IMAGE_STUDIO_UPSTREAM_BASE_URL: upstreamBaseURL,
  });
  res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
  res.end(Buffer.from(await response.arrayBuffer()));
});

function captureResult(key, result) {
  summary[key] = { status: result.status, summary: result.summary };
  return result;
}

function sortedIds(result) {
  const ids = Array.isArray(result?.parsed?.data)
    ? result.parsed.data.map((item) => item?.id).filter((value) => typeof value === "string" && value.length > 0)
    : [];
  return [...ids].sort();
}

function firstRevisedPrompt(result) {
  if (!Array.isArray(result?.parsed?.data) || result.parsed.data.length === 0) return null;
  const value = result.parsed.data[0]?.revised_prompt;
  return typeof value === "string" ? value : null;
}

function makeImagesGenerationBody() {
  return JSON.stringify({
    model: imageModelID,
    prompt: "a single blue dot",
    n: 1,
    size: "1024x1024",
    quality: "low",
    output_format: "png",
    response_format: "b64_json",
  });
}

function makeImagesEditForm() {
  const form = new FormData();
  form.append("image", new Blob(["png-bytes"], { type: "image/png" }), "source.png");
  form.append("prompt", "make it orange");
  form.append("model", imageModelID);
  form.append("n", "1");
  form.append("size", "1024x1024");
  form.append("quality", "low");
  form.append("output_format", "png");
  form.append("response_format", "b64_json");
  return form;
}

try {
  await new Promise((resolve) => proxyServer.listen(port, "127.0.0.1", resolve));

  const directModels = captureResult("directModels", await requestJSON(`${upstreamBaseURL}/v1/models`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  }));

  const workerModels = captureResult("workerModels", await requestJSON(`${workerOrigin}/v1/models`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  }));

  const promptOptimizePayload = buildPromptOptimizePayload({
    prompt: "cat",
    mode: "generate",
    textModelID,
  }, []);

  const directOptimize = captureResult("directOptimize", await requestJSON(`${upstreamBaseURL}/v1/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(promptOptimizePayload),
  }));

  const workerOptimize = captureResult("workerOptimize", await requestJSON(`${workerOrigin}/kernel/prompt-optimize`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      baseURL: upstreamBaseURL,
      prompt: "cat",
      mode: "generate",
      textModelID,
      sourceDataURLs: [],
    }),
  }));

  const generatePayload = buildResponsesPayload({
    prompt: "a single red dot",
    size: "1024x1024",
    quality: "low",
    outputFormat: "png",
    imageModelID,
    textModelID,
    seed: 0,
    negativePrompt: "",
    maskB64: "",
    noPromptRevision: false,
  }, []);

  const directResponses = captureResult("directResponses", await requestText(`${upstreamBaseURL}/v1/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream, application/json",
    },
    body: JSON.stringify(generatePayload),
  }));

  const workerResponses = captureResult("workerResponses", await requestText(`${workerOrigin}/v1/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream, application/json",
    },
    body: JSON.stringify({
      apiKey,
      mode: "generate",
      prompt: "a single red dot",
      size: "1024x1024",
      quality: "low",
      outputFormat: "png",
      imagePaths: [],
      imagePath: "",
      maskB64: "",
      seed: 0,
      negativePrompt: "",
      baseURL: upstreamBaseURL,
      textModelID,
      imageModelID,
      apiMode: "responses",
      noPromptRevision: false,
    }),
  }));

  const directImagesGenerate = captureResult("directImagesGenerate", await requestJSON(`${upstreamBaseURL}/v1/images/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: makeImagesGenerationBody(),
  }));

  const workerImagesGenerate = captureResult("workerImagesGenerate", await requestJSON(`${workerOrigin}/v1/images/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: makeImagesGenerationBody(),
  }));

  const directImagesEdit = captureResult("directImagesEdit", await requestJSON(`${upstreamBaseURL}/v1/images/edits`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
    body: makeImagesEditForm(),
  }));

  const workerImagesEdit = captureResult("workerImagesEdit", await requestJSON(`${workerOrigin}/v1/images/edits`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
    body: makeImagesEditForm(),
  }));

  recordParityCheck("direct models status", directModels.status === 200, `status=${directModels.status}`);
  recordParityCheck("worker models status", workerModels.status === 200, `status=${workerModels.status}`);
  recordParityCheck(
    "model count parity",
    directModels.summary?.count === workerModels.summary?.count,
    `direct=${directModels.summary?.count ?? "?"}, worker=${workerModels.summary?.count ?? "?"}`,
  );
  recordParityCheck(
    "first model id parity",
    directModels.summary?.firstId === workerModels.summary?.firstId,
    `direct=${directModels.summary?.firstId ?? "?"}, worker=${workerModels.summary?.firstId ?? "?"}`,
  );
  recordParityCheck(
    "model id set parity",
    JSON.stringify(sortedIds(directModels)) === JSON.stringify(sortedIds(workerModels)),
    `direct=${sortedIds(directModels).join(",") || "(none)"}, worker=${sortedIds(workerModels).join(",") || "(none)"}`,
  );

  recordParityCheck("direct prompt optimize status", directOptimize.status === 200, `status=${directOptimize.status}`);
  recordParityCheck("worker prompt optimize status", workerOptimize.status === 200, `status=${workerOptimize.status}`);
  recordParityCheck(
    "direct prompt optimize output_text",
    directOptimize.summary?.kind === "output_text",
    `kind=${directOptimize.summary?.kind ?? "?"}`,
  );
  recordParityCheck(
    "worker prompt optimize output_text",
    workerOptimize.summary?.kind === "output_text",
    `kind=${workerOptimize.summary?.kind ?? "?"}`,
  );
  recordParityCheck(
    "prompt optimize output parity",
    directOptimize.summary?.outputText === workerOptimize.summary?.outputText,
    `direct=${directOptimize.summary?.outputText ?? "?"}, worker=${workerOptimize.summary?.outputText ?? "?"}`,
  );

  recordParityCheck("direct responses status", directResponses.status === 200, `status=${directResponses.status}`);
  recordParityCheck("worker responses status", workerResponses.status === 200, `status=${workerResponses.status}`);
  recordParityCheck(
    "direct responses final image",
    directResponses.summary?.hasImageResult === true,
    `hasImageResult=${directResponses.summary?.hasImageResult ?? "?"}`,
  );
  recordParityCheck(
    "worker responses final image",
    workerResponses.summary?.hasImageResult === true,
    `hasImageResult=${workerResponses.summary?.hasImageResult ?? "?"}`,
  );
  recordParityCheck(
    "responses last event parity",
    directResponses.summary?.lastType === workerResponses.summary?.lastType,
    `direct=${directResponses.summary?.lastType ?? "?"}, worker=${workerResponses.summary?.lastType ?? "?"}`,
  );
  recordParityCheck(
    "responses revised prompt parity",
    directResponses.summary?.revisedPrompt === workerResponses.summary?.revisedPrompt,
    `direct=${directResponses.summary?.revisedPrompt ?? "?"}, worker=${workerResponses.summary?.revisedPrompt ?? "?"}`,
  );

  recordParityCheck("direct images generate status", directImagesGenerate.status === 200, `status=${directImagesGenerate.status}`);
  recordParityCheck("worker images generate status", workerImagesGenerate.status === 200, `status=${workerImagesGenerate.status}`);
  recordParityCheck(
    "direct images generate b64_json",
    directImagesGenerate.summary?.hasB64 === true,
    `hasB64=${directImagesGenerate.summary?.hasB64 ?? "?"}`,
  );
  recordParityCheck(
    "worker images generate b64_json",
    workerImagesGenerate.summary?.hasB64 === true,
    `hasB64=${workerImagesGenerate.summary?.hasB64 ?? "?"}`,
  );
  recordParityCheck(
    "images generate revised prompt parity",
    firstRevisedPrompt(directImagesGenerate) === firstRevisedPrompt(workerImagesGenerate),
    `direct=${firstRevisedPrompt(directImagesGenerate) ?? "?"}, worker=${firstRevisedPrompt(workerImagesGenerate) ?? "?"}`,
  );

  recordParityCheck("direct images edit status", directImagesEdit.status === 200, `status=${directImagesEdit.status}`);
  recordParityCheck("worker images edit status", workerImagesEdit.status === 200, `status=${workerImagesEdit.status}`);
  recordParityCheck(
    "direct images edit b64_json",
    directImagesEdit.summary?.hasB64 === true,
    `hasB64=${directImagesEdit.summary?.hasB64 ?? "?"}`,
  );
  recordParityCheck(
    "worker images edit b64_json",
    workerImagesEdit.summary?.hasB64 === true,
    `hasB64=${workerImagesEdit.summary?.hasB64 ?? "?"}`,
  );
  recordParityCheck(
    "images edit revised prompt parity",
    firstRevisedPrompt(directImagesEdit) === firstRevisedPrompt(workerImagesEdit),
    `direct=${firstRevisedPrompt(directImagesEdit) ?? "?"}, worker=${firstRevisedPrompt(workerImagesEdit) ?? "?"}`,
  );

  const failedChecks = summary.checks.filter((check) => check.status === "failed");
  if (failedChecks.length > 0) {
    throw new Error(
      failedChecks
        .map((check) => `${check.name}: ${check.detail}`)
        .join("; "),
    );
  }

  summary.status = "passed";
  summary.completedAt = new Date().toISOString();
  await writeOutputIfRequested(summary);
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  summary.status = "failed";
  summary.completedAt = new Date().toISOString();
  summary.error = error?.message ?? String(error);
  await writeOutputIfRequested(summary).catch(() => undefined);
  throw error;
} finally {
  await new Promise((resolve) => proxyServer.close(() => resolve()));
}
