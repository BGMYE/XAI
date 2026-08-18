import { spawn } from "node:child_process";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const issueCloseDataPath = path.join(root, "scripts", "issue-close-data.json");

const today = new Date().toISOString().slice(0, 10);
const bundleRoot = path.join(root, ".tmp", "external-verify-bundles", today);
const bundleDir = path.join(bundleRoot, "issue-30-36-handoff");

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: root,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} ${args.join(" ")} exited with ${code ?? 1}\n${stderr || stdout}`));
    });
  });
}

function relativeToRoot(targetPath) {
  return path.relative(root, targetPath) || ".";
}

async function readIssueCloseData() {
  return JSON.parse(await readFile(issueCloseDataPath, "utf8"));
}

function defaultPlatformResultsDirFromData(data) {
  const files = Array.isArray(data?.verificationBaseline?.resultFiles) ? data.verificationBaseline.resultFiles : [];
  const summaryPath = files.find((entry) => path.basename(String(entry)) === "platform-kernel-summary.json");
  return summaryPath ? path.dirname(summaryPath) : "";
}

function defaultIssueCloseBundleDirFromData(data) {
  const files = Array.isArray(data?.verificationBaseline?.resultFiles) ? data.verificationBaseline.resultFiles : [];
  const manifestPath = files.find((entry) => path.basename(String(entry)) === "manifest.json" && String(entry).includes("issue-close-export-bundle"));
  return manifestPath ? path.dirname(manifestPath) : "";
}

async function ensureManualTemplate(preset) {
  const { stdout } = await run(process.execPath, ["scripts/init-manual-verification.mjs", preset]);
  return JSON.parse(stdout);
}

async function writeReadme({
  bundleDirPath,
  manual,
  platformDir,
  issueCloseDir,
  platformSourceDir,
  issueCloseSourceDir,
}) {
  const lines = [];
  lines.push("# External Verification Bundle");
  lines.push("");
  lines.push(`- Generated at: \`${new Date().toISOString()}\``);
  lines.push(`- Bundle dir: \`${bundleDirPath}\``);
  lines.push("");
  lines.push("## Source");
  lines.push("");
  lines.push(`- Issue close baseline: \`${relativeToRoot(issueCloseDataPath)}\``);
  lines.push(`- Platform evidence source: \`${platformSourceDir}\``);
  lines.push(`- Issue close bundle source: \`${issueCloseSourceDir}\``);
  lines.push("");
  lines.push("## Remaining external-condition items");
  lines.push("");
  lines.push("- `#30`: Windows 真机标题栏 / 标题区颜色一致性确认");
  lines.push("- `#36`: Android / Windows 真机 + 真实高并发上游长链路验证");
  lines.push("");
  lines.push("## Included evidence");
  lines.push("");
  lines.push(`- Platform kernel results: \`${platformDir}\``);
  lines.push(`- Issue close comment bundle: \`${issueCloseDir}\``);
  lines.push("");
  lines.push("## Manual verification templates");
  lines.push("");
  lines.push(`- #30 Windows: \`${manual.issue30.reportPath}\``);
  lines.push(`- #36 Android: \`${manual.issue36Android.reportPath}\``);
  lines.push(`- #36 Windows: \`${manual.issue36Windows.reportPath}\``);
  lines.push("");
  lines.push("## Suggested next steps");
  lines.push("");
  lines.push("1. 在 Windows 真机打开 `manual-verify/issue-30-windows/report.md`，补亮色/暗色/workspace 截图。");
  lines.push("2. 在 Android 真机或模拟器打开 `manual-verify/issue-36-android/report.md`，补并发/大尺寸矩阵。");
  lines.push("3. 在 Windows 真机打开 `manual-verify/issue-36-windows/report.md`，补桌面高并发矩阵。");
  lines.push("4. 如果需要维护 GitHub issue，可从 `issue-close-bundle/` 取出 `issue-24.md` ... `issue-42.md` 作为评论模板。");
  lines.push("");
  return writeFile(path.join(bundleDirPath, "README.md"), `${lines.join("\n")}\n`, "utf8");
}

await mkdir(bundleDir, { recursive: true });

