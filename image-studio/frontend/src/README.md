# Frontend Source Layout

这个目录承载 Wails 前端的全部运行时代码。维护时先看这里，再看子目录的 `README.md`。

## 分层规则

- `app/`
  - 顶层装配层。
  - 负责入口页面、平台工作区选择、惰性弹窗 gate、全局 hooks。
  - 这里不放具体业务组件实现，也不放宿主能力细节。

- `components/`
  - 纯 UI 组件层。
  - 按界面区域分组，例如 `canvas`、`panel`、`history`、`layout`。
  - 组件可以读 store，可以调用平台层暴露的能力，但不要在这里定义新的平台抽象。

- `platform/`
  - 跨平台前端适配层。
  - 负责平台检测、Android/Desktop 壳层、宿主能力桥接、远程内核运行时。
  - 任何涉及 `window.AndroidImageStudio`、Wails runtime、平台差异、宿主 IO 的逻辑都放这里。

- `lib/`
  - 平台无关工具。
  - 例如图像辅助、数据持久化、配置序列化、安全清洗、纯函数工具。
  - 如果某个文件开始依赖平台判断、宿主桥接、原生能力，就应该迁到 `platform/`。

- `state/`
  - 全局状态和运行时镜像。
  - 这里允许聚合业务动作，但不要把平台桥接实现直接写进 store 文件里，优先调用 `platform/runtime/*` 暴露的接口。

- `styles/`
  - 全局样式与分区样式。
  - 主题 token、基础排版、跨平台外观变量在 `index.css`。

- `types/`
  - 领域模型类型。

## 维护约束

- 新增跨平台逻辑时，先判断它属于“宿主适配”还是“业务逻辑”。
  - 宿主适配进 `platform/`
  - 业务逻辑进 `state/` 或 `lib/`

- 不再恢复旧的兼容出口。
  - 不要重新引入 `src/lib/platform.ts`、`src/lib/runtimeHost.ts` 一类历史路径。
  - 新代码统一引用当前目录结构。

- 若一个目录内部的约束开始变复杂，优先补该目录自己的 `README.md`，不要把规则散落到代码注释里。
