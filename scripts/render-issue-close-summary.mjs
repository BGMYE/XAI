import { readFile } from "node:fs/promises";

const summaryPath = process.argv[2];
if (!summaryPath) {
  throw new Error("usage: node scripts/render-issue-close-summary.mjs <issue-close-tooling.json> [export-manifest.json]");
}
const exportManifestPath = process.argv[3] || "";

const summary = JSON.parse(await readFile(summaryPath, "utf8"));
let exportManifest = null;
if (exportManifestPath) {
  try {
    exportManifest = JSON.parse(await readFile(exportManifestPath, "utf8"));
  } catch {
    exportManifest = null;
  }
}

function icon(status) {
  if (status === "passed") return "✅";
  if (status === "failed") return "❌";
  if (status === "skipped") return "⏭️";
  return "•";
}

const lines = [];
lines.push("## Issue Close Tooling");
lines.push("");
lines.push(`- Status: **${summary.status ?? "unknown"}**`);
if (summary.startedAt) lines.push(`- Started: \`${summary.startedAt}\``);
if (summary.completedAt) lines.push(`- Completed: \`${summary.completedAt}\``);

if (summary.environment) {
  lines.push("");
  lines.push("### Environment");
  lines.push("");
  lines.push(`- Node: \`${summary.environment.nodeVersion ?? "?"}\``);
  lines.push(`- Platform: \`${summary.environment.platform ?? "?"}\` / \`${summary.environment.arch ?? "?"}\``);
  lines.push(`- GitHub sync skipped: ${summary.environment.skipGitHubSync ? "yes" : "no"}`);
}

if (summary.githubSync) {
  lines.push("");
  lines.push("### GitHub Sync");
  lines.push("");
  lines.push(`- Status: ${summary.githubSync.status ?? "unknown"}`);
  if (typeof summary.githubSync.closable === "number") lines.push(`- Closable open issues: ${summary.githubSync.closable}`);
  if (typeof summary.githubSync.holdOpen === "number") lines.push(`- Hold-open issues: ${summary.githubSync.holdOpen}`);
  if (typeof summary.githubSync.deferred === "number") lines.push(`- Deferred issues: ${summary.githubSync.deferred}`);
  if (typeof summary.githubSync.unexpectedOpen === "number") lines.push(`- Unexpected open issues: ${summary.githubSync.unexpectedOpen}`);
  if (summary.githubSync.reason) lines.push(`- Reason: ${summary.githubSync.reason}`);
}

const exportBundle = summary.exportBundle ?? exportManifest;

if (exportBundle) {
  lines.push("");
  lines.push("### Export Bundle");
  lines.push("");
  lines.push(`- Output dir: \`${exportBundle.outputDir ?? "?"}\``);
  if (typeof exportBundle.defaultPlanMode === "string") {
    lines.push(`- Default plan mode: \`${exportBundle.defaultPlanMode}\``);
  }
  if (typeof exportBundle.closableCount === "number") {
    lines.push(`- Closable issues in bundle: ${exportBundle.closableCount}`);
  } else if (Array.isArray(exportBundle.closable)) {
    lines.push(`- Closable issues in bundle: ${exportBundle.closable.length}`);
  }
  if (typeof exportBundle.fileCount === "number") {
    lines.push(`- Comment files: ${exportBundle.fileCount}`);
  }
  if (typeof exportBundle.planFile === "string") {
    lines.push(`- Plan JSON: \`${exportBundle.planFile}\``);
  } else if (typeof exportBundle.planJsonPath === "string") {
    lines.push(`- Plan JSON: \`${exportBundle.planJsonPath}\``);
  }
  if (typeof exportBundle.planMarkdownFile === "string") {
    lines.push(`- Plan Markdown: \`${exportBundle.planMarkdownFile}\``);
  } else if (typeof exportBundle.planMarkdownPath === "string") {
    lines.push(`- Plan Markdown: \`${exportBundle.planMarkdownPath}\``);
  }
}

if (summary.mockApply) {
  lines.push("");
  lines.push("### Mock Apply");
  lines.push("");
  lines.push(`- Status: ${summary.mockApply.status ?? "unknown"}`);
  if (typeof summary.mockApply.commentOnlyIssue === "number") {
    lines.push(`- Comment-only issue: #${summary.mockApply.commentOnlyIssue}`);
  }
  if (typeof summary.mockApply.commentAndCloseIssue === "number") {
    lines.push(`- Comment-and-close issue: #${summary.mockApply.commentAndCloseIssue}`);
  }
  if (typeof summary.mockApply.commentCount === "number") {
    lines.push(`- Mock comments posted: ${summary.mockApply.commentCount}`);
  }
  if (typeof summary.mockApply.patchCount === "number") {
    lines.push(`- Mock close patches sent: ${summary.mockApply.patchCount}`);
  }
}

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
