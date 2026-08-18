import { readFile } from "node:fs/promises";

const summaryPath = process.argv[2];
if (!summaryPath) {
  throw new Error("usage: node scripts/render-verify-platform-summary.mjs <summary.json>");
}

function readJson(path) {
  return readFile(path, "utf8").then((raw) => JSON.parse(raw));
}

function icon(status) {
  if (status === "passed") return "✅";
  if (status === "failed") return "❌";
  if (status === "running") return "⏳";
  return "•";
}

function formatMs(ms) {
  if (typeof ms !== "number") return "";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

const summary = await readJson(summaryPath);

const lines = [];
lines.push("## Verify Platform Kernel");
lines.push("");
lines.push(`- Status: **${summary.status}**`);
if (summary.startedAt) lines.push(`- Started: \`${summary.startedAt}\``);
if (summary.completedAt) lines.push(`- Completed: \`${summary.completedAt}\``);

if (summary.environment) {
  lines.push("");
  lines.push("### Environment");
  lines.push("");
  lines.push(`- Node: \`${summary.environment.nodeVersion ?? "?"}\``);
  lines.push(`- Platform: \`${summary.environment.platform ?? "?"}\` / \`${summary.environment.arch ?? "?"}\``);
  lines.push(`- Android SDK: \`${summary.environment.androidSdkRoot ?? "?"}\``);
  lines.push(`- JAVA_HOME: \`${summary.environment.javaHome ?? "?"}\``);
  lines.push(`- Runtime update probe skipped: ${summary.environment.runtimeUpdateProbeSkipped ? "yes" : "no"}`);
  lines.push(`- Issue close verify included: ${summary.environment.issueCloseVerifyIncluded ? "yes" : "no"}`);
}

lines.push("");
lines.push("### Steps");
lines.push("");
lines.push("| Step | Status | Duration | Result |");
lines.push("|---|---|---:|---|");
for (const step of summary.steps ?? []) {
  const result = step.resultFile ? `\`${step.resultFile}\`` : "";
  lines.push(`| ${step.label} | ${icon(step.status)} ${step.status} | ${formatMs(step.elapsedMs)} | ${result} |`);
}

if (summary.resultFiles) {
  lines.push("");
  lines.push("### Result Files");
  lines.push("");
  for (const [label, file] of Object.entries(summary.resultFiles)) {
    if (!file) continue;
    lines.push(`- \`${label}\`: \`${file}\``);
  }
}

try {
  const livePath = summary.resultFiles?.liveVerify;
  if (livePath) {
    const live = await readJson(livePath);
    const passed = Array.isArray(live.checks) ? live.checks.filter((check) => check.status === "passed").length : 0;
    const failed = Array.isArray(live.checks) ? live.checks.filter((check) => check.status === "failed").length : 0;
    lines.push("");
    lines.push("### Local Live Verify");
    lines.push("");
    lines.push(`- Upstream: \`${live.upstreamBaseURL ?? "(missing)"}\``);
    lines.push(`- Status: ${live.status ?? "unknown"}`);
    lines.push(`- Checks: passed=${passed}, failed=${failed}`);
    if (live.status === "failed" && live.error) {
      lines.push(`- Error: ${String(live.error).replace(/\n/g, " ")}`);
    }
  }
} catch {}

try {
  const smokePath = summary.resultFiles?.localSmoke;
  if (smokePath) {
    const smoke = await readJson(smokePath);
    lines.push("");
    lines.push("### Smoke Snapshot");
    lines.push("");
    lines.push(`- Status: ${smoke.status ?? "unknown"}`);
    if (smoke.status === "failed" && smoke.error) {
      lines.push(`- Error: ${String(smoke.error).replace(/\n/g, " ")}`);
    }
    lines.push(`- Models: ${smoke.models?.ids?.join(", ") ?? "(missing)"}`);
    lines.push(`- Responses status: ${smoke.responses?.status ?? "?"}`);
    lines.push(`- Images generate status: ${smoke.imagesGenerate?.status ?? "?"}`);
    lines.push(`- Images edit status: ${smoke.imagesEdit?.status ?? "?"}`);
    lines.push(`- Prompt optimize status: ${smoke.optimize?.status ?? "?"}`);
  }
} catch {}

try {
  const androidPath = summary.resultFiles?.androidShell;
  if (androidPath) {
    const android = await readJson(androidPath);
    lines.push("");
    lines.push("### Android Shell");
    lines.push("");
    lines.push(`- Status: ${android.status ?? "unknown"}`);
    if (android.status === "failed" && android.error) {
      lines.push(`- Error: ${String(android.error).replace(/\n/g, " ")}`);
    }
    lines.push(`- Unit tests: ${android.unitTests === true ? "passed" : "unknown"}`);
    lines.push(`- APK: \`${android.metadata?.applicationId ?? "?"}\` @ \`${android.metadata?.versionName ?? "?"}\` (${android.metadata?.versionCode ?? "?"})`);
    lines.push(`- Assets embedded: ${android.assetsVerified === true ? "yes" : "no"}`);
    lines.push(`- Device smoke: ${android.deviceSmoke?.attempted ? `attempted on \`${android.deviceSmoke.serial}\`` : android.deviceSmoke?.reason ?? "not attempted"}`);
  }
} catch {}

try {
  const macosPath = summary.resultFiles?.macosRelease;
  if (macosPath) {
    const macos = await readJson(macosPath);
    lines.push("");
    lines.push("### macOS Release");
    lines.push("");
    lines.push(`- Status: ${macos.status ?? "unknown"}`);
    if (macos.status === "failed" && macos.error) {
      lines.push(`- Error: ${String(macos.error).replace(/\n/g, " ")}`);
    }
    lines.push(`- Plist verified: ${macos.plistVerified === true ? "yes" : "no"}`);
    lines.push(`- Universal binary: ${String(macos.universalBinary ?? "").replace(/\|/g, "\\|")}`);
    const probe = macos.runtimeUpdateProbe;
    if (probe?.skipped) {
      lines.push(`- Runtime update probe: skipped (${probe.reason})`);
    } else if (probe) {
      lines.push(`- Runtime update probe: hasUpdate=${probe.hasUpdate}, shouldShowUpdate=${probe.shouldShowUpdate}`);
    }
  }
} catch {}

try {
  const issueClosePath = summary.resultFiles?.issueCloseTooling;
  if (issueClosePath) {
    const issueClose = await readJson(issueClosePath);
    lines.push("");
    lines.push("### Issue Close Tooling");
    lines.push("");
    lines.push(`- Status: ${issueClose.status ?? "unknown"}`);
    if (issueClose.status === "failed" && issueClose.error) {
      lines.push(`- Error: ${String(issueClose.error).replace(/\n/g, " ")}`);
    }
    const passed = Array.isArray(issueClose.checks) ? issueClose.checks.filter((check) => check.status === "passed").length : 0;
    const failed = Array.isArray(issueClose.checks) ? issueClose.checks.filter((check) => check.status === "failed").length : 0;
    lines.push(`- Checks: passed=${passed}, failed=${failed}`);
    if (issueClose.githubSync) {
      lines.push(`- GitHub sync: ${issueClose.githubSync.status}`);
      if (typeof issueClose.githubSync.closable === "number") {
        lines.push(`- GitHub groups: closable=${issueClose.githubSync.closable}, holdOpen=${issueClose.githubSync.holdOpen ?? 0}, deferred=${issueClose.githubSync.deferred ?? 0}, unexpected=${issueClose.githubSync.unexpectedOpen ?? 0}`);
      }
    }
    if (issueClose.exportBundle) {
      lines.push(`- Export bundle: issues=${issueClose.exportBundle.closableCount ?? "?"}, files=${issueClose.exportBundle.fileCount ?? "?"}`);
      if (issueClose.exportBundle.preserved && summary.resultFiles?.issueCloseExportManifest) {
        lines.push(`- Export manifest: \`${summary.resultFiles.issueCloseExportManifest}\``);
      }
    }
    if (issueClose.mockApply) {
      lines.push(`- Mock apply: commentOnly=#${issueClose.mockApply.commentOnlyIssue ?? "?"}, commentAndClose=#${issueClose.mockApply.commentAndCloseIssue ?? "?"}`);
    }
  }
} catch {}

if (summary.status === "failed" && summary.error) {
  lines.push("");
  lines.push("### Failure");
  lines.push("");
  lines.push("```text");
  lines.push(String(summary.error));
  lines.push("```");
}

process.stdout.write(`${lines.join("\n")}\n`);
