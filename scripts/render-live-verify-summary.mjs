import { readFile } from "node:fs/promises";

const summaryPath = process.argv[2];
if (!summaryPath) {
  throw new Error("usage: node scripts/render-live-verify-summary.mjs <live-verify.json>");
}

const summary = JSON.parse(await readFile(summaryPath, "utf8"));

function formatEntry(label, entry) {
  const status = entry?.status ?? "?";
  const summaryPart = JSON.stringify(entry?.summary ?? {});
  return `| ${label} | ${status} | \`${summaryPart.replace(/\|/g, "\\|")}\` |`;
}

function icon(status) {
  if (status === "passed") return "✅";
  if (status === "failed") return "❌";
  return "•";
}

const lines = [];
lines.push("## Live Verify Platform Kernel");
lines.push("");
if (summary.status) lines.push(`- Status: **${summary.status}**`);
if (summary.startedAt) lines.push(`- Started: \`${summary.startedAt}\``);
if (summary.completedAt) lines.push(`- Completed: \`${summary.completedAt}\``);
lines.push(`- Upstream: \`${summary.upstreamBaseURL ?? "(missing)"}\``);

if (summary.environment) {
  lines.push("");
  lines.push("### Environment");
  lines.push("");
  lines.push(`- Node: \`${summary.environment.nodeVersion ?? "?"}\``);
  lines.push(`- Platform: \`${summary.environment.platform ?? "?"}\` / \`${summary.environment.arch ?? "?"}\``);
  lines.push(`- Text model: \`${summary.environment.textModelID ?? "?"}\``);
  lines.push(`- Image model: \`${summary.environment.imageModelID ?? "?"}\``);
  lines.push(`- Worker port: \`${summary.environment.port ?? "?"}\``);
}

lines.push("");
lines.push("| Route | Status | Summary |");
lines.push("|---|---:|---|");
lines.push(formatEntry("direct models", summary.directModels));
lines.push(formatEntry("worker models", summary.workerModels));
lines.push(formatEntry("direct optimize", summary.directOptimize));
lines.push(formatEntry("worker optimize", summary.workerOptimize));
lines.push(formatEntry("direct responses", summary.directResponses));
lines.push(formatEntry("worker responses", summary.workerResponses));
lines.push(formatEntry("direct images generate", summary.directImagesGenerate));
lines.push(formatEntry("worker images generate", summary.workerImagesGenerate));
lines.push(formatEntry("direct images edit", summary.directImagesEdit));
lines.push(formatEntry("worker images edit", summary.workerImagesEdit));

if (Array.isArray(summary.checks) && summary.checks.length > 0) {
  const passed = summary.checks.filter((check) => check.status === "passed").length;
  const failed = summary.checks.filter((check) => check.status === "failed").length;
  lines.push("");
  lines.push("### Checks");
  lines.push("");
  lines.push(`- Passed: ${passed}`);
  lines.push(`- Failed: ${failed}`);
  lines.push("");
  lines.push("| Check | Status | Detail |");
  lines.push("|---|---|---|");
  for (const check of summary.checks) {
    lines.push(`| ${check.name} | ${icon(check.status)} ${check.status} | ${String(check.detail ?? "").replace(/\|/g, "\\|")} |`);
  }
}

if (summary.status === "failed" && summary.error) {
  lines.push("");
  lines.push("### Failure");
  lines.push("");
  lines.push("```text");
  lines.push(String(summary.error));
  lines.push("```");
}

process.stdout.write(`${lines.join("\n")}\n`);
