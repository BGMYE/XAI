# Platform Layer

`platform/` 是前端跨平台适配层。这里是当前前端重构里最重要的维护边界。

## 职责

- 平台识别
  - `index.ts`
  - 判断 `macos` / `windows` / `linux` / `android` / `android-pad`
  - 输出 `data-platform`、`data-target-platform`、`data-ui-family`

- 平台上下文
  - `context.tsx`
  - 给组件提供统一的 `usePlatform()`

- 平台 UI 壳层
  - `android/AndroidShell.tsx`
  - `desktop/DesktopShell.tsx`

- 宿主能力桥接
  - `android/bridge.ts`
  - `android/nativeInvoke.ts`
  - `android/wailsShim.ts`

- 宿主运行时能力
  - `runtime/host.ts`
  - `runtime/remoteKernel.ts`

- 平台专用类型
  - `types.ts`

## 子目录规则

- `android/`
  - 仅放 Android 特有逻辑。
  - 包括 Android UI 壳层、Android JS bridge、Android invoke 适配。

- `desktop/`
  - 放桌面壳层。
  - 如果未来出现 Windows/macOS/Linux 明显分叉，可以继续在这里细分。

- `runtime/`
  - 放宿主运行时和远程内核执行层。
  - 这里允许碰 Wails runtime、浏览器 fetch、Android native HTTP、虚拟文件桥。

## 维护约束

- 任何依赖宿主环境的逻辑都先考虑放到这里。
  - 例如：
  - Wails runtime
  - `window.AndroidImageStudio`
  - 原生文件对话框
  - 平台快捷键差异
  - 宿主 HTTP 替代通道

- 不要把平台判断重新塞回 `components/` 或 `lib/`。
  - 组件只能消费 `usePlatform()` 或 `platform/runtime/*` 暴露的结果。

- 若测试依赖平台全局对象，优先修这里的状态隔离。
  - 这次重构后 `android/nativeInvoke.ts` 已经修过“测试切换 window 后 hook 不重装”的问题，后续不要再回退成进程级单例假设。
