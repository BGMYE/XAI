# Backend v2 · 视频任务与持久化无限画布

本次改造保持 Wails + Go + React 技术栈。这里的后端是桌面应用本地后端，**不是新建的多用户 SaaS 或公开 HTTP API 服务**。用户通过自己有权使用的 Base URL、API Key、明确的视频模型 ID 调用外部上游。

## 界面与入口

桌面启动页采用浅蓝玻璃面板、柔和曲面背景、左侧导航、简洁/专业双模式。字体统一到系统无衬线字体链，不引入字体二进制或外部字体请求。图片/视频/任务数来自实际已加载数据；“已配置”不等于网络连接已验证，不显示虚构额度、会员身份或作品。

- 首页：开始创作、生成视频、导入参考图、新建画布、最近作品。
- 简洁模式：保留原图像生成/编辑配置，新增持久化视频任务入口。
- 专业模式：真实世界坐标画布，图像/视频节点、选择、平移、缩放、拖动、删除、适配全部。
- 作品、资源、工作区、任务中心均接入实际状态；完整图片历史继续使用原有历史存储。

**工作区不是可执行的节点工作流引擎。** 当前没有连线依赖调度、视频剪辑、转码、多用户协同或云同步。

## 后端分层

| 文件/模块 | 职责 |
| --- | --- |
| `backend/service.go` | Wails 生命周期和原 Generate/Edit/Cancel 兼容绑定 |
| `backend/generation.go` | 图像请求、回退、预览与本地素材落盘 |
| `backend/internal/taskqueue` | 有界队列、并发、状态、取消、恢复、原子持久化 |
| `backend/tasks.go` | 图像事件映射、视频编排、凭据解析、本地媒体登记 |
| `go-cli/pkg/client/video_job.go` | 视频协议、创建、状态查询、受限流式下载 |
| `backend/canvas_document.go` | 画布文档校验、版本、乐观锁、原子写入 |
| `frontend/src/lib/studioDocuments.ts` | 白名单序列化、串行保存、任务版本合并 |
| `frontend/src/state/studioV2.ts` | 全局任务观察、工作区恢复、幂等交付 |

任务记录不存 API Key、请求凭据或完整请求对象。密钥继续由已有系统安全存储管理；已配置的备用图像上游仍遵循原图像重试策略。不能据此推断外部网关或原有原始响应日志不会记录敏感内容。

## API Key 视频接入

在「上游配置」显式填写视频模型 ID，再在「生成视频」选择相符协议：

| 协议 | 创建 | 查询 | 取回结果 |
| --- | --- | --- | --- |
| OpenAI 兼容 | `POST /v1/videos`，multipart | `GET /v1/videos/{id}` | URL、`b64_json` 或同源 `/{id}/content` |
| xAI | `POST /v1/videos/generations`，JSON | `GET /v1/videos/{request_id}` | `video.url` |

不自动发现、替换或推测模型。兼容协议不代表任意服务商都兼容；时长、分辨率、首帧支持和模型权限应以实际服务商为准。参考首帧来自应用已导入/托管图片，限 20 MiB。xAI 参数按当前协议支持 1–15 秒、常见比例和分辨率选择；1080p 是否可用由模型决定。

