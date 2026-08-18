import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const closeDataPath = path.join(repoRoot, "scripts", "issue-close-data.json");
const defaultGitHubAPIBaseURL = "https://api.github.com";

function usage() {
  return [
    "usage:",
    "  node scripts/issue-close-helper.mjs list [--json]",
    "  node scripts/issue-close-helper.mjs comment <issue-number>",
    "  node scripts/issue-close-helper.mjs plan [all|issue-numbers...] [--comment-only|--comment-and-close] [--json]",
    "  node scripts/issue-close-helper.mjs apply <all|issue-numbers...> [--comment-only|--comment-and-close] --execute [--json]",
    "  node scripts/issue-close-helper.mjs export [output-dir]",
    "  node scripts/issue-close-helper.mjs verify-open [--json]",
  ].join("\n");
}

async function readCloseData() {
  const raw = await readFile(closeDataPath, "utf8");
  return JSON.parse(raw);
}

function normaliseCloseData(data) {
  const closable = Array.isArray(data.closable) ? data.closable.map((item) => ({
    number: Number(item.number),
    title: String(item.title ?? "").trim(),
    comment: String(item.comment ?? "").trim(),
  })) : [];
  const holdOpen = Array.isArray(data.holdOpen) ? data.holdOpen.map((item) => ({
    number: Number(item.number),
    title: String(item.title ?? "").trim(),
    reason: String(item.reason ?? "").trim(),
  })) : [];
  const deferred = Array.isArray(data.deferred) ? data.deferred.map((item) => ({
    number: Number(item.number),
    title: String(item.title ?? "").trim(),
    reason: String(item.reason ?? "").trim(),
  })) : [];
  return {
    updatedAt: String(data.updatedAt ?? "").trim(),
    upstreamRepo: String(data.upstreamRepo ?? "").trim(),
    verificationBaseline: data.verificationBaseline && typeof data.verificationBaseline === "object"
      ? {
          summaryCommand: String(data.verificationBaseline.summaryCommand ?? "").trim(),
          summaryStatus: String(data.verificationBaseline.summaryStatus ?? "").trim(),
          summarySteps: Number(data.verificationBaseline.summarySteps ?? 0),
          frontendTests: String(data.verificationBaseline.frontendTests ?? "").trim(),
          resultFiles: Array.isArray(data.verificationBaseline.resultFiles)
            ? data.verificationBaseline.resultFiles.map((item) => String(item).trim()).filter(Boolean)
            : [],
        }
      : null,
    closable: closable.sort((a, b) => a.number - b.number),
    holdOpen: holdOpen.sort((a, b) => a.number - b.number),
    deferred: deferred.sort((a, b) => a.number - b.number),
  };
}

function renderList(items) {
  const lines = [];
  lines.push("| Issue | Title |");
  lines.push("|---|---|");
  for (const item of items) {
    lines.push(`| #${item.number} | ${item.title} |`);
  }
  return lines.join("\n");
}

function issueURL(repo, number) {
  return `https://github.com/${repo}/issues/${number}`;
}

function resolveGitHubAPIBaseURL() {
  return String(process.env.IMAGE_STUDIO_GITHUB_API_BASE_URL || defaultGitHubAPIBaseURL).trim().replace(/\/+$/, "");
}

function repoAPIURL(repo) {
  return `${resolveGitHubAPIBaseURL()}/repos/${repo}`;
}

function shouldSkipIssueCloseGitHubSync() {
  return /^(1|true)$/i.test(process.env.IMAGE_STUDIO_SKIP_ISSUE_CLOSE_GITHUB_SYNC ?? "");
}

function syntheticOpenIssues(data) {
  return [
    ...data.closable.map((item) => ({
      number: item.number,
      title: item.title,
      url: issueURL(data.upstreamRepo, item.number),
      updatedAt: "",
    })),
    ...data.holdOpen.map((item) => ({
      number: item.number,
      title: item.title,
      url: issueURL(data.upstreamRepo, item.number),
      updatedAt: "",
    })),
    ...data.deferred.map((item) => ({
      number: item.number,
      title: item.title,
      url: issueURL(data.upstreamRepo, item.number),
      updatedAt: "",
    })),
  ].sort((a, b) => a.number - b.number);
}

