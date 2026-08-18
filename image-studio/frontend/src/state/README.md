# State Layer

这里保存全局状态和运行时镜像。

## 文件职责

- `studioStore.ts`
  - 主业务状态、动作、工作区镜像、提交流程编排。

- `workspaceRuntime.ts`
  - 工作区运行态的纯辅助逻辑。
  - 用来约束运行中 job、批处理、活跃 tab 的派生行为。

## 维护规则

- store 可以调用 `platform/runtime/*` 暴露的统一接口。
- store 不应重新实现宿主桥接。
- `workspaceRuntime.ts` 优先保持纯函数化，方便测试与复用。

## 改动建议

- 如果改动涉及“平台差异”：
  - 先改 `platform/`
  - 再让 store 消费平台层能力

- 如果改动涉及“状态结构演进”：
  - 先看 `workspaceRuntime.ts` 是否已经有对应归一化逻辑
  - 不要把归一化规则散落进多个组件
