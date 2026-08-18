import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pickFreePort } from "./pick-free-port.mjs";
import {
  startRuntimeSmokeServer,
  waitForChildExit,
  waitForRuntimeSmokeServer,
} from "./runtime-smoke-process.mjs";
import { resolveVerifyOutputPath } from "./verify-output-paths.mjs";

const port = process.env.RUNTIME_SMOKE_PORT
  ? Number(process.env.RUNTIME_SMOKE_PORT)
  : await pickFreePort();
const origin = `http://127.0.0.1:${port}`;
const outputPath = resolveVerifyOutputPath("IMAGE_STUDIO_SMOKE_VERIFY_OUTPUT_PATH", "local-smoke.json");
const summary = {
  startedAt: new Date().toISOString(),
  status: "running",
  environment: {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    port,
  },
  origin,
};

async function requestJSON(path, init) {
  const response = await fetch(origin + path, init);
  const raw = await response.text();
  return {
    status: response.status,
    raw,
    json: JSON.parse(raw),
  };
}

async function requestText(path, init) {
  const response = await fetch(origin + path, init);
  const raw = await response.text();
  return {
    status: response.status,
    raw,
  };
}

async function writeOutputIfRequested(payload) {
  if (!outputPath) return;
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

const smoke = startRuntimeSmokeServer({ cwd: process.cwd(), port });
const child = smoke.child;

let capturedError = null;
try {
  await waitForRuntimeSmokeServer(origin, child, smoke.getStderr);

  const models = await requestJSON("/v1/models", {
    method: "GET",
    headers: { Authorization: "Bearer smoke-key" },
  });

  const responses = await requestText("/v1/responses", {
    method: "POST",
    headers: {
      Authorization: "Bearer smoke-key",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      apiKey: "smoke-key",
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
      baseURL: origin,
      textModelID: "gpt-5.5",
      imageModelID: "gpt-image-2",
      apiMode: "responses",
      noPromptRevision: false,
    }),
  });

  const imagesGenerate = await requestJSON("/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: "Bearer smoke-key",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-image-2",
      prompt: "bird",
      size: "1024x1024",
      quality: "medium",
      response_format: "b64_json",
    }),
  });

  const form = new FormData();
  form.append("image", new Blob(["png-bytes"], { type: "image/png" }), "source.png");
  form.append("prompt", "make it orange");
  form.append("model", "gpt-image-2");
  form.append("response_format", "b64_json");
  const imagesEdit = await requestJSON("/v1/images/edits", {
    method: "POST",
    headers: {
      Authorization: "Bearer smoke-key",
    },
    body: form,
  });

  const optimize = await requestJSON("/kernel/prompt-optimize", {
    method: "POST",
    headers: {
      Authorization: "Bearer smoke-key",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      baseURL: origin,
      prompt: "cat",
      mode: "generate",
      textModelID: "gpt-5.5",
      sourceDataURLs: [],
    }),
  });

  Object.assign(summary, {
    models: {
      status: models.status,
      ids: models.json.data.map((item) => item.id),
    },
    responses: {
      status: responses.status,
      hasResult: responses.raw.includes('"result":"c21va2UtaW1hZ2U="'),
    },
    imagesGenerate: {
      status: imagesGenerate.status,
      revisedPrompt: imagesGenerate.json.data[0]?.revised_prompt ?? null,
    },
    imagesEdit: {
      status: imagesEdit.status,
      revisedPrompt: imagesEdit.json.data[0]?.revised_prompt ?? null,
    },
    optimize: {
      status: optimize.status,
      outputText: optimize.json.output_text,
    },
  });
  summary.status = "passed";
  summary.completedAt = new Date().toISOString();
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  capturedError = error;
  summary.status = "failed";
  summary.completedAt = new Date().toISOString();
  summary.error = error?.message ?? String(error);
} finally {
  child.kill("SIGTERM");
  await waitForChildExit(child);
  const stderr = smoke.getStderr().trim();
  if (stderr) {
    summary.serverStderr = stderr;
    process.stderr.write(`${stderr}\n`);
  }
  await writeOutputIfRequested(summary).catch(() => undefined);
  if (capturedError) throw capturedError;
}
