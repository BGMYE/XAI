# Backend v2 · 视频任务与持久化画布

本分支重构 Wails 桌面端的生成任务核心，并提供浅蓝玻璃质感首页、统一字体、独立的视频任务面板和持久化工作区。保留原来的图像生成、编辑、SSE/Images API、文件访问限制及 Android/Gio 路径；不是将所有平台一次性替换为新的在线 SaaS 服务。

## 使用

构建并启动本分支的桌面应用。在「设置 / 上游配置」填写合法可用的 BaseURL、API Key、图像模型，以及独立的视频模型 ID。首页「生成视频」可选择 `兼容 Videos API · multipart` 或 `xAI 视频 API · JSON`。模型不会静默替换，应用不附送额度，不会通过仅填写配置就宣称连接成功。

兼容协议使用 POST `/v1/videos`、GET `/v1/videos/{id}`；完成后接受 URL/base64，或从同一上游的 `/v1/videos/{id}/content` 下载。xAI 协议使用 POST `/v1/videos/generations` 的 JSON 请求，记录 `request_id`，再用 GET `/v1/videos/{request_id}` 查询。不同上游的模型权限、时长、尺寸、参考图格式及收费以其实际服务为准。当前不提供剪辑、转码或本地视频模型。

视频创建请求只提交一次，不做自动 POST 重试。网络异常而未拿到远端 ID 时，应先核对上游记录再重新生成，避免重复计费。关闭面板或切换工作区不停止后端轮询；退出整个应用会停止本地处理。再次启动后，使用原来的上游配置点击「恢复查询」，只恢复已有 ID 的查询/下载，不重新创建视频。「停止」只取消本地任务，不保证取消上游计算或费用。

完成的视频保存到当前输出目录的 `videos/<local-task-id>.mp4`，并自动加入创建任务时所属的工作区。后台完成不会抢走当前选中节点或视口。被删除的视频节点有交付回执，不会因为刷新任务列表而重新出现。

## 分层

- `backend/service.go`：Wails 生命周期、兼容生成入口；`generation.go`：图像执行与预览/结果组装。
- `backend/internal/taskqueue/`：队列、并发隔离、状态机、取消、重启中断状态、存储接口与 JSON 文件实现。
- `backend/tasks.go`：桌面任务 API、凭证解析、视频任务执行器、媒体登记。
- `go-cli/pkg/client/video_job.go`：显式视频协议适配、提交/查询/下载分离、错误分类。旧 `video.go` 保留兼容。
- `backend/canvas_document.go`：版本化画布文档、校验、原子保存与修订号冲突检测。
- `frontend/src/state/studioV2Runtime.ts`：全局任务查询与画布自动保存，不依赖视频面板挂载。
- `frontend/src/components/xai/XAIShell.tsx`：新首页与外层导航；简洁创作和专业编辑保留原有功能组件。

## 桌面绑定

`SubmitVideoTask(options)`、`ResumeVideoTask(id, options)`、`ListTasks()`、`GetTask(id)`、`Cancel(id)`、`RegisterVideoAsset(path)`、`LoadCanvasDocument()`、`SaveCanvasDocument(document, expectedRevision)`。

视频 options 包含 `baseURL`, `apiKey`（可由已有系统凭证存储读取）, `profileId`, `workspaceId`, `requestedJobId`, `provider`, `videoModelID`, `prompt`, `seconds`, `size`, `aspectRatio`, `resolution`, `referencePath`。返回值是无凭证任务记录，成功结果仅包含本地路径、媒体 URL 与画幅信息。

任务状态：`queued → running → succeeded/failed/cancelled`；启动时将遗留非终态转换为 `interrupted`。持久化文件位于应用稳定数据目录的 `studio-v2/tasks.json` 和 `studio-v2/canvas.json`。不要手动删除旧版应用数据；本实现不会清空旧图像历史。

## 画布与安全边界

画布保存工作区名称、提示词、图片/视频节点、世界坐标、选中节点及平移/缩放视口。沿用现有 Konva 无限画布的平移、缩放、节点拖动/选择/删除及适配全部。蒙版、标注和图像编辑仍针对选中的图片。`visibleCanvasNodes` 是已测试的视口筛选工具，当前提交保留原有 CanvasStage 渲染路径，不宣称已实现大规模节点虚拟化。

桌面使用后端文档；浏览器预览使用 IndexedDB 文档，不提供视频生成服务。自动保存有 300ms 防抖与串行提交；跨窗口修订号冲突或文件损坏会显示错误并停止写入，避免静默覆盖。退出时无法保证尚未完成的异步保存，页面会提示未保存状态。

任务记录和画布不序列化 API Key 字段、鉴权请求头、任意请求 DTO、base64/blob 二进制或带凭证查询参数的 URL。提示词、任务标签和本地文件路径仍是本地明文内容。视频下载只给同源 API 内容端点发送 API Key，不向 CDN 转发；外部下载有 DNS/IP 校验、重定向限制、大小限制与临时文件落盘。保留现有托管目录、符号链接和路径检查。视频参考图限 20 MiB，下载限 512 MiB。

视频并发 2；总并发安全上限 32，排队上限 256。历史图像的“无限并发 / 0”在新核心中按 32 的安全上限处理。任务磁盘快照保留最近 1000 个终态与所有未完成项；画布限制 100 个工作区、10000 个节点和 16 MiB 文档。这些不是商业配额，而是当前桌面实现的资源保护限制。

## 验证

```sh
cd go-cli && go test -race ./pkg/client/...
cd ../image-studio && go test -race ./backend/...
cd frontend
npm ci
NODE_OPTIONS=--experimental-strip-types npm test
npm run build
```

Windows PowerShell 设置环境变量时使用 `$env:NODE_OPTIONS='--experimental-strip-types'`。桌面打包按 `docs/build.md` 的 Wails 和平台依赖步骤执行。浏览器 smoke 的安装/执行命令见 `.github/workflows/backend-v2.yml`；截图与 JSON 报告在对应 Actions 的 `studio-v2-browser-evidence` artifact 中。

自动化测试覆盖任务并发、重复 ID、取消后迟到结果、重启恢复、磁盘失败、视频协议 mock、受限下载、凭证不向 CDN 转发、画布文档冲突与前端序列化。浏览器检查验证导航与 IndexedDB 恢复，不代替 Wails 真机和真实付费上游测试。真实 API Key、Windows/macOS 原生打包和真实视频编解码兼容性仍需在目标环境验收。
