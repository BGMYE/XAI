import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import worker from "../cloudflare-worker/src/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "image-studio", "frontend", "dist");
const port = Number(process.env.RUNTIME_SMOKE_PORT || 41743);
const origin = `http://127.0.0.1:${port}`;

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".ttf": "font/ttf",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

const injected = `
<script>
(() => {
  const now = Date.now();
  localStorage.setItem("gptcodex.theme", "dark");
  localStorage.setItem("gptcodex.fontScale", "1");
  localStorage.setItem("gptcodex.kernelRuntimeMode", "remote");
  localStorage.setItem("gptcodex.outputFormat", "png");
  localStorage.setItem("gptcodex.profiles", JSON.stringify([{
    id: "p-smoke",
    name: "Smoke Worker",
    apiMode: "responses",
    baseURL: "${origin}",
    textModelID: "gpt-5.5",
    imageModelID: "gpt-image-2",
    concurrencyLimit: 0,
    createdAt: now,
    lastUsedAt: now
  }]));
  localStorage.setItem("gptcodex.activeProfileId", "p-smoke");
})();
</script>`;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function handleMockUpstream(req, body) {
  if (req.method === "GET" && req.url === "/mock-upstream/v1/models") {
    return json({ data: [{ id: "gpt-5.5" }, { id: "gpt-image-2" }] });
  }

  if (req.method === "POST" && req.url === "/mock-upstream/v1/responses") {
    const payload = JSON.parse(body.toString("utf8") || "{}");
    if (payload.instructions && !payload.tools) {
      return json({ output_text: "optimized prompt from smoke upstream" });
    }
    return new Response(
      'data: {"type":"response.created"}\n' +
      'data: {"type":"response.in_progress"}\n' +
      'data: {"type":"response.output_item.done","item":{"type":"image_generation_call","result":"c21va2UtaW1hZ2U=","revised_prompt":"smoke revised prompt"}}\n',
      {
        status: 200,
        headers: { "content-type": "text/event-stream; charset=utf-8" },
      },
    );
  }

  if (req.method === "POST" && req.url === "/mock-upstream/v1/images/generations") {
    return json({ data: [{ b64_json: "aW1hZ2VzLXNtb2tl", revised_prompt: "smoke images revised" }] });
  }

  if (req.method === "POST" && req.url === "/mock-upstream/v1/images/edits") {
    return json({ data: [{ b64_json: "ZWRpdC1zbW9rZQ==", revised_prompt: "smoke edit revised" }] });
  }

  return json({ error: { message: `mock upstream not found: ${req.method} ${req.url}` } }, 404);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", origin);

    if (url.pathname.startsWith("/mock-upstream/")) {
      const body = await readBody(req);
      const response = await handleMockUpstream(
        { method: req.method ?? "GET", url: url.pathname + url.search },
        body,
      );
      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }

    if (
      url.pathname === "/v1/models"
      || url.pathname === "/v1/responses"
      || url.pathname === "/v1/images/generations"
      || url.pathname === "/v1/images/edits"
      || url.pathname === "/kernel/prompt-optimize"
      || url.pathname === "/kernel/generate"
    ) {
      const body = await readBody(req);
      const request = new Request(origin + url.pathname + url.search, {
        method: req.method,
        headers: {
          ...Object.fromEntries(Object.entries(req.headers).filter(([, value]) => typeof value === "string")),
          "x-image-studio-upstream-base-url": origin + "/mock-upstream",
        },
        body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
      });
      const response = await worker.fetch(request, {
        IMAGE_STUDIO_UPSTREAM_BASE_URL: origin + "/mock-upstream",
      });
      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }

    const path = url.pathname === "/" ? "/index.html" : url.pathname;
    const full = join(dist, path);
    let file = await readFile(full);
    if (path.endsWith("index.html")) {
      file = Buffer.from(String(file).replace("</head>", `${injected}</head>`));
    }
    res.writeHead(200, { "content-type": mime[extname(path)] ?? "application/octet-stream" });
    res.end(file);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});

server.on("error", (error) => {
  const message = error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error);
  console.error(`runtime-smoke-server listen failed: ${message}`);
  process.exitCode = 1;
});

server.listen(port, "127.0.0.1", () => {
  console.log(origin);
});