function commentFileName(number) {
  return `issue-${number}.md`;
}

function defaultExportDir(data) {
  return path.join(repoRoot, ".tmp", "issue-close-export", data.updatedAt);
}

function defaultPlanMode() {
  return "comment-and-close";
}

function renderCommentFile(data, item, openInfo) {
  const lines = [];
  lines.push(`# Issue #${item.number} ${item.title}`);
  lines.push("");
  lines.push(`- Issue: ${issueURL(data.upstreamRepo, item.number)}`);
  if (openInfo) {
    lines.push(`- GitHub open: yes`);
    lines.push(`- Updated at: ${openInfo.updatedAt}`);
  }
  lines.push("");
  lines.push("## Comment");
  lines.push("");
  lines.push(item.comment);
  lines.push("");
  return lines.join("\n");
}

function renderExportReadme(data, report, exportDir) {
  const lines = [];
  lines.push("# Issue Close Export");
  lines.push("");
  lines.push(`- Generated from: \`scripts/issue-close-data.json\``);
  lines.push(`- Generated at: \`${new Date().toISOString()}\``);
  lines.push(`- Upstream repo: \`${data.upstreamRepo}\``);
  lines.push(`- Export dir: \`${exportDir}\``);
  lines.push("");
  lines.push("## Closable now");
  lines.push("");
  for (const item of report.closable) {
    lines.push(`- #${item.number} ${item.title} -> \`${commentFileName(item.number)}\``);
  }
  lines.push("");
  lines.push("## Hold open");
  lines.push("");
  for (const item of report.holdOpen) {
    lines.push(`- #${item.number} ${item.title} :: ${item.reason}`);
  }
  lines.push("");
  lines.push("## Deferred");
  lines.push("");
  for (const item of report.deferred) {
    lines.push(`- #${item.number} ${item.title} :: ${item.reason}`);
  }
  if (report.unexpectedOpen.length > 0) {
    lines.push("");
    lines.push("## Unexpected open issues");
    lines.push("");
    for (const item of report.unexpectedOpen) {
      lines.push(`- #${item.number} ${item.title} :: updated ${item.updatedAt}`);
    }
  }
  lines.push("");
  lines.push("## Verification baseline");
  lines.push("");
  lines.push(`- Command: \`${data.verificationBaseline.summaryCommand}\``);
  lines.push(`- Summary status: \`${data.verificationBaseline.summaryStatus}\``);
  lines.push(`- Summary steps: \`${data.verificationBaseline.summarySteps}\``);
  lines.push(`- Frontend tests: \`${data.verificationBaseline.frontendTests}\``);
  return lines.join("\n");
}

async function fetchOpenIssues(upstreamRepo, data = null) {
  if (shouldSkipIssueCloseGitHubSync()) {
    if (!data) {
      throw new Error("skip issue close GitHub sync requires close data context");
    }
    return syntheticOpenIssues(data);
  }
  const token = resolveGitHubToken();
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "image-studio-issue-close-helper",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(`${repoAPIURL(upstreamRepo)}/issues?state=open&per_page=100`, {
    headers,
  });
  if (!response.ok) {
    throw new Error(`GitHub API request failed: ${response.status} ${response.statusText}`);
  }
  const payload = await response.json();
  return payload
    .filter((item) => !item.pull_request)
    .map((item) => ({
      number: Number(item.number),
      title: String(item.title ?? "").trim(),
      url: String(item.html_url ?? "").trim(),
      updatedAt: String(item.updated_at ?? "").trim(),
    }))
    .sort((a, b) => a.number - b.number);
}

