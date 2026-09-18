# Azure Studio：新版桌面工作室

本次重构新增独立 Go 领域内核、薄 Wails 绑定和 React 创作工作室。首页采用浅蓝玻璃、柔和曲线、双模式卡片及统一字体栈；作品、任务状态与统计来自真实本地数据，不填充虚构记录。

## 启动

使用仓库 `go.work` 指定的 Go 工具链（当前最低 1.25.5，工具链 1.26.3），Node 22.18 或以上版本，以及 Wails v2。平台系统依赖仍见 [构建说明](./build.md)。

```bash
git fetch origin
git switch refactor/azure-studio-backend
cd image-studio/frontend
npm ci
npm run build
cd ..
wails dev
```

前端预览可在 `image-studio/frontend` 运行 `npm run dev`。浏览器可以编辑、保存、导入和导出画布，数据保存在 IndexedDB；它不是在线 SaaS，不保存 API Key，不代理收费生成请求。

新版默认用于桌面。Android 继续使用原有平台路径。蒙版编辑、Responses API、旧历史与旧配置通过「经典编辑」保留；没有自动迁移或覆盖旧数据。新版任务由桌面进程管理，切换编辑器不会自动取消任务。

## 连接上游与生成视频

打开「设置 → 添加上游」，填写名称、完整 API 根地址（包含上游要求的 `/v1` 等路径）、协议、API Key、图像模型 ID、视频模型 ID。模型名由用户明确填写，视频模型不会被替换成图像模型。测试连接仅读取 `/models`，不会触发生成；模型列表可见不等于所有扩展参数都可用。

| 适配器 | 创建视频 | 查询任务 | 获取文件 |
|---|---|---|---|
| xAI | `POST /videos/generations`，JSON | `GET /videos/{request_id}` | `video.url` |
| OpenAI 兼容 | `POST /videos`，multipart | `GET /videos/{id}` | URL/base64，或鉴权的 `/videos/{id}/content` |

xAI 请求使用 `duration`、`aspect_ratio`、`resolution` 和可选 `image.url`；OpenAI 兼容请求使用 `seconds`、`size`、可选 `input_reference` 文件。空时长省略，由上游决定。当前适配器支持 xAI 1–15 秒、OpenAI 兼容 4/8/12 秒；实际可用模型与参数仍以上游权限和文档为准。

