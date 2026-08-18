import { spawn } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { pickDistinctFreePort, pickFreePort } from "./pick-free-port.mjs";
import {
  startRuntimeSmokeServer,
  waitForChildExit,
  waitForRuntimeSmokeServer,
} from "./runtime-smoke-process.mjs";
import { resolveVerifyOutputPath } from "./verify-output-paths.mjs";

const root = process.cwd();
const smokePort = process.env.RUNTIME_SMOKE_PORT
  ? Number(process.env.RUNTIME_SMOKE_PORT)
  : await pickFreePort();
const liveVerifyPort = process.env.LIVE_VERIFY_PORT
  ? Number(process.env.LIVE_VERIFY_PORT)
  : await pickDistinctFreePort([smokePort]);
const smokeOrigin = `http://127.0.0.1:${smokePort}`;
const outputPath = resolveVerifyOutputPath("IMAGE_STUDIO_LIVE_VERIFY_OUTPUT_PATH", "live-verify.json");
const summary = {
  startedAt: new Date().toISOString(),
  status: "running",
  environment: {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    smokePort,
    liveVerifyPort,
  },
  smokeOrigin,
};

function run(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      cwd: options.cwd ?? root,
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    proc.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    proc.on("error", reject);
    proc.on("exit", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} ${args.join(" ")} exited with ${code ?? 1}\n${stderr || stdout}`));
    });
  });
}

async function writeOutputIfRequested(payload) {
  if (!outputPath) return;
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function outputFileExists() {
  if (!outputPath) return false;
  try {
    await access(outputPath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

const smoke = startRuntimeSmokeServer({ cwd: root, port: smokePort });
const child = smoke.child;

let capturedError = null;
try {
  await waitForRuntimeSmokeServer(smokeOrigin, child, smoke.getStderr);
  summary.smokeServerReady = true;
  const { stdout } = await run(process.execPath, ["scripts/live-verify.mjs"], {
    cwd: root,
    env: {
      IMAGE_STUDIO_UPSTREAM_BASE_URL: `${smokeOrigin}/mock-upstream`,
      IMAGE_STUDIO_API_KEY: "smoke-key",
      IMAGE_STUDIO_TEXT_MODEL_ID: "gpt-5.5",
      IMAGE_STUDIO_IMAGE_MODEL_ID: "gpt-image-2",
      LIVE_VERIFY_PORT: String(liveVerifyPort),
      IMAGE_STUDIO_LIVE_VERIFY_OUTPUT_PATH: outputPath,
    },
  });
  const parsed = JSON.parse(stdout);
  await writeOutputIfRequested(parsed);
  console.log(JSON.stringify(parsed, null, 2));
} catch (error) {
  capturedError = error;
  summary.status = "failed";
  summary.completedAt = new Date().toISOString();
  summary.error = error?.message ?? String(error);
} finally {
  child.kill("SIGTERM");
  await waitForChildExit(child);
  const smokeStderr = smoke.getStderr().trim();
  if (smokeStderr) {
    summary.smokeServerStderr = smokeStderr;
    process.stderr.write(`${smokeStderr}\n`);
  }
  if (capturedError) {
    if (!(await outputFileExists())) {
      await writeOutputIfRequested(summary).catch(() => undefined);
    }
    throw capturedError;
  }
}
