import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const presetArg = (process.argv[2] || "").trim();
const customSlug = (process.argv[3] || "").trim();

const presets = {
  "36-android": {
    slug: "issue-36-android",
    issue: "#36",
    title: "Android 真机 / 模拟器高并发与大尺寸最终图完整性",
    platform: "Android",
    focus: [
      "并发 >=2 时自动关闭流式预览后，最终图仍完整",
      "2K/4K 大尺寸时自动关闭流式预览后，最终图仍完整",
      "不会把 partial preview 当成最终成功结果",
      "系统相册 / 输出目录中的最终图与界面一致",
    ],
    matrix: [
      "| 场景 | 预期 | 结果 | 证据 |",
      "|---|---|---|---|",
      "| 并发 1，1024 级尺寸 | 最终图完整 |  |  |",
      "| 并发 2，1024 级尺寸 | 自动关闭流式预览，最终图完整 |  |  |",
      "| 并发 1，2K/4K 级尺寸 | 自动关闭流式预览，最终图完整 |  |  |",
      "| 并发 2，关闭保护开关 | 用于对照老问题是否复现 |  |  |",
    ],
  },
  "36-windows": {
    slug: "issue-36-windows",
    issue: "#36",
    title: "Windows 桌面高并发与大尺寸最终图完整性",
    platform: "Windows",
    focus: [
      "并发 >=8 时自动关闭流式预览后，最终图仍完整",
      "不会把 partial preview 当成最终成功结果",
      "raw 响应里没有 final image 时，不应被当作成功",
    ],
    matrix: [
      "| 场景 | 预期 | 结果 | 证据 |",
      "|---|---|---|---|",
      "| 并发 1，1024 级尺寸 | 可见流式预览，最终图完整 |  |  |",
      "| 并发 8，1024 级尺寸 | 自动关闭流式预览，最终图完整 |  |  |",
      "| 并发 8，2K/4K 级尺寸 | 自动关闭流式预览，最终图完整 |  |  |",
      "| 并发 8，关闭保护开关 | 用于对照老问题是否复现 |  |  |",
    ],
  },
  "30-windows": {
    slug: "issue-30-windows",
    issue: "#30",
    title: "Windows 标题栏 / 标题区颜色一致性真机确认",
    platform: "Windows",
    focus: [
      "原生标题栏、应用标题区、workspace 条带在亮色下无明显断层",
      "原生标题栏、应用标题区、workspace 条带在暗色下无明显断层",
      "workspace 数量 > 1 时，标题区与条带仍属同一主题层级",
    ],
    matrix: [
      "| 场景 | 预期 | 结果 | 证据 |",
      "|---|---|---|---|",
      "| 亮色主题 | 标题栏与内部标题区无明显色差 |  |  |",
      "| 暗色主题 | 标题栏与内部标题区无明显色差 |  |  |",
      "| 多 workspace | 条带与标题区背景一致 |  |  |",
    ],
  },
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function slugify(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "manual-verify";
}

function gitValue(args) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function buildReportTemplate(config) {
  const focusLines = config.focus.map((line) => `- ${line}`).join("\n");
  const matrix = config.matrix.join("\n");
  return `# 手工验证报告

- 创建时间: ${new Date().toISOString()}
- 仓库: ${root}
- Git 分支: ${gitValue(["rev-parse", "--abbrev-ref", "HEAD"]) || "(unknown)"}
- Git 提交: ${gitValue(["rev-parse", "--short=12", "HEAD"]) || "(unknown)"}
- 关联 issue: ${config.issue}
- 平台: ${config.platform}
- 验证主题: ${config.title}

## 前置条件

- 自动验证链已通过:
  - [ ] \`IMAGE_STUDIO_SKIP_RUNTIME_UPDATE_PROBE=1 node scripts/verify-local-platform-kernel.mjs\`
- 目标设备 / 上游已准备好:
  - [ ] 设备或上游信息已记录

## 本次重点

${focusLines}

## 设备 / 环境

- 操作系统:
- 设备 / 模拟器:
- 应用版本:
- APK / EXE / APP 来源:
- BASE_URL 类型:
- 文本模型 ID:
- 图像模型 ID:

## 验证矩阵

${matrix}

## 证据文件

- 截图目录: \`./screenshots\`
- raw / 响应目录: \`./raw\`
- 日志目录: \`./logs\`

## 结论

- 总结:
- 是否通过:
- 剩余问题:
`;
}

function buildMeta(config, runDir) {
  return {
    createdAt: new Date().toISOString(),
    root,
    runDir,
    preset: presetArg || null,
    slug: config.slug,
    issue: config.issue,
    platform: config.platform,
    title: config.title,
    gitBranch: gitValue(["rev-parse", "--abbrev-ref", "HEAD"]) || null,
    gitCommit: gitValue(["rev-parse", "--short=12", "HEAD"]) || null,
  };
}

const preset = presets[presetArg] ?? null;
const config = preset ?? {
  slug: customSlug ? slugify(customSlug) : "manual-verify",
  issue: "(手动填写)",
  title: customSlug || "手工验证",
  platform: "(手动填写)",
  focus: [
    "补充本次验证目标",
  ],
  matrix: [
    "| 场景 | 预期 | 结果 | 证据 |",
    "|---|---|---|---|",
  ],
};

const runDir = path.join(root, ".tmp", "manual-verify", today(), config.slug);
const screenshotsDir = path.join(runDir, "screenshots");
const rawDir = path.join(runDir, "raw");
const logsDir = path.join(runDir, "logs");

await mkdir(screenshotsDir, { recursive: true });
await mkdir(rawDir, { recursive: true });
await mkdir(logsDir, { recursive: true });

const reportPath = path.join(runDir, "report.md");
const metaPath = path.join(runDir, "meta.json");

await writeFile(reportPath, buildReportTemplate(config), "utf8");
await writeFile(metaPath, `${JSON.stringify(buildMeta(config, runDir), null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  runDir,
  reportPath,
  metaPath,
  screenshotsDir,
  rawDir,
  logsDir,
}, null, 2));
