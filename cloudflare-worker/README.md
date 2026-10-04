# Image Studio Cloudflare Worker

这个目录提供一个最小 Cloudflare Worker 入口，用于把 Image Studio 的共享请求模型部署到 Worker 侧。

## 当前能力

- `GET /healthz`
- `GET /v1/models`
- `POST /kernel/prompt-optimize`
- `POST /v1/responses`
- `POST /v1/images/generations`
- `POST /v1/images/edits`
- `POST /kernel/generate`

## 约束

- `v1/images/*` 已支持原样代理到上游,适合让前端把 `baseURL` 直接指到 Worker。
- Worker 目前更偏「代理 / 验证入口」,不是完整的持久化服务:
  不负责 KV/R2 存储、历史记录、raw 日志落盘。
- 需要通过 `Authorization: Bearer <key>` 传递真实上游 API Key。
- `IMAGE_STUDIO_UPSTREAM_BASE_URL` 可在 `wrangler.toml` 或部署环境里配置。

## 生成请求与失败处理

Worker 的图片生成 POST 只转发一次，不因 401/403/429/5xx、超时或断流自动重发、切换上游或改写尺寸。保留的历史重试配置不授权 Worker 重复提交生成。共享远程内核也按同样原则单次提交。

响应体直接流式转发，不在 Worker 内收齐后再次生成。上游返回的 `X-Request-Id`、`Request-Id`、`Openai-Request-Id` 和 `Retry-After` 响应头会保留；没有返回的 ID 不会由客户端虚构。5xx 响应标记 `x-image-studio-generation-status: uncertain`；连接错误返回 `generation_uncertain`、`retryable: false`，需要先核对上游任务和费用，再决定是否手动重试。

Responses、Images、模型列表及提示词优化使用同一个端点拼接规则：无版本根路径补 `/v1`，已填写的 `/v1`、`/api/v3`、`/openai` 或 `/openai/v1` 保持原有语义。客户端取消请求或关闭响应流会中止上游连接和读取。所有成功响应保持流式转发；HTTP 错误响应最多转发 64 KiB，超出后停止读取，并通过 `x-image-studio-error-body-limit: 65536` 告知错误正文可能被截断。

共享远程内核的 Android 原生传输仅在尚未收到任何流事件、且能识别 HTTP 400/404/405/426 的 WebSocket 握手拒绝时选择 HTTP SSE。401/403/429/5xx 和无法分类的传输错误不触发该回退；收到预览或请求可能已开始后也不自动降级。Android APK 已下线，此处说明保留的共享兼容路径，不代表恢复 Android 发布。

此 Worker 是可选代理，不是新版工作室浏览器预览的生图后端。新版桌面任务由 Go 工作室管理，负责最终结果、预览区分与不确定状态。

## 本地检查

```bash
cd cloudflare-worker
npm run check
npm run test
```

如果本机已安装 `wrangler`，还可以继续：

```bash
cd cloudflare-worker
npm run dev
```

## 和仓库内验证入口的关系

- 本地 mock 联调:`node ../scripts/local-smoke-check.mjs`
- 本地全量验证:`node ../scripts/verify-local-platform-kernel.mjs`
- 真实上游对比验证:`node ../scripts/live-verify.mjs`

`live-verify.mjs` 会提交真实请求，图像生成可能产生费用；仅在明确需要验证时执行，保存环境文件时不要提交真实密钥。列出命令不表示已经完成真实部署验证。

`live-verify.mjs` 会同时比较:
- 直连上游 vs Worker 代理的 `GET /v1/models`
- 直连上游 vs Worker 代理的 prompt optimize
- 直连上游 vs Worker 代理的最小 `/v1/responses`
- 直连上游 vs Worker 代理的 `v1/images/generations`
- 直连上游 vs Worker 代理的 `v1/images/edits`

它会优先读取以下任一环境文件中的变量:
- `.env.live`
- `.env.local`
- `.env`

可直接复制 `../scripts/live-verify.env.example` 作为模板。
