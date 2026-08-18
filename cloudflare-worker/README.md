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
