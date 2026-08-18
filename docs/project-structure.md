# 项目结构

## 顶层目录

```text
.
├── README.md
├── docs/
├── image-studio/
├── gio-client/
├── go-cli/
├── shared/
├── cloudflare-worker/
├── android-shell/
├── scripts/
├── go.work
└── .github/workflows/
```

## `image-studio/`

Wails 桌面应用。

```text
image-studio/
├── main.go
├── backend/
├── frontend/
├── build/
├── wails.json
└── go.mod
```

`backend/` 暴露 Wails bindings:

- `service.go`:Service 生命周期、Generate/Edit/Cancel、并发限制。
- `types.go`:与前端 JSON 绑定的类型。
- `dialogs.go`:文件选择、保存、打开 URL、历史导入导出。
- `imports.go`:拖拽/粘贴 import。
- `imageops.go`:旋转、翻转、裁剪通用回退。
- `imageops_gpu_darwin.go`:macOS Core Image / Metal 加速。
- `paths.go`:输出目录、imports 目录、文件名。
- `credentials.go`:系统安全存储。

`frontend/src/` 是 React + TypeScript 前端。详细分层规则见 [frontend/src/README.md](../image-studio/frontend/src/README.md)。

关键边界:

- `app/`:顶层装配、全局 hooks、modal gates。
- `components/`:纯 UI 组件。
- `platform/`:平台检测、桌面/Android 壳层、runtime host、远程内核。
- `state/`:zustand store 和 workspace runtime。
- `lib/`:平台无关工具。
- `styles/`:全局样式和平台主题 token。

## `gio-client/`

独立 Gio 原生桌面测试客户端。

```text
gio-client/
├── cmd/image-studio-gio/
├── internal/ui/
├── internal/kernel/
└── go.mod
```

`internal/ui/` 使用 Gio immediate-mode UI 重新组织前端架构，保留桌面端控制面板、画布、日志栏的视觉结构。`internal/kernel/` 只做薄适配，真正的请求构建、SSE、Images API、重试和 proxy 行为继续来自 `go-cli/pkg/client`。

该客户端不依赖 Wails、WebView2、WebKitGTK 或 `image-studio/frontend/dist`，release workflow 中作为 `image-studio-gio-*` 独立 artifact 构建。

## `go-cli/`

共享 Go 图像请求客户端和独立 CLI。

```text
go-cli/
├── cmd/gptcodex-image/
├── internal/
└── pkg/client/
```

`pkg/client/` 负责:

- Responses API payload 构建。
- Images API generations / edits。
- SSE 行解析和图像提取。
- 524/504、5xx、retryable 错误归因。
- 原生 `net/http` 传输。
- 默认模型、尺寸、质量、输出格式和重试常量。

`image-studio/go.mod` 通过 `replace github.com/yuanhua/image-gptcodex => ../go-cli` 复用这里的实现。

## `shared/`

跨运行时共享逻辑。当前 `shared/kernel/` 存放请求模型相关的 JavaScript 与 TypeScript 类型，供前端远程内核、Cloudflare Worker 和测试复用。

## `cloudflare-worker/`

可选的远程 Worker 内核。

```text
cloudflare-worker/
├── src/index.js
├── test/
├── package.json
└── wrangler.toml
```

它用于把前端/Android 侧请求代理到上游，并复用 `shared/kernel/` 的请求模型。部署和配置细节见 [cloudflare-worker/README.md](../cloudflare-worker/README.md)。

## `android-shell/`

Android WebView 壳层。

```text
android-shell/
├── app/
├── build.gradle.kts
├── settings.gradle.kts
└── README.md
```

Gradle 构建时执行前端 `build:android`，把 `image-studio/frontend/dist/` 拷贝进 APK assets。运行时:

- WebView 承载 React 前端。
- `AndroidImageStudioBridge` 向 JS 暴露图片选择、MediaStore 保存、历史导入导出、native HTTP、震动、全屏等能力。
- 前端根据窗口尺寸切换 phone / pad 壳层。
- 不使用 Wails Go backend；生成链路走前端远程内核和 Android native HTTP。

## `scripts/`

常用构建和验证脚本:

- `package-local-macos-app.sh`:macOS universal app 构建与自签。
- `compute-version.sh`:从 tag 或 wails.json 计算版本元数据。
- `sync-version-metadata.mjs`:同步 wails/frontend/package 版本。
- `verify-local-platform-kernel.mjs`:跨平台内核本地全量验证。
- `verify-local-live-verify.mjs`:以本地 mock upstream 驱动 `live-verify.mjs` 的 smoke 验证。
- `verify-local-android-shell.mjs`:Android shell 本地 APK 与 JVM 单测验证。
- `verify-local-macos-release.mjs`:macOS release 包验证。
- `init-manual-verification.mjs`:初始化手工验证目录、报告模板与取证子目录。
- `issue-close-data.json`:可关单 issue、暂不关闭原因、统一验证基线的结构化数据源。
- `issue-close-helper.mjs`:读取 `issue-close-data.json`，列出可关单 issue、输出评论模板、生成 dry-run 计划，并在显式授权时对 GitHub issue 执行评论/关闭。
- `render-issue-close-comments.mjs`:从 `issue-close-data.json` 生成 `docs/issue-close-comments.md`。
- `render-issue-close-summary.mjs`:把 `issue-close-tooling.json` 渲染成 Markdown summary。
- `verify-issue-close-tooling.mjs`:校验 issue 关单数据源、渲染文档、helper 输出与 GitHub 当前 open issue 状态是否一致。
- `prepare-external-verification-bundle.mjs`:把 `#30/#36` 的手工验证模板、最新总链证据和 issue 关单评论包整理到统一交接目录。
- `verify-output-paths.mjs`:统一解析各类验证结果的输出文件路径。
- `local-smoke-check.mjs`:本地 mock upstream smoke。
- `live-verify.mjs`:真实上游 direct vs worker 对比验证。
- `render-verify-platform-summary.mjs`:把本地平台验证 JSON 渲染成 GitHub job summary。
- `render-live-verify-summary.mjs`:把真实上游验证 JSON 渲染成 GitHub job summary。

## Workflows

- `.github/workflows/release.yml`:并行构建桌面产物，构建 Android APK，并在 tag release 时发布。
- `.github/workflows/verify-platform-kernel.yml`:自动化验证本地可证明部分。
- `.github/workflows/verify-issue-close-tooling.yml`:手动触发 issue 关单工具链验证。
- `.github/workflows/live-verify-platform-kernel.yml`:手动触发真实上游验证。

## 维护约束

- 跨平台宿主差异放进 `image-studio/frontend/src/platform/`。
- 纯业务状态放进 `state/`，不要直接塞平台桥接细节。
- OpenAI 请求字段规范优先收口到 `shared/kernel/` 或 `go-cli/pkg/client/`。
- Android 不是 Wails 桌面端移植；它是 WebView 壳层 + 远程内核路径。
- 首页 README 只保留入口级信息，功能和构建细节维护在 `docs/` 中。