const manualRoot = path.join(bundleDir, "manual-verify");
const evidenceRoot = path.join(bundleDir, "evidence");
const issueCloseRoot = path.join(bundleDir, "issue-close-bundle");

const issueCloseData = await readIssueCloseData();
const platformResultsDir = process.env.IMAGE_STUDIO_EXTERNAL_VERIFY_RESULTS_DIR
  ? path.resolve(root, process.env.IMAGE_STUDIO_EXTERNAL_VERIFY_RESULTS_DIR)
  : defaultPlatformResultsDirFromData(issueCloseData);
const issueCloseBundleDir = process.env.IMAGE_STUDIO_EXTERNAL_ISSUE_CLOSE_DIR
  ? path.resolve(root, process.env.IMAGE_STUDIO_EXTERNAL_ISSUE_CLOSE_DIR)
  : defaultIssueCloseBundleDirFromData(issueCloseData);

if (!platformResultsDir) {
  throw new Error("Unable to resolve platform results dir. Set IMAGE_STUDIO_EXTERNAL_VERIFY_RESULTS_DIR.");
}
if (!issueCloseBundleDir) {
  throw new Error("Unable to resolve issue close bundle dir. Set IMAGE_STUDIO_EXTERNAL_ISSUE_CLOSE_DIR.");
}

await mkdir(manualRoot, { recursive: true });
await mkdir(evidenceRoot, { recursive: true });
await mkdir(issueCloseRoot, { recursive: true });

const issue30 = await ensureManualTemplate("30-windows");
const issue36Android = await ensureManualTemplate("36-android");
const issue36Windows = await ensureManualTemplate("36-windows");

await cp(path.join(platformResultsDir, "platform-kernel-summary.json"), path.join(evidenceRoot, "platform-kernel-summary.json"));
await cp(path.join(platformResultsDir, "live-verify.json"), path.join(evidenceRoot, "live-verify.json"));
await cp(path.join(platformResultsDir, "local-smoke.json"), path.join(evidenceRoot, "local-smoke.json"));
await cp(path.join(platformResultsDir, "android-shell.json"), path.join(evidenceRoot, "android-shell.json"));
await cp(path.join(platformResultsDir, "macos-release.json"), path.join(evidenceRoot, "macos-release.json"));
await cp(path.join(platformResultsDir, "issue-close-tooling.json"), path.join(evidenceRoot, "issue-close-tooling.json"));

await cp(issueCloseBundleDir, issueCloseRoot, { recursive: true });

const manualIssue30Dir = path.join(manualRoot, "issue-30-windows");
const manualIssue36AndroidDir = path.join(manualRoot, "issue-36-android");
const manualIssue36WindowsDir = path.join(manualRoot, "issue-36-windows");

await mkdir(manualIssue30Dir, { recursive: true });
await mkdir(manualIssue36AndroidDir, { recursive: true });
await mkdir(manualIssue36WindowsDir, { recursive: true });

await cp(path.dirname(issue30.reportPath), manualIssue30Dir, { recursive: true });
await cp(path.dirname(issue36Android.reportPath), manualIssue36AndroidDir, { recursive: true });
await cp(path.dirname(issue36Windows.reportPath), manualIssue36WindowsDir, { recursive: true });

await writeReadme({
  bundleDirPath: bundleDir,
  manual: {
    issue30: {
      reportPath: relativeToRoot(path.join(manualIssue30Dir, path.basename(issue30.reportPath))),
    },
    issue36Android: {
      reportPath: relativeToRoot(path.join(manualIssue36AndroidDir, path.basename(issue36Android.reportPath))),
    },
    issue36Windows: {
      reportPath: relativeToRoot(path.join(manualIssue36WindowsDir, path.basename(issue36Windows.reportPath))),
    },
  },
  platformDir: relativeToRoot(evidenceRoot),
  issueCloseDir: relativeToRoot(issueCloseRoot),
  platformSourceDir: platformResultsDir,
  issueCloseSourceDir: issueCloseBundleDir,
});

console.log(JSON.stringify({
  bundleDir,
  readmePath: path.join(bundleDir, "README.md"),
  evidenceDir: evidenceRoot,
  issueCloseDir: issueCloseRoot,
  manualVerifyDir: manualRoot,
}, null, 2));
