import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveVerifyOutputPath } from "./verify-output-paths.mjs";

const root = process.cwd();
const outputPath = resolveVerifyOutputPath("IMAGE_STUDIO_ISSUE_CLOSE_VERIFY_OUTPUT_PATH", "issue-close-tooling.json");
const exportManifestPath = resolveVerifyOutputPath("IMAGE_STUDIO_ISSUE_CLOSE_EXPORT_MANIFEST_PATH", "issue-close-export-bundle/manifest.json");
const dataPath = path.join(root, "scripts", "issue-close-data.json");
const renderedDocPath = path.join(root, "docs", "issue-close-comments.md");
const hasGitHubToken = Boolean((process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "").trim());
const skipGitHubSync = /^(1|true)$/i.test(process.env.IMAGE_STUDIO_SKIP_ISSUE_CLOSE_GITHUB_SYNC ?? "") || !hasGitHubToken;

const summary = {
  startedAt: new Date().toISOString(),
  status: "running",
  environment: {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    hasGitHubToken,
    skipGitHubSync,
  },
  checks: [],
};

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
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", reject);
    child.on("exit", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

function pushCheck(name, status, detail) {
  summary.checks.push({ name, status, detail });
  if (status !== "passed") {
    throw new Error(`${name}: ${detail}`);
  }
}

async function writeOutputIfRequested(payload) {
  if (!outputPath) return;
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function withMockGitHub(data, fn) {
  const repoPathPrefix = `/repos/${data.upstreamRepo}`;
  const issues = new Map();
  const commentBodies = [];
  const patchBodies = [];

  for (const item of (data.closable ?? []).slice(0, 2)) {
    issues.set(Number(item.number), {
      number: Number(item.number),
      title: String(item.title ?? "").trim(),
      html_url: `https://github.com/${data.upstreamRepo}/issues/${item.number}`,
      updated_at: "2026-06-07T00:00:00Z",
      state: "open",
    });
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const chunks = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const rawBody = Buffer.concat(chunks).toString("utf8");

    if (req.method === "GET" && url.pathname === `${repoPathPrefix}/issues`) {
      const openIssues = Array.from(issues.values()).filter((issue) => issue.state === "open");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(openIssues));
      return;
    }

    if (!String(req.headers.authorization ?? "").startsWith("Bearer ")) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: "missing bearer token" }));
      return;
    }

    const commentMatch = new RegExp(`^${repoPathPrefix.replace("/", "\\/")}/issues/(\\d+)/comments$`).exec(url.pathname);
    if (req.method === "POST" && commentMatch) {
      const issueNumber = Number(commentMatch[1]);
      const payload = rawBody ? JSON.parse(rawBody) : {};
      commentBodies.push({ issueNumber, body: payload.body ?? "" });
      res.writeHead(201, { "content-type": "application/json" });
      res.end(JSON.stringify({
        html_url: `https://mock.local/comments/${issueNumber}/${commentBodies.length}`,
      }));
      return;
    }

    const patchMatch = new RegExp(`^${repoPathPrefix.replace("/", "\\/")}/issues/(\\d+)$`).exec(url.pathname);
    if (req.method === "PATCH" && patchMatch) {
      const issueNumber = Number(patchMatch[1]);
      const payload = rawBody ? JSON.parse(rawBody) : {};
      patchBodies.push({ issueNumber, body: payload });
      const issue = issues.get(issueNumber);
      if (issue && payload.state === "closed") {
        issue.state = "closed";
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(issue ?? { number: issueNumber, state: payload.state ?? "open" }));
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ message: "not found", path: url.pathname, method: req.method }));
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  try {
    return await fn({
      apiBaseURL: `http://127.0.0.1:${port}`,
      issues,
      commentBodies,
      patchBodies,
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function main() {
  const data = JSON.parse(await readFile(dataPath, "utf8"));
  const closableNumbers = Array.isArray(data.closable) ? data.closable.map((item) => Number(item.number)) : [];
  pushCheck("close data has closable issues", closableNumbers.length > 0 ? "passed" : "failed", `count=${closableNumbers.length}`);

  const renderedDoc = await readFile(renderedDocPath, "utf8");
  const render = await run(process.execPath, ["scripts/render-issue-close-comments.mjs"]);
  pushCheck("render issue close comments exits 0", render.code === 0 ? "passed" : "failed", render.stderr || `code=${render.code}`);
  pushCheck(
    "rendered issue close doc matches tracked markdown",
    render.stdout === renderedDoc ? "passed" : "failed",
    render.stdout === renderedDoc ? "docs/issue-close-comments.md is in sync" : "docs/issue-close-comments.md drift detected",
  );

  const list = await run(process.execPath, ["scripts/issue-close-helper.mjs", "list", "--json"]);
  pushCheck("issue close helper list exits 0", list.code === 0 ? "passed" : "failed", list.stderr || `code=${list.code}`);
  const listed = JSON.parse(list.stdout);
  const listedNumbers = listed.map((item) => Number(item.number));
  pushCheck("helper list matches closable numbers", JSON.stringify(listedNumbers) === JSON.stringify(closableNumbers) ? "passed" : "failed", `listed=${listedNumbers.join(",")}`);

  const firstIssue = closableNumbers[0];
  const comment = await run(process.execPath, ["scripts/issue-close-helper.mjs", "comment", String(firstIssue)]);
  pushCheck("issue close helper comment exits 0", comment.code === 0 ? "passed" : "failed", comment.stderr || `code=${comment.code}`);
  const firstComment = data.closable.find((item) => Number(item.number) === firstIssue)?.comment?.trim() ?? "";
  pushCheck("helper comment matches data source", comment.stdout.trim() === firstComment ? "passed" : "failed", `issue=${firstIssue}`);

  const plan = await run(process.execPath, ["scripts/issue-close-helper.mjs", "plan", "--json"]);
  pushCheck("issue close helper plan exits 0", plan.code === 0 ? "passed" : "failed", plan.stderr || `code=${plan.code}`);
  const planned = JSON.parse(plan.stdout);
  pushCheck("helper plan target count matches closable issues", planned.targets?.length === closableNumbers.length ? "passed" : "failed", `targets=${planned.targets?.length ?? 0}`);
  pushCheck("helper plan default mode is comment-and-close", planned.mode === "comment-and-close" ? "passed" : "failed", `mode=${planned.mode}`);

  const applyDryRun = await run(process.execPath, ["scripts/issue-close-helper.mjs", "apply", String(firstIssue), "--comment-only"]);
  pushCheck(
    "issue close helper apply refuses without execute",
    applyDryRun.code !== 0 && /refuses to mutate GitHub/.test(applyDryRun.stderr) ? "passed" : "failed",
    applyDryRun.stderr || applyDryRun.stdout || `code=${applyDryRun.code}`,
  );

  await withMockGitHub(data, async (mock) => {
    const commentOnly = await run(
      process.execPath,
      ["scripts/issue-close-helper.mjs", "apply", String(firstIssue), "--comment-only", "--execute", "--json"],
      {
        env: {
          GITHUB_TOKEN: "mock-token",
          IMAGE_STUDIO_GITHUB_API_BASE_URL: mock.apiBaseURL,
        },
      },
    );
    pushCheck("issue close helper apply comment-only exits 0", commentOnly.code === 0 ? "passed" : "failed", commentOnly.stderr || `code=${commentOnly.code}`);
    const commentOnlyJson = JSON.parse(commentOnly.stdout);
    pushCheck(
      "mock apply comment-only keeps issue open",
      commentOnlyJson.results?.[0]?.issueState === "open" ? "passed" : "failed",
      `state=${commentOnlyJson.results?.[0]?.issueState ?? "missing"}`,
    );
    const expectedFirstComment = data.closable.find((item) => Number(item.number) === firstIssue)?.comment?.trim() ?? "";
    pushCheck(
      "mock apply comment-only posts expected body",
      mock.commentBodies.some((entry) => entry.issueNumber === firstIssue && String(entry.body).trim() === expectedFirstComment) ? "passed" : "failed",
      `issue=${firstIssue}`,
    );

    const secondIssue = closableNumbers[1];
    const commentAndClose = await run(
      process.execPath,
      ["scripts/issue-close-helper.mjs", "apply", String(secondIssue), "--comment-and-close", "--execute", "--json"],
      {
        env: {
          GITHUB_TOKEN: "mock-token",
          IMAGE_STUDIO_GITHUB_API_BASE_URL: mock.apiBaseURL,
        },
      },
    );
    pushCheck("issue close helper apply comment-and-close exits 0", commentAndClose.code === 0 ? "passed" : "failed", commentAndClose.stderr || `code=${commentAndClose.code}`);
    const commentAndCloseJson = JSON.parse(commentAndClose.stdout);
    pushCheck(
      "mock apply comment-and-close closes issue",
      commentAndCloseJson.results?.[0]?.issueState === "closed" ? "passed" : "failed",
      `state=${commentAndCloseJson.results?.[0]?.issueState ?? "missing"}`,
    );
    const expectedSecondComment = data.closable.find((item) => Number(item.number) === secondIssue)?.comment?.trim() ?? "";
    pushCheck(
      "mock apply comment-and-close posts expected body",
      mock.commentBodies.some((entry) => entry.issueNumber === secondIssue && String(entry.body).trim() === expectedSecondComment) ? "passed" : "failed",
      `issue=${secondIssue}`,
    );
    pushCheck(
      "mock apply comment-and-close sends closed patch",
      mock.patchBodies.some((entry) => entry.issueNumber === secondIssue && entry.body?.state === "closed") ? "passed" : "failed",
      `issue=${secondIssue}`,
    );

    summary.mockApply = {
      status: "passed",
      commentOnlyIssue: firstIssue,
      commentAndCloseIssue: secondIssue,
      commentCount: mock.commentBodies.length,
      patchCount: mock.patchBodies.length,
    };
  });

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "image-studio-issue-close-verify-"));
  try {
    const exportDir = exportManifestPath
      ? path.dirname(exportManifestPath)
      : path.join(tempRoot, "bundle");
    const exported = await run(process.execPath, ["scripts/issue-close-helper.mjs", "export", exportDir]);
    pushCheck("issue close helper export exits 0", exported.code === 0 ? "passed" : "failed", exported.stderr || `code=${exported.code}`);
    const exportedJson = JSON.parse(exported.stdout);
    const manifest = JSON.parse(await readFile(exportedJson.manifestPath, "utf8"));
    pushCheck("export manifest target count matches closable issues", manifest.closable?.length === closableNumbers.length ? "passed" : "failed", `targets=${manifest.closable?.length ?? 0}`);
    pushCheck("exported comment files count matches closable issues", exportedJson.files?.length === closableNumbers.length ? "passed" : "failed", `files=${exportedJson.files?.length ?? 0}`);
    summary.exportBundle = {
      status: "passed",
      outputDir: exportedJson.outputDir,
      manifestPath: exportedJson.manifestPath,
      readmePath: exportedJson.readmePath,
      planJsonPath: exportedJson.planJsonPath,
      planMarkdownPath: exportedJson.planMarkdownPath,
      defaultPlanMode: manifest.defaultPlanMode ?? null,
      closableCount: Array.isArray(manifest.closable) ? manifest.closable.length : 0,
      fileCount: Array.isArray(exportedJson.files) ? exportedJson.files.length : 0,
      preserved: !!exportManifestPath,
    };

    const summaryFixturePath = path.join(tempRoot, "issue-close-tooling-summary.json");
    const summaryFixture = {
      ...summary,
      status: "passed",
      completedAt: new Date().toISOString(),
    };
    await writeFile(summaryFixturePath, `${JSON.stringify(summaryFixture, null, 2)}\n`, "utf8");
    const renderedSummary = await run(process.execPath, [
      "scripts/render-issue-close-summary.mjs",
      summaryFixturePath,
      exportedJson.manifestPath,
    ]);
    pushCheck("render issue close summary exits 0", renderedSummary.code === 0 ? "passed" : "failed", renderedSummary.stderr || `code=${renderedSummary.code}`);
    pushCheck(
      "render issue close summary includes export bundle section",
      /### Export Bundle/.test(renderedSummary.stdout) ? "passed" : "failed",
      /### Export Bundle/.test(renderedSummary.stdout) ? "export bundle section rendered" : "export bundle section missing",
    );
  } finally {
    if (!exportManifestPath) {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }

  if (skipGitHubSync) {
    summary.githubSync = { status: "skipped", reason: "IMAGE_STUDIO_SKIP_ISSUE_CLOSE_GITHUB_SYNC" };
  } else {
    const verify = await run(process.execPath, ["scripts/issue-close-helper.mjs", "verify-open", "--json"]);
    pushCheck("issue close helper verify-open exits 0", verify.code === 0 ? "passed" : "failed", verify.stderr || `code=${verify.code}`);
    const verifyJson = JSON.parse(verify.stdout);
    const closableOpen = Array.isArray(verifyJson.closable) && verifyJson.closable.every((item) => item.isOpen === true);
    const holdOpen = Array.isArray(verifyJson.holdOpen) && verifyJson.holdOpen.every((item) => item.isOpen === true);
    const deferredOpen = Array.isArray(verifyJson.deferred) && verifyJson.deferred.every((item) => item.isOpen === true);
    const noUnexpected = Array.isArray(verifyJson.unexpectedOpen) && verifyJson.unexpectedOpen.length === 0;
    pushCheck(
      "verify-open reports all closable issues still open",
      closableOpen ? "passed" : "failed",
      closableOpen ? "all closable issues are still open" : "closable open state mismatch",
    );
    pushCheck(
      "verify-open reports all hold-open issues still open",
      holdOpen ? "passed" : "failed",
      holdOpen ? "all hold-open issues are still open" : "holdOpen state mismatch",
    );
    pushCheck(
      "verify-open reports all deferred issues still open",
      deferredOpen ? "passed" : "failed",
      deferredOpen ? "all deferred issues are still open" : "deferred state mismatch",
    );
    pushCheck("verify-open reports no unexpected open issues", noUnexpected ? "passed" : "failed", `unexpected=${verifyJson.unexpectedOpen?.length ?? 0}`);
    summary.githubSync = {
      status: "passed",
      closable: verifyJson.closable?.length ?? 0,
      holdOpen: verifyJson.holdOpen?.length ?? 0,
      deferred: verifyJson.deferred?.length ?? 0,
      unexpectedOpen: verifyJson.unexpectedOpen?.length ?? 0,
    };
  }

  summary.status = "passed";
  summary.completedAt = new Date().toISOString();
  console.log(JSON.stringify(summary, null, 2));
}

let capturedError = null;
try {
  await main();
} catch (error) {
  capturedError = error;
  summary.status = "failed";
  summary.completedAt = new Date().toISOString();
  summary.error = error?.message ?? String(error);
} finally {
  await writeOutputIfRequested(summary).catch(() => undefined);
  if (capturedError) throw capturedError;
}