function buildVerifyReport(data, openIssues) {
  const openMap = new Map(openIssues.map((item) => [item.number, item]));
  const closable = data.closable.map((item) => ({
    number: item.number,
    title: item.title,
    isOpen: openMap.has(item.number),
    updatedAt: openMap.get(item.number)?.updatedAt ?? null,
  }));
  const holdOpen = data.holdOpen.map((item) => ({
    ...item,
    isOpen: openMap.has(item.number),
    updatedAt: openMap.get(item.number)?.updatedAt ?? null,
  }));
  const deferred = data.deferred.map((item) => ({
    ...item,
    isOpen: openMap.has(item.number),
    updatedAt: openMap.get(item.number)?.updatedAt ?? null,
  }));
  const known = new Set([
    ...data.closable.map((item) => item.number),
    ...data.holdOpen.map((item) => item.number),
    ...data.deferred.map((item) => item.number),
  ]);
  const unexpectedOpen = openIssues.filter((item) => !known.has(item.number));
  return {
    upstreamRepo: data.upstreamRepo,
    closable,
    holdOpen,
    deferred,
    unexpectedOpen,
  };
}

function renderVerifyReport(report) {
  const lines = [];
  lines.push(`# Open issues check for ${report.upstreamRepo}`);
  lines.push("");
  lines.push("## Closable now");
  for (const item of report.closable) {
    lines.push(`- #${item.number} ${item.title} :: ${item.isOpen ? "open" : "not-open"}${item.updatedAt ? ` :: updated ${item.updatedAt}` : ""}`);
  }
  lines.push("");
  lines.push("## Hold open");
  for (const item of report.holdOpen) {
    lines.push(`- #${item.number} ${item.title} :: ${item.isOpen ? "open" : "not-open"} :: ${item.reason}`);
  }
  lines.push("");
  lines.push("## Deferred");
  for (const item of report.deferred) {
    lines.push(`- #${item.number} ${item.title} :: ${item.isOpen ? "open" : "not-open"} :: ${item.reason}`);
  }
  if (report.unexpectedOpen.length > 0) {
    lines.push("");
    lines.push("## Unexpected open issues");
    for (const item of report.unexpectedOpen) {
      lines.push(`- #${item.number} ${item.title} :: updated ${item.updatedAt}`);
    }
  }
  return lines.join("\n");
}

function parseCommandArgs(args) {
  const positionals = [];
  const options = {
    json: false,
    mode: defaultPlanMode(),
    execute: false,
  };
  for (const token of args) {
    if (token === "--json") {
      options.json = true;
      continue;
    }
    if (token === "--comment-only") {
      options.mode = "comment-only";
      continue;
    }
    if (token === "--comment-and-close") {
      options.mode = "comment-and-close";
      continue;
    }
    if (token === "--execute" || token === "--yes") {
      options.execute = true;
      continue;
    }
    positionals.push(token);
  }
  return { positionals, options };
}

