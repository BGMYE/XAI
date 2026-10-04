# 2026-10-04 审计问题修复记录

本轮按 `XAI-bug-audit-2026-10-04(1).md` 核对 XAI-001 至 XAI-008，在新版工作室改造的本地分支上修复。保留新版工作室、协议选择提示及此前的请求能力改造；未提交或推送 GitHub。

| 编号 | 修复后的行为 | 回归证据 |
| --- | --- | --- |
| XAI-001 | 新建项目、旧数据库读取及前端快照/增量入口将缺失或 null 的节点、连线集合规范化为空数组；非数组的异常数据仍报错，不静默清空。 | `project_collections_test.go`、`studio-collections.test.mjs` 覆盖经典历史导入、旧库恢复和前端遍历。 |
| XAI-002 | Worker 的生成 POST 仅发送一次。524、连接中断和不确定结果均不自动重发；重定向不自动跟随。 | Worker 的 524、网络失败测试，以及 `workerIntegration.test.mjs` 的跨层提交次数断言。此前改造已修复，本轮保留并验证。 |
| XAI-003 | WebSocket 生成和探测绑定上下文取消并关闭连接，及时解除阻塞读写。探测最多 30 秒，调用方更短的期限优先；已收到的完整成品保留。 | `responses_websocket_cancel_test.go` 使用静默的本地 WebSocket 服务，验证取消、超时、连接关闭、成品保留及只发送一次。 |
| XAI-004 | 自动保存收到确认后，合并等待期间已消费的更新版本，再判断是否继续保存。保留期间的本地编辑；冲突拒绝 flush，写入失败不自动重试；迟到响应不复活已删除画布。 | `studio-autosave.test.mjs` 的 5 项真实 React Hook 异步回归，包括 revision 1 → 保存 2 → 增量 3 的复现。 |
| XAI-005 | 持久化待回收凭据槽位 ID。配置轮换、任务结束、删除历史、归档和删除配置后，回收无引用凭据。当前配置及未结束/可恢复任务的主、备用凭据继续保留。删除失败在后续修改、定时检查和重启后重试。 | `credential_cleanup_test.go` 覆盖主/备用引用、暂停任务、共享引用、重启、删除失败重试以及新凭据写入失败；不使用真实系统凭据。 |
| XAI-006 | 素材去重命中后校验文件大小与 SHA-256；重导入原子修复缺失、截断及等长损坏文件，保留素材 ID 和引用。正常文件不重写；非普通文件目标拒绝覆盖。 | `asset_repair_test.go` 覆盖字节和路径两种输入、3 类损坏、正常文件不变及不安全目标。 |
| XAI-007 | Worker 各入口统一使用共享端点函数，保留 `/api/v3` 等显式 API 根路径。 | Worker 5 种根地址 × 6 个入口的路径矩阵及覆盖地址/查询参数测试。此前改造已修复，本轮补全覆盖。 |
| XAI-008 | Worker 转发成功响应流，不等全部响应结束才返回；下游取消会终止上游请求与读取。错误正文上限 64 KiB，保留请求 ID 和相关响应头。 | Worker 验证上游 EOF 前即可收到首个 SSE 块，并覆盖各入口取消、预取消和超长错误流。 |

## 验证结果

- 前端完整测试：338 项通过，0 失败。
- 前端 TypeScript 检查及 Linux 目标生产构建通过。
- Worker：16 项测试通过；相关请求、远程内核与 Worker 集成测试通过。
- 工作室后端：完整 `go test -race ./backend/studio` 通过。
- Go 客户端：WebSocket 取消、结果保留和不重发的定向 race 测试通过。
- `git diff --check` 通过。

验证使用内存凭据、mock fetch 和本地测试服务；本轮未调用真实生图上游。未执行 Windows/macOS 原生桌面交互验收。

## 复跑命令

在 `image-studio/frontend`：

```sh
npm test
npx tsc --noEmit
npm run build
```

在 `cloudflare-worker`：

```sh
node --test test/index.test.mjs
```

在 `image-studio`：

```sh
go test -race ./backend/studio
```

在 `go-cli`：

```sh
go test -race ./pkg/client -run '^(TestResponsesWebSocketSilentCancellationAndDeadline|TestResponsesWebSocketCancellationPreservesReceivedFinal|TestResponsesWebSocketReadDeadlineRespectsParent|TestImageResultsWebSocket|TestWebSocketPostSendHandshakeTextNeverFallsBack)$' -count=1
```
