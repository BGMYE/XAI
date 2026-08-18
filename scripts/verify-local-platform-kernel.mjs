import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveVerifyOutputPath } from "./verify-output-paths.mjs";

const root = process.cwd();
const androidSdkRoot = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME || `${root}/.tmp/android-sdk`;
const javaHome = process.env.IMAGE_STUDIO_JAVA_HOME || process.env.JAVA_HOME || `${root}/.tmp/jdk/jdk-17.0.19+10/Contents/Home`;
const androidUserHome = process.env.ANDROID_USER_HOME || `${root}/.tmp/android-home/.android`;
const homeDir = process.env.HOME || `${root}/.tmp/android-home`;
const summaryOutputPath = resolveVerifyOutputPath("IMAGE_STUDIO_PLATFORM_KERNEL_OUTPUT_PATH", "platform-kernel-summary.json");
const includeIssueCloseVerify = /^(1|true)$/i.test(process.env.IMAGE_STUDIO_INCLUDE_ISSUE_CLOSE_VERIFY ?? "");
const defaultIssueCloseGitHubSyncSkip = (process.env.IMAGE_STUDIO_SKIP_ISSUE_CLOSE_GITHUB_SYNC ?? "").trim()
  || ((process.env.GITHUB_TOKEN || process.env.GH_TOKEN) ? "" : "1");

function runStep(step) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(step.cmd, step.args, {
      cwd: step.cwd,
      env: { ...process.env, ...(step.env ?? {}) },
      stdio: "inherit",
      shell: false,
    });
    child.on("exit", (code) => {
      const elapsedMs = Date.now() - startedAt;
      if (code === 0) resolve({ elapsedMs });
      else reject(Object.assign(new Error(`${step.label} exited with code ${code ?? 1}`), { elapsedMs }));
    });
    child.on("error", reject);
  });
}

