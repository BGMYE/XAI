# Kernel Request Model

这里收口的是跨端共享的“请求规范层”，只负责定义发给上游 OpenAI 兼容接口的请求形态，不负责具体传输。

## 目标

- 统一 `Responses API` 请求体构造
- 统一提示词优化请求体构造
- 让 browser worker、frontend remote runtime、后续 JS 宿主都复用同一套字段规范

## 当前约定

- 默认图片会优先走两种 API 形态之一：
  - `responses`：显式调用 `image_generation` 工具，支持精确执行 / 创作辅助；SSE 传输不等于已实现服务端多轮续接
  - `images`：标准 `/v1/images/generations` 和 `/v1/images/edits`，按上游能力使用 SSE 或 JSON
- Google 官方 `generativelanguage.googleapis.com` + `gemini-3.1-flash-image` 是窄例外：
  - 仍由用户选择 `images` 模式，但宿主按官方文档改发 `/v1beta/interactions`
  - 第三方 relay 不走这条原生路径，继续使用其 OpenAI-compatible Images 端点
- 默认请求策略是 `openai`：
  - 只发送 OpenAI 官方公开字段
- 可选请求策略是 `compat`：
  - 允许附带 relay 常见扩展字段，例如 `seed`、`negative_prompt`
- `Responses API` 下的 mask 使用：
  - `tools[0].input_image_mask.image_url`
  - 值必须是 `data:image/...;base64,...` 形式的数据 URL
- `Images API` 下的 mask 不在这里构造，由调用方按 multipart 上传，并显式带正确图片 MIME

## 分层

- `shared/kernel/requestModel.js`
  - 只做字段规范、默认值、能力校验和错误摘要；保留的旧重试辅助函数不代表宿主会自动重发生成
- `image-studio/frontend/src/platform/runtime/remote-kernel/`
  - 负责浏览器/Android 传输、SSE 解析、Images multipart
- `go-cli/pkg/client/*`
  - 负责桌面 Go 传输和落盘链路

## 收费请求边界

Worker 和共享远程内核每个图片任务只提交一次，不自动切换上游、不改写尺寸后重发。超时、5xx 和断流不能证明上游未执行；先核对状态，再由用户明确重新提交。可确认尚未提交的 WebSocket 握手兼容回退与生成重试是不同动作，具体范围见 [Worker 说明](../../cloudflare-worker/README.md)。

## 修改原则

- 如果只是字段规范变化，优先改这里
- 如果是传输差异，比如 `fetch`、Android native HTTP、Go multipart，实现留在各自宿主层
- 不要在多个入口重复维护同一份 `Responses` JSON 结构
