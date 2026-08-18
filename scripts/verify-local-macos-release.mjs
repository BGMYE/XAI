import { spawn } from "node:child_process";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { resolveVerifyOutputPath } from "./verify-output-paths.mjs";

const root = process.cwd();
const projectRoot = `${root}/image-studio`;
const appBundle = `${projectRoot}/build/bin/Image Studio.app`;
const executable = `${appBundle}/Contents/MacOS/image-studio`;
const plistPath = `${appBundle}/Contents/Info.plist`;

function run(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: options.cwd ?? root,
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    let timeout = null;
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    if (options.timeoutMs) {
      timeout = setTimeout(() => {
        child.kill("SIGKILL");
      }, options.timeoutMs);
    }
    child.on("error", reject);
    child.on("exit", (code) => {
      if (timeout) clearTimeout(timeout);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} ${args.join(" ")} exited with ${code ?? 1}\n${stderr || stdout}`));
    });
  });
}

async function runWithRetry(cmd, args, options = {}, attempts = 3, delayMs = 1000) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await run(cmd, args, options);
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) break;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

const packEnv = {
  VITE_APP_VERSION: process.env.VITE_APP_VERSION ?? "1.1.13-ci.local+verify",
};
const skipRuntimeUpdateProbe = /^(1|true)$/i.test(process.env.IMAGE_STUDIO_SKIP_RUNTIME_UPDATE_PROBE ?? "");
const outputPath = resolveVerifyOutputPath("IMAGE_STUDIO_MACOS_VERIFY_OUTPUT_PATH", "macos-release.json");
const summary = {
  startedAt: new Date().toISOString(),
  status: "running",
  environment: {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    appBundle,
    executable,
    plistPath,
    viteAppVersion: packEnv.VITE_APP_VERSION,
    runtimeUpdateProbeSkipped: skipRuntimeUpdateProbe,
  },
};

function semverCore(value) {
  const match = String(value).trim().replace(/^v/i, "").match(/^(\d+\.\d+\.\d+)/);
  return match?.[1] ?? "";
}

async function writeOutputIfRequested(payload) {
  if (!outputPath) return;
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function withFakeLatestRelease(fn) {
  const latestVersion = semverCore(packEnv.VITE_APP_VERSION);
  if (!latestVersion) {
    throw new Error(`VITE_APP_VERSION must start with semver core, got: ${packEnv.VITE_APP_VERSION}`);
  }
  const payload = JSON.stringify({
    tag_name: `v${latestVersion}`,
    name: `v${latestVersion}`,
    html_url: `https://example.com/releases/v${latestVersion}`,
    published_at: "2026-06-07T00:00:00Z",
    body: "bugfixes",
    draft: false,
    prerelease: false,
  });
  const server = createServer((req, res) => {
    if (req.url !== "/latest.json") {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(payload);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  try {
    return await fn(`http://127.0.0.1:${port}/latest.json`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function waitForFile(filePath, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      return await readFile(filePath, "utf8");
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  throw lastError ?? new Error(`timed out waiting for ${filePath}`);
}

function shouldRetryOpenProbeError(message) {
  return /kLSNoExecutableErr/.test(message);
}

async function launchProbeAppWithArgs({ apiURL, probePath, stdoutPath, stderrPath, timeoutMs }) {
  return run("open", [
    "-W",
    "-n",
    "-g",
    "--stdout", stdoutPath,
    "--stderr", stderrPath,
    appBundle,
    "--args",
    `${"--image-studio-latest-release-api-url"}=${apiURL}`,
    `${"--image-studio-app-update-probe-path"}=${probePath}`,
    "--image-studio-app-update-probe-quit",
  ], {
    cwd: root,
    timeoutMs,
  });
}

async function verifyRuntimeUpdateProbe() {
  const tempHome = await mkdtemp(path.join(os.tmpdir(), "image-studio-probe-home-"));
  const probePath = path.join(tempHome, "app-update-probe.json");
  const stdoutPath = path.join(tempHome, "stdout.log");
  const stderrPath = path.join(tempHome, "stderr.log");
  try {
    const probe = await withFakeLatestRelease(async (apiURL) => {
      for (let attempt = 1; attempt <= 3; attempt++) {
        await writeFile(stdoutPath, "", "utf8");
        await writeFile(stderrPath, "", "utf8");
        try {
          await launchProbeAppWithArgs({
            apiURL,
            probePath,
            stdoutPath,
            stderrPath,
            timeoutMs: 20000,
          });
          break;
        } catch (error) {
          const message = String(error?.message ?? error);
          if (attempt < 3 && shouldRetryOpenProbeError(message)) {
            await new Promise((resolve) => setTimeout(resolve, 800));
            continue;
          }
          let stdoutLog = "";
          let stderrLog = "";
          try {
            stdoutLog = await readFile(stdoutPath, "utf8");
          } catch {}
          try {
            stderrLog = await readFile(stderrPath, "utf8");
          } catch {}
          throw new Error(
            "runtime update probe could not launch the compiled macOS app in the current environment.\n"
            + "Please rerun from an interactive macOS desktop session, or set IMAGE_STUDIO_SKIP_RUNTIME_UPDATE_PROBE=1 to skip this step.\n\n"
            + message
            + (stdoutLog.trim() ? `\n\nstdout:\n${stdoutLog}` : "")
            + (stderrLog.trim() ? `\n\nstderr:\n${stderrLog}` : ""),
          );
        }
      }
      return JSON.parse(await waitForFile(probePath));
    });
    if (probe.appVersion !== packEnv.VITE_APP_VERSION) {
      throw new Error(`probe appVersion mismatch: ${probe.appVersion}`);
    }
    if (probe.currentVersion !== packEnv.VITE_APP_VERSION) {
      throw new Error(`probe currentVersion mismatch: ${probe.currentVersion}`);
    }
    if (probe.latestVersion !== semverCore(packEnv.VITE_APP_VERSION)) {
      throw new Error(`probe latestVersion mismatch: ${probe.latestVersion}`);
    }
    if (probe.hasUpdate !== false || probe.shouldShowUpdate !== false || probe.appUpdateModalOpen !== false) {
      throw new Error(`probe still reports update: ${JSON.stringify(probe)}`);
    }
    return probe;
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
}

let capturedError = null;
try {
  await runWithRetry("bash", ["scripts/package-local-macos-app.sh"], { cwd: root, env: packEnv });
  summary.packageScript = "ok";

  const frontendBuild = await runWithRetry("npm", ["run", "build:macos"], { cwd: `${projectRoot}/frontend` });
  summary.frontendBuild = /built in/.test(frontendBuild.stdout);

  const goTest = await run("go", ["test", "./..."], {
    cwd: projectRoot,
    env: {
      GOPATH: `${root}/.gopath`,
      GOMODCACHE: `${root}/.gomodcache`,
      GOCACHE: `${root}/.gocache`,
    },
  });
  summary.goTest = /ok\s+image-studio\/backend/.test(goTest.stdout) || /\[no test files\]/.test(goTest.stdout);

  const lipoInfo = await run("lipo", ["-info", executable]);
  const codesignInfo = await run("codesign", ["-dv", "--verbose=2", appBundle]);
  const plistInfo = await run("plutil", ["-p", plistPath]);
  const plistRaw = await readFile(plistPath, "utf8");
  const runtimeProbe = skipRuntimeUpdateProbe
    ? { skipped: true, reason: "IMAGE_STUDIO_SKIP_RUNTIME_UPDATE_PROBE" }
    : await verifyRuntimeUpdateProbe();

  const requiredPlistSnippets = [
    "<string>top.gptcodex.imagestudio</string>",
    "<string>Image Studio</string>",
    "<string>image-studio</string>",
  ];

  for (const snippet of requiredPlistSnippets) {
    if (!plistRaw.includes(snippet)) {
      throw new Error(`Info.plist missing expected snippet: ${snippet}`);
    }
  }

  if (!plistInfo.stdout.includes(`"CFBundleShortVersionString" => "${packEnv.VITE_APP_VERSION}"`)) {
    throw new Error(`CFBundleShortVersionString does not match VITE_APP_VERSION:\n${plistInfo.stdout}`);
  }

  if (!plistInfo.stdout.includes(`"CFBundleVersion" => "${packEnv.VITE_APP_VERSION}"`)) {
    throw new Error(`CFBundleVersion does not match VITE_APP_VERSION:\n${plistInfo.stdout}`);
  }

  if (!/x86_64 arm64/.test(lipoInfo.stdout)) {
    throw new Error(`universal binary verification failed: ${lipoInfo.stdout}`);
  }

  if (!/Identifier=top\.gptcodex\.imagestudio/.test(codesignInfo.stdout + codesignInfo.stderr)) {
    throw new Error(`codesign output missing expected bundle identifier:\n${codesignInfo.stdout}\n${codesignInfo.stderr}`);
  }

  summary.universalBinary = lipoInfo.stdout.trim();
  summary.codesign = (codesignInfo.stdout + codesignInfo.stderr).trim();
  summary.plistVerified = true;
  summary.runtimeUpdateProbe = runtimeProbe;
  summary.status = "passed";
  summary.completedAt = new Date().toISOString();
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  capturedError = error;
  summary.status = "failed";
  summary.completedAt = new Date().toISOString();
  summary.error = error?.message ?? String(error);
} finally {
  await writeOutputIfRequested(summary).catch(() => undefined);
  if (capturedError) throw capturedError;
}