async function writeSummaryIfRequested(summary) {
  if (!summaryOutputPath) return;
  await mkdir(path.dirname(summaryOutputPath), { recursive: true });
  await writeFile(summaryOutputPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
}

function resultFileEntry(envName, defaultFileName) {
  const value = resolveVerifyOutputPath(envName, defaultFileName).trim();
  return value ? value : null;
}

const steps = [
  {
    label: "frontend test",
    cmd: "npm",
    args: ["run", "test"],
    cwd: `${root}/image-studio/frontend`,
  },
  {
    label: "frontend build",
    cmd: "npm",
    args: ["run", "build"],
    cwd: `${root}/image-studio/frontend`,
  },
  {
    label: "worker test",
    cmd: "npm",
    args: ["run", "test"],
    cwd: `${root}/cloudflare-worker`,
  },
  {
    label: "local live verify",
    cmd: "node",
    args: ["scripts/verify-local-live-verify.mjs"],
    cwd: root,
    resultFile: resultFileEntry("IMAGE_STUDIO_LIVE_VERIFY_OUTPUT_PATH", "live-verify.json"),
  },
  {
    label: "local smoke check",
    cmd: "node",
    args: ["scripts/local-smoke-check.mjs"],
    cwd: root,
    resultFile: resultFileEntry("IMAGE_STUDIO_SMOKE_VERIFY_OUTPUT_PATH", "local-smoke.json"),
  },
  {
    label: "android shell verify",
    cmd: "node",
    args: ["scripts/verify-local-android-shell.mjs"],
    cwd: root,
    env: {
      JAVA_HOME: javaHome,
      ANDROID_HOME: androidSdkRoot,
      ANDROID_SDK_ROOT: androidSdkRoot,
      ANDROID_USER_HOME: androidUserHome,
      HOME: homeDir,
      GRADLE_USER_HOME: `${root}/.tmp/gradle-home-arm64`,
      IMAGE_STUDIO_ANDROID_USE_PREBUILT_FRONTEND: "1",
    },
    resultFile: resultFileEntry("IMAGE_STUDIO_ANDROID_VERIFY_OUTPUT_PATH", "android-shell.json"),
  },
  {
    label: "image-studio go test",
    cmd: "go",
    args: ["test", "./..."],
    cwd: `${root}/image-studio`,
    env: {
      GOPATH: `${root}/.gopath`,
      GOMODCACHE: `${root}/.gomodcache`,
      GOCACHE: `${root}/.gocache`,
    },
  },
  {
    label: "shared compat-go test",
    cmd: "go",
    args: ["test", "./..."],
    cwd: `${root}/shared/compat-go`,
    env: {
      GOPATH: `${root}/.gopath`,
      GOMODCACHE: `${root}/.gomodcache`,
      GOCACHE: `${root}/.gocache`,
    },
  },
  {
    label: "go-cli client test",
    cmd: "go",
    args: ["test", "./pkg/client"],
    cwd: `${root}/go-cli`,
    env: {
      GOPATH: `${root}/.gopath`,
      GOMODCACHE: `${root}/.gomodcache`,
      GOCACHE: `${root}/.gocache`,
    },
  },
  {
    label: "local macOS release verify",
    cmd: "node",
    args: ["scripts/verify-local-macos-release.mjs"],
    cwd: root,
    resultFile: resultFileEntry("IMAGE_STUDIO_MACOS_VERIFY_OUTPUT_PATH", "macos-release.json"),
  },
];

if (includeIssueCloseVerify) {
  steps.push({
    label: "issue close tooling verify",
    cmd: "node",
    args: ["scripts/verify-issue-close-tooling.mjs"],
    cwd: root,
    env: {
      IMAGE_STUDIO_SKIP_ISSUE_CLOSE_GITHUB_SYNC: defaultIssueCloseGitHubSyncSkip,
    },
    resultFile: resultFileEntry("IMAGE_STUDIO_ISSUE_CLOSE_VERIFY_OUTPUT_PATH", "issue-close-tooling.json"),
  });
}

const summary = {
  startedAt: new Date().toISOString(),
  status: "running",
  environment: {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    androidSdkRoot,
    javaHome,
    androidUserHome,
    homeDir,
    runtimeUpdateProbeSkipped: /^(1|true)$/i.test(process.env.IMAGE_STUDIO_SKIP_RUNTIME_UPDATE_PROBE ?? ""),
    issueCloseVerifyIncluded: includeIssueCloseVerify,
    issueCloseGitHubSyncSkippedByDefault: defaultIssueCloseGitHubSyncSkip !== "",
  },
  resultFiles: {
    liveVerify: resultFileEntry("IMAGE_STUDIO_LIVE_VERIFY_OUTPUT_PATH", "live-verify.json"),
    localSmoke: resultFileEntry("IMAGE_STUDIO_SMOKE_VERIFY_OUTPUT_PATH", "local-smoke.json"),
    androidShell: resultFileEntry("IMAGE_STUDIO_ANDROID_VERIFY_OUTPUT_PATH", "android-shell.json"),
    macosRelease: resultFileEntry("IMAGE_STUDIO_MACOS_VERIFY_OUTPUT_PATH", "macos-release.json"),
    issueCloseTooling: resultFileEntry("IMAGE_STUDIO_ISSUE_CLOSE_VERIFY_OUTPUT_PATH", "issue-close-tooling.json"),
    issueCloseExportManifest: resultFileEntry("IMAGE_STUDIO_ISSUE_CLOSE_EXPORT_MANIFEST_PATH", "issue-close-export-bundle/manifest.json"),
  },
  steps: [],
};

try {
  for (const step of steps) {
    console.log(`\n==> ${step.label}`);
    const record = {
      label: step.label,
      cwd: step.cwd,
      cmd: step.cmd,
      args: step.args,
      resultFile: step.resultFile ?? null,
      status: "running",
      elapsedMs: null,
    };
    summary.steps.push(record);
    const result = await runStep(step);
    record.status = "passed";
    record.elapsedMs = result.elapsedMs;
  }
  summary.status = "passed";
  summary.completedAt = new Date().toISOString();
  await writeSummaryIfRequested(summary);
  console.log("\nAll local platform-kernel verification steps passed.");
} catch (error) {
  const current = summary.steps.findLast((step) => step.status === "running");
  if (current) {
    current.status = "failed";
    current.elapsedMs = error?.elapsedMs ?? current.elapsedMs;
    current.error = error?.message ?? String(error);
  }
  summary.status = "failed";
  summary.completedAt = new Date().toISOString();
  summary.error = error?.message ?? String(error);
  await writeSummaryIfRequested(summary);
  throw error;
}