2026-09-18 核对的官方协议资料：
- [xAI video generation](https://docs.x.ai/developers/model-capabilities/video/generation)
- [OpenAI video create](https://developers.openai.com/api/reference/typescript/resources/videos/methods/create)
- [OpenAI video content / job lifecycle](https://developers.openai.com/zh-Hans/api/docs/guides/video-generation)

**OpenAI 官方文档已公告 Sora API 于 2026-09-24 停用。** 保留 OpenAI 兼容协议是为了兼容服务商的接口形态，不应将官方 Sora 的可用性视为长期保证。

视频创建只提交一次，不自动重试可能收费的 POST。查询允许有界退避重试；正常间隔 5 秒，单任务整体上限 30 分钟。下载默认上限 512 MiB，先写临时文件再替换最终 MP4。媒体 CDN 不接收 API Key，下载使用协议/地址/DNS 校验。取消仅停止本地处理，不能保证外部上游停止生成或计费。

程序退出会将活动任务标记为 interrupted。恢复查询使用原远端 ID 和原配置，不重新创建视频。即使用户取消和创建成功的返回同时发生，也保留已获得的远端 ID。未拿到远端 ID 的失败不会自动重新提交，应先向上游核查是否已创建/计费。

## 持久化与恢复

在平台稳定数据目录下新增：

```text
studio-v2/
  tasks.json
  canvas.json
```

视频保存于用户输出目录的 `videos/` 子目录，原图像、缩略图、导入和图片历史机制保留。

画布保存工作区名称、提示词、节点的世界坐标/尺寸/类型/本地文件引用、视口、选择和视频交付标记。**不会将当前全部图像参数、蒙版、撤销栈、Blob/Base64 或 API Key 一并保存。** 自动保存去抖 350ms，写入串行化；关闭前应确认“画布已保存”。浏览器无新版本地绑定时使用独立的 `xai-studio-canvas-v1/documents` IndexedDB 保存布局，与旧图片历史迁移隔离；不提交真实视频任务。状态栏明确区分浏览器和桌面存储。

视频结果始终交付到提交时的工作区；切换页面不会取消视频。结果节点 ID 确定且与交付标记一起保存，删除已交付节点后不会被轮询或重启再次补回。已删除的目标工作区可在任务中心手动“加入当前画布”。

文件读取/版本错误会停止写入并保留原文件。乐观锁冲突不自动覆盖或更换 revision；请保留当前编辑内容，关闭其他窗口并重新打开后检查。素材被移动时保留节点位置并提示，不删除原始文档。

当前保护上限：100 个工作区、10000 个节点、16 MiB 画布元数据；队列全局并发上限 32，视频并发 2，最多 256 个等待任务。任务仓库保留最近 1000 个终态任务以及活动任务。无限画布指可平移缩放的世界坐标，不代表无限内存。

## 验证

```sh
cd go-cli && go test -race ./pkg/client/...
cd ../image-studio && go test -race ./backend/...
cd frontend && npm ci
NODE_OPTIONS=--experimental-strip-types npm test
npm run build
```

可选的真实 React 离线交互测试，只替换 Wails 传输边界，不访问生成服务：

```sh
# 在 frontend 目录；先完成 npm run build
node test/buildBrowserHarness.mjs /tmp/xai-smoke.html
# 需要已安装 Python playwright 和 Chromium；按环境设置 CHROMIUM_PATH
python test/browserSmoke.py /tmp/xai-smoke.html /tmp/xai-smoke-results
```

测试包括：视频表单仅提交一次、离开页面后结果仍进入原工作区、删除节点后不重复补回、重启恢复、画布冲突拒绝覆盖、1440/1394/820/390 宽度页面检查。测试数据和 API Key 均为本地合成 fixture，不会打包进生产入口。

GitHub `Backend v2 verification` 执行 Go 竞态测试、前端回归与生产构建。尚需具备真实上游权限后的端到端生成验证，以及 Windows/macOS 原生安装包/WebView 真机验证。本次不发布或声称已验证原生安装包。

Android 保留原 WebView 远程内核与旧视频入口，不宣称已接入桌面 Go 持久化队列；本地 CPU 放大仍是已有插值功能，不是 AI 超分。

## 并行改动整合

保留 `1804cca` 的独立 IndexedDB 数据库、画布文档验证、浏览器刷新恢复测试和未保存退出保护。本次统一到 `studioV2.ts`，移除被新首页及任务面板替代的重复 runtime/界面入口，避免两套订阅同时写文档。自动交付视频不抢占当前选择；本地媒体恢复、失败重试和任务版本合并使用同一条状态链。