协议依据：[xAI 视频生成文档](https://docs.x.ai/developers/model-capabilities/video/generation)、[OpenAI 视频创建文档](https://developers.openai.com/api/reference/resources/videos/methods/create)。兼容网关不一定实现相同字段，不承诺所有供应商通用；其他供应商应增加单独的 `Runner` 实现。

简洁模式可直接提交图片或视频任务。专业模式可以连接：

```text
提示词 → 图像生成 → 视频生成
```

每个生成节点最多一张参考图片，支持图片生成结果作为下游参考，不接受视频充当图片。整个工作流在同一事务内校验并创建任务；任一节点无效时整批拒绝，不先提交部分收费请求。运行前提示生成节点数和可能产生的 API 费用。

## 分层结构

```text
image-studio/backend/studio/
  domain.go       类型、输入约束、DAG 校验
  repository.go   版本化本地仓储、写入与损坏保护
  profiles.go     上游元数据、版本化安全凭据引用
  engine.go       有界 worker、幂等任务、依赖调度、暂停恢复
  provider.go     明确协议的请求、轮询与受限媒体下载
  assets.go       素材落盘、结果回填、Range 媒体服务
  studio_test.go  领域测试与本地 mock 上游测试
image-studio/backend/studio_v2.go
  Wails 生命周期、系统凭据适配、原生保存对话框
image-studio/frontend/src/studio/
  StudioApp.tsx   首页、简洁创作、作品、工作流、历史、设置
  Canvas.tsx      世界坐标画布、节点、连线、撤销与重做
  useStudio.ts    草稿、自动保存与冲突合并
  graph.mjs      几何、拓扑、三方合并、模板白名单
  client.ts      桌面绑定与本地浏览器预览
  studio.css     统一字体、浅蓝玻璃主题、响应式布局
```

这是桌面主创作链路的重构，不是新增公网多用户服务。没有 Redis 集群、在线账号系统或多人协作服务；旧后端仍负责经典编辑器的既有能力。

## 任务与收费安全

任务先保存再发请求，默认两个 worker。同一任务 ID、相同内容返回已存在任务；同 ID 不同内容拒绝。成功提交后再次点击生成会创建新任务，可能产生新费用。

创建请求超时、5xx 或结果无法确认时标记 `uncertain`，不自动重发可能已被计费的 POST。已保存远端 ID 的任务中断后可恢复 GET 查询。查询 429/5xx 使用退避。重新打开应用不会自动执行积压收费任务：排队任务暂停，提交结果未知的任务需先到上游核对。

取消只保证停止本地任务或轮询，不保证远端取消或退费。依赖失败会阻止下游任务发出请求。生成结果固定回填提交时的画布，不跟随用户后来切换的项目。

## 密钥、存储与隐私

数据目录：`os.UserConfigDir()/ImageStudio/studio-v2/`。`studio.json` 保存元数据和任务，`media/` 保存下载的作品。旧数据目录不变。

API Key 存入操作系统凭据库，不写入 JSON、浏览器存储或工作流导出文件。每次更新密钥先创建独立槽，再提交引用；数据库写入失败不会改变旧地址对应的密钥。未结束任务固定使用提交时的上游配置和密钥版本。改变 Base URL 时必须重新输入密钥。凭据库不可用时明确报错，不回退到明文保存。

媒体只通过注册过的本地素材 ID 访问，支持 Range 请求。下载检查真实 MIME 和文件大小，拒绝 SVG/HTML；不会把 Bearer Token 发给外部 CDN。网络连接检查解析后的目标 IP，拒绝私网、链路本地、元数据地址；显式开启本地服务后仅允许回环地址。当前不继承环境 HTTP 代理。

提示词、项目元数据和媒体文件本身并非整体加密，依靠本机账户与磁盘权限保护。模板包含用户写的提示词；即使不导出凭据字段，仍需检查文本是否粘贴了敏感信息。生成时选定的提示词和参考图会发送到用户配置的上游。

## 画布与保存

支持平移、指针锚定缩放、节点拖动、Shift 多选、Delete 删除、连线、适配全部、Ctrl/⌘+Z 撤销和重做。提示词、生成器、便签、图片和视频素材可以在同一画布工作。

视口、节点和连线按项目保存。自动保存采用 revision 乐观并发检查；三方合并保留后台新增结果与本地编辑，同字段冲突明确提示，不静默覆盖草稿。冲突时可先导出草稿，再重新载入。模板只包含节点、连线、参数和文本，不携带媒体文件或素材绑定；导入后重新选择素材。

撤销最多 50 步，仅在当前编辑会话有效，刷新不保留撤销栈。没有视频剪辑、转码或时间线功能，也未声称超大画布虚拟化或多人实时协作。

## 容量与验证

内核默认 2 个 worker，可配置 1–8；最多 128 个未结束任务、10000 条任务历史、1000 个画布。单画布最多 2000 节点与 4000 连线，缩放 10%–400%。导入及参考图片最大 20 MB，输出媒体最大 160 MB，本地 JSON 最大 64 MB。存储面向单桌面进程，不支持多个进程同时修改同一数据库。

```bash
cd image-studio
go test -race -count=3 ./backend/studio/...
cd frontend
npm ci
npm test
npx tsc --noEmit
npm run build

# 可选的生产构建浏览器验证，无真实 API Key
npm install --no-save --package-lock=false playwright@1.55.1
npx playwright install chromium
node scripts/studio-browser-smoke.mjs
```

旧 Node 22 版本运行直接导入 TypeScript 的测试时可能需要 `NODE_OPTIONS=--experimental-strip-types`。CI 使用更新的 Node 22。

`.github/workflows/studio-rebuild.yml` 包含 Linux race、Windows 原生核心、完整前端测试与类型检查、生产构建、Windows 交叉编译，以及 Chromium 画布交互。`studio-browser-evidence` 保留对应提交的日志、截图和报告；是否通过以该提交的实际 Actions 结果为准。

自动测试只使用本地 mock 上游，没有提交真实收费请求。发布前仍需在目标桌面系统人工验证系统凭据库、保存对话框、退出恢复、WebView 视频播放以及有权限的真实图像/视频 API。CI 成功不等于所有平台 GUI 与所有第三方上游均已验收。
