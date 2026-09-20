# 桌面架构：React + Wails + Go

桌面主线只维护 `image-studio/` 中的工作室。独立的 Gio 客户端及其本地第三方 UI 库、专用启动脚本、发布作业已经移除；删除的是另一套图形客户端，不是 Go 后端。

## 保留的能力与模块

| 层级 | 实现 | 职责 |
|---|---|---|
| 界面 | React + TypeScript + Vite | 新版工作室、上游设置、创作、作品和任务历史 |
| 无限画布 | React 节点、SVG 连线、CSS 坐标变换 | 平移缩放、拖动连线、撤销、模板与自动保存 |
| 桌面宿主 | Wails v2 | 系统 WebView、Go 绑定、文件对话框、窗口生命周期 |
| 本地后端 | Go `backend/studio/` | 上游配置、图片和视频任务、依赖调度、轮询、下载和素材回填 |
| 持久化 | 本地 JSON 与媒体文件 | 项目、节点、任务元数据及图片/视频 |
| 密钥 | 操作系统凭据库 | 独立保存 API Key，任务固定引用提交时的凭据版本 |

任务路径为：React 操作 → Wails 绑定 → Go 本地任务引擎 → 用户配置的上游 API → 本地媒体文件 → 原画布结果节点。生成由远端模型服务执行，不是在本机运行生成模型；本机 Go 后端不需要另租服务器。

`go.work` 保留 `image-studio`、`go-cli` 和 `shared/compat-go` 三个模块。`go-cli/` 与 `shared/` 仍被主工作室使用，不属于本次下线范围。经典编辑器、Android 壳层和可选 Worker 的现有实现也保留，不借此次清理删除其他功能。

新版浏览器模式仍只是本地画布预览，不保存 API Key、不代理生成请求。桌面端的 API Key 生图、生视频及节点工作流说明见 [studio-v2.md](./studio-v2.md)。本次精简不新增多人云端服务、时间线剪辑或其他供应商适配器。

## 发布与环境

`release.yml` 保留 Wails Windows、macOS、Linux，以及 Windows 安装器/MSIX 和 Android 的构建发布链路；不再包含独立 Gio 作业或发布依赖。Windows 主工作室仍需 WebView2，Linux 仍需 GTK/WebKitGTK。构建环境见 [build.md](./build.md)，产物选择见 [packages.md](./packages.md)。

本次不升级共享模块依赖，不重写 Git 历史，不清除已有 Releases，也不会访问或删除用户电脑上的凭据、作品、画布、历史记录或兼容状态文件。删除源码不会自动卸载用户此前下载的旧程序。

## 旧客户端与深链关联

不再提供 `image-studio-gio-*` 新构建。过去将 `image-studio://` 协议关联到旧 Gio 程序的 Windows/Linux 设备，删除旧可执行文件后可能留下失效关联。本次没有在用户系统自动改注册表、默认应用或 `.desktop` 配置，也没有宣称已迁移这些关联。

需要保留旧网页一键导入的用户，应先检查系统协议默认处理器再卸载旧程序；关联迁移是独立的系统集成任务。当前工作室内手动输入/粘贴提示词、导入参考图、通过 API Key 生成图片或视频，以及无限画布不依赖旧关联。macOS 原有 Wails 深链接收实现不变。详见 [prompt-import.md](./prompt-import.md)。

## 回归验证

```bash
# 仓库根目录；离线检查 workspace、核心入口和发布依赖
node scripts/verify-desktop-architecture.mjs

# Go 核心与真实 HTTP 适配器连接本地模拟上游
cd image-studio
go test -race -count=3 ./backend/studio/...
cd frontend
npm ci
npm test
npx tsc --noEmit
npm run build
```

CI 在实际已移除客户端的源码树上运行核心测试、依赖清单检查、Windows 交叉编译、浏览器画布回归及五个桌面目标的打包验证。结构检查不能代替功能测试；最终通过情况以对应提交的 Actions 记录为准。现有 HTTP 测试使用本地 mock，不提交真实收费请求；凭据库、原生对话框、各系统视频播放与实际模型权限仍需目标设备验收。
