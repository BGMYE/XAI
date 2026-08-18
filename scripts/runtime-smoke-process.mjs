import { spawn } from "node:child_process";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function waitForChildExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve) => child.once("exit", () => resolve()));
}

export function smokeServerExitError(child, stderr) {
  if (child.exitCode === null && child.signalCode === null) return null;
  const detail = stderr.trim() || `exitCode=${child.exitCode ?? "null"} signal=${child.signalCode ?? "null"}`;
  return new Error(`runtime-smoke-server exited before becoming ready\n${detail}`);
}

export async function waitForRuntimeSmokeServer(origin, child, stderrRef, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    const exitError = smokeServerExitError(child, stderrRef());
    if (exitError) throw exitError;
    try {
      const response = await fetch(`${origin}/v1/models`, {
        method: "GET",
        headers: { Authorization: "Bearer smoke-key" },
      });
      if (response.ok) return;
      lastError = new Error(`server responded ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    const exitErrorAfterRequest = smokeServerExitError(child, stderrRef());
    if (exitErrorAfterRequest) throw exitErrorAfterRequest;
    await sleep(250);
  }
  throw lastError ?? new Error("server did not start in time");
}

export function startRuntimeSmokeServer({ cwd, port }) {
  const child = spawn(process.execPath, ["scripts/runtime-smoke-server.mjs"], {
    cwd,
    env: { ...process.env, RUNTIME_SMOKE_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });

  return {
    child,
    getStderr: () => stderr,
  };
}