function parseRequestedIssueNumbers(tokens) {
  if (tokens.length === 0) return null;
  if (tokens.length === 1 && tokens[0] === "all") return null;
  const numbers = [];
  for (const token of tokens) {
    for (const part of token.split(",")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const number = Number(trimmed.replace(/^#/, ""));
      if (!Number.isFinite(number)) {
        throw new Error(`Invalid issue number: ${token}`);
      }
      numbers.push(number);
    }
  }
  return Array.from(new Set(numbers)).sort((a, b) => a - b);
}

function selectClosableTargets(data, report, requestedNumbers) {
  const openNow = new Set(report.closable.filter((item) => item.isOpen).map((item) => item.number));
  const source = requestedNumbers && requestedNumbers.length > 0
    ? requestedNumbers
    : data.closable.map((item) => item.number).filter((number) => openNow.has(number));
  const selected = [];
  for (const number of source) {
    const item = data.closable.find((entry) => entry.number === number);
    if (!item) {
      throw new Error(`#${number} is not a closable issue in scripts/issue-close-data.json`);
    }
    if (!openNow.has(number)) {
      throw new Error(`#${number} is not currently open on GitHub`);
    }
    selected.push(item);
  }
  return selected;
}

function buildActionPlan(data, report, targets, mode) {
  const openMap = new Map(report.closable.map((item) => [item.number, item]));
  return {
    generatedAt: new Date().toISOString(),
    upstreamRepo: data.upstreamRepo,
    mode,
    targets: targets.map((item) => ({
      number: item.number,
      title: item.title,
      url: issueURL(data.upstreamRepo, item.number),
      updatedAt: openMap.get(item.number)?.updatedAt ?? null,
      action: mode === "comment-only" ? "comment" : "comment-and-close",
      commentChars: item.comment.length,
      commentPreview: item.comment.split("\n").find((line) => line.trim()) ?? "",
    })),
    holdOpen: report.holdOpen.filter((item) => item.isOpen),
    deferred: report.deferred.filter((item) => item.isOpen),
    unexpectedOpen: report.unexpectedOpen,
  };
}

function renderActionPlan(plan) {
  const lines = [];
  lines.push(`# Issue action plan for ${plan.upstreamRepo}`);
  lines.push("");
  lines.push(`- Generated at: ${plan.generatedAt}`);
  lines.push(`- Mode: ${plan.mode}`);
  lines.push("");
  lines.push("## Targets");
  for (const item of plan.targets) {
    lines.push(`- #${item.number} ${item.title} :: ${item.action} :: updated ${item.updatedAt ?? "unknown"}`);
  }
  lines.push("");
  lines.push("## Hold open");
  for (const item of plan.holdOpen) {
    lines.push(`- #${item.number} ${item.title} :: ${item.reason}`);
  }
  lines.push("");
  lines.push("## Deferred");
  for (const item of plan.deferred) {
    lines.push(`- #${item.number} ${item.title} :: ${item.reason}`);
  }
  if (plan.unexpectedOpen.length > 0) {
    lines.push("");
    lines.push("## Unexpected open issues");
    for (const item of plan.unexpectedOpen) {
      lines.push(`- #${item.number} ${item.title} :: updated ${item.updatedAt}`);
    }
  }
  return lines.join("\n");
}

function resolveGitHubToken() {
  return (process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "").trim();
}

async function githubRequest(url, { method = "GET", token, body } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "image-studio-issue-close-helper",
      Authorization: `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const raw = await response.text();
  let json = null;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch {
    json = null;
  }
  if (!response.ok) {
    throw new Error(`GitHub API request failed: ${response.status} ${response.statusText}\n${raw}`);
  }
  return json;
}

async function applyPlan(data, plan) {
  const token = resolveGitHubToken();
  if (!token) {
    throw new Error("apply requires GITHUB_TOKEN or GH_TOKEN");
  }
  const apiRepoURL = repoAPIURL(data.upstreamRepo);
  const results = [];
  for (const item of plan.targets) {
    const commentPayload = await githubRequest(
      `${apiRepoURL}/issues/${item.number}/comments`,
      {
        method: "POST",
        token,
        body: {
          body: data.closable.find((entry) => entry.number === item.number)?.comment ?? "",
        },
      },
    );
    let closePayload = null;
    if (plan.mode === "comment-and-close") {
      closePayload = await githubRequest(
        `${apiRepoURL}/issues/${item.number}`,
        {
          method: "PATCH",
          token,
          body: { state: "closed" },
        },
      );
    }
    results.push({
      number: item.number,
      title: item.title,
      commentURL: commentPayload?.html_url ?? null,
      issueState: closePayload?.state ?? "open",
    });
  }
  return {
    executedAt: new Date().toISOString(),
    upstreamRepo: data.upstreamRepo,
    mode: plan.mode,
    results,
  };
}

async function exportPackage(data, openIssues, outputDirArg) {
  const outputDir = outputDirArg ? path.resolve(repoRoot, outputDirArg) : defaultExportDir(data);
  const report = buildVerifyReport(data, openIssues);
  const plan = buildActionPlan(data, report, data.closable, defaultPlanMode());
  await mkdir(outputDir, { recursive: true });

  const manifest = {
    generatedAt: new Date().toISOString(),
    upstreamRepo: data.upstreamRepo,
    outputDir,
    verificationBaseline: data.verificationBaseline,
    defaultPlanMode: defaultPlanMode(),
    planFile: "plan.json",
    planMarkdownFile: "plan.md",
    closable: report.closable.map((item) => ({
      ...item,
      file: commentFileName(item.number),
    })),
    holdOpen: report.holdOpen,
    deferred: report.deferred,
    unexpectedOpen: report.unexpectedOpen,
  };

  await writeFile(path.join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(path.join(outputDir, "README.md"), `${renderExportReadme(data, report, outputDir)}\n`, "utf8");
  await writeFile(path.join(outputDir, "plan.json"), `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  await writeFile(path.join(outputDir, "plan.md"), `${renderActionPlan(plan)}\n`, "utf8");

  const openMap = new Map(openIssues.map((item) => [item.number, item]));
  for (const item of data.closable) {
    await writeFile(
      path.join(outputDir, commentFileName(item.number)),
      `${renderCommentFile(data, item, openMap.get(item.number))}\n`,
      "utf8",
    );
  }

  return {
    outputDir,
    manifestPath: path.join(outputDir, "manifest.json"),
    readmePath: path.join(outputDir, "README.md"),
    planJsonPath: path.join(outputDir, "plan.json"),
    planMarkdownPath: path.join(outputDir, "plan.md"),
    files: data.closable.map((item) => path.join(outputDir, commentFileName(item.number))),
  };
}

async function main() {
  const [command = "list", ...rest] = process.argv.slice(2);
  const data = normaliseCloseData(await readCloseData());

  if (!data.upstreamRepo) {
    throw new Error(`Missing upstreamRepo in ${closeDataPath}`);
  }
  if (!data.updatedAt) {
    throw new Error(`Missing updatedAt in ${closeDataPath}`);
  }
  if (!data.verificationBaseline?.summaryCommand) {
    throw new Error(`Missing verificationBaseline.summaryCommand in ${closeDataPath}`);
  }
  if (data.closable.length === 0) {
    throw new Error(`No closable issue templates found in ${closeDataPath}`);
  }

  switch (command) {
    case "list": {
      const { options } = parseCommandArgs(rest);
      if (options.json) {
        process.stdout.write(`${JSON.stringify(data.closable, null, 2)}\n`);
        return;
      }
      process.stdout.write(`${renderList(data.closable)}\n`);
      return;
    }
    case "comment": {
      const issueNumber = Number(rest[0]);
      if (!Number.isFinite(issueNumber)) {
        throw new Error("comment command requires a numeric issue number");
      }
      const match = data.closable.find((item) => item.number === issueNumber);
      if (!match) {
        throw new Error(`No close comment template found for #${issueNumber}`);
      }
      process.stdout.write(`${match.comment}\n`);
      return;
    }
    case "plan": {
      const { positionals, options } = parseCommandArgs(rest);
      const openIssues = await fetchOpenIssues(data.upstreamRepo, data);
      const report = buildVerifyReport(data, openIssues);
      const requestedNumbers = parseRequestedIssueNumbers(positionals);
      const targets = selectClosableTargets(data, report, requestedNumbers);
      const plan = buildActionPlan(data, report, targets, options.mode);
      if (options.json) {
        process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
        return;
      }
      process.stdout.write(`${renderActionPlan(plan)}\n`);
      return;
    }
    case "apply": {
      const { positionals, options } = parseCommandArgs(rest);
      if (!options.execute) {
        throw new Error("apply refuses to mutate GitHub without --execute and GITHUB_TOKEN/GH_TOKEN");
      }
      const openIssues = await fetchOpenIssues(data.upstreamRepo, data);
      const report = buildVerifyReport(data, openIssues);
      const requestedNumbers = parseRequestedIssueNumbers(positionals);
      const targets = selectClosableTargets(data, report, requestedNumbers);
      const plan = buildActionPlan(data, report, targets, options.mode);
      const result = await applyPlan(data, plan);
      if (options.json) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    case "export": {
      const { positionals } = parseCommandArgs(rest);
      const openIssues = await fetchOpenIssues(data.upstreamRepo, data);
      const exported = await exportPackage(data, openIssues, positionals[0]);
      process.stdout.write(`${JSON.stringify(exported, null, 2)}\n`);
      return;
    }
    case "verify-open": {
      const { options } = parseCommandArgs(rest);
      const openIssues = await fetchOpenIssues(data.upstreamRepo, data);
      const report = buildVerifyReport(data, openIssues);
      if (options.json) {
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
        return;
      }
      process.stdout.write(`${renderVerifyReport(report)}\n`);
      return;
    }
    default:
      throw new Error(usage());
  }
}

await main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
