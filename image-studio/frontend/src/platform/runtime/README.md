# Runtime Layer

`runtime/` 负责“前端如何调用内核”，而不是“图片工具请求长什么样”。

## 结构

- [host.ts](/Users/lin/Image-Studio/image-studio/frontend/src/platform/runtime/host.ts)
  - 对上暴露统一宿主能力
  - 决定走 Wails、本地宿主、Android bridge，还是远程内核

- [remoteKernel.ts](/Users/lin/Image-Studio/image-studio/frontend/src/platform/runtime/remoteKernel.ts)
  - 兼容导出层
  - 让现有调用方和测试路径保持稳定

- `remote-kernel/`
  - `types.ts`
    - 远程内核共享类型、常量、错误类
  - `common.ts`
    - 通用帮助函数
    - source data URL 解析、重试判定、错误摘要、raw 文本登记
  - `nativeHttp.ts`
    - Android native HTTP 编码与调用
  - `requestPayloads.ts`
    - Responses / Images 请求体构造
    - 按 `requestPolicy` 决定是否发送 relay 扩展字段
  - `responses.ts`
    - Responses API 传输与 SSE 结果提取
  - `images.ts`
    - Images API 传输与 JSON 结果提取
  - `index.ts`
    - `runRemoteImageJob`
    - `optimizePromptRemote`

## 维护规则

- OpenAI 请求字段规范优先收口到 `shared/kernel/`
- `runtime/remote-kernel/` 只负责宿主传输、结果解析、重试与错误传播
- 如果一个改动只是字段形态变化，不要重新塞回 `host.ts` 或大而全的 `remoteKernel.ts`
