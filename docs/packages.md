# 安装包与下载渠道

本文档说明预编译安装包的下载入口、命名规则和平台差异。源码构建见 [build.md](./build.md)，应用展示见 [showcase.md](./showcase.md)。

## 下载渠道

### 稳定版本

稳定版本到 [RoseKhlifa/Image-Studio Releases](https://github.com/RoseKhlifa/Image-Studio/releases) 下载，适合日常使用与对外分发。

### 抢先测试版本

如果你想体验当前分支最近完成、但还没有进入上游 tag 的改动，可以到 [DR-lin-eng/Image-Studio Actions · release.yml](https://github.com/DR-lin-eng/Image-Studio/actions/workflows/release.yml) 下载最近一次成功构建的 artifact。

这类构建通常会更快包含当前开发分支上的改动，但稳定性和回归覆盖不如正式 release，建议只在测试环境使用。

Windows 用户需要额外注意：Actions 里的 CI artifact 如果没有经过 Authenticode 签名，在 Windows 11 上很容易被 Smart App Control 或 SmartScreen 直接拦截，提示“无法确认其编写人”或“可能不安全的应用”。这类包不应作为对外分发的正式安装包。

## 安装包命名规则

当前 release workflow 会产出带版本号前缀的安装包，格式大致如下：

| 平台 | 文件名模式 | 说明 |
|---|---|---|
| Windows x64 | `image-studio-<version>-windows-amd64.exe` | 裸 Wails 可执行文件，适合内部测试，不是安装器。 |
| Windows ARM64 | `image-studio-<version>-windows-arm64.exe` | 裸 Wails 可执行文件，适合内部测试，不是安装器。 |
| Windows Portable Fixed WebView2 x64 | `image-studio-<version>-windows-amd64-portable-fixed-webview.zip` | 便携压缩包，内置 Fixed Version WebView2 Runtime，适合用户直接解压后双击 `exe`。 |
| Windows Portable Fixed WebView2 ARM64 | `image-studio-<version>-windows-arm64-portable-fixed-webview.zip` | ARM64 便携压缩包，内置 Fixed Version WebView2 Runtime。 |
| Windows Installer | `image-studio-<version>-windows-installer.exe` | 单个 NSIS 安装器，内含 amd64 与 arm64 两套二进制，安装时按本机架构自动选择。 |
| Windows MSIX x64 | `image-studio-<version>-windows-x64.msix` | 面向 Microsoft Store / 企业分发的 x64 MSIX 包。 |
| Windows MSIX ARM64 | `image-studio-<version>-windows-arm64.msix` | 面向 Microsoft Store / 企业分发的 ARM64 MSIX 包。 |
| Windows MSIX Bundle | `image-studio-<version>-windows.msixbundle` | 同时包含 x64 与 ARM64 的 MSIX Bundle，优先用于 Microsoft Store 提交。 |
| macOS universal | `image-studio-<version>-macos-universal.zip` | 解压后得到 `Image Studio.app`。 |
| Linux x64 | `image-studio-<version>-linux-amd64.tar.gz` | 标准 Wails 桌面版。 |
| Linux ARM64 | `image-studio-<version>-linux-arm64.tar.gz` | 面向 ARM64 Linux 桌面环境。 |
| Android | `image-studio-<version>-android-release.apk` | 单 APK，运行时自适应 phone / pad 布局。 |
| Gio Windows | `image-studio-gio-<version>-windows-*.exe` | Gio 原生 GUI 版，不依赖 WebView2；Windows 下可作为 `image-studio://` 网页导入默认处理器。 |
| Gio Linux | `image-studio-gio-<version>-linux-*.tar.gz` | Gio 原生 GUI 版，不依赖 WebKitGTK；Linux 下可通过 CLI / `.desktop` 注册网页导入协议。 |

## 各平台选择建议

| 场景 | 建议下载 |
|---|---|
| 普通桌面用户 | 对应平台的 `image-studio-<version>-...` Wails 版。 |
| Windows 用户会直接解压后双击 `exe`，且机器上可能没有可用 WebView2 | `image-studio-<version>-windows-*-portable-fixed-webview.zip`。 |
| Windows 上没有稳定 WebView2 环境，或需要接收提示词网站的 `Send to Image-Studio` 深链 | `image-studio-gio-<version>-windows-...`。 |
| Linux 上想用 Gio 原生渲染路径，或需要接收 `image-studio://import?...` 深链 | `image-studio-gio-<version>-linux-...`。 |
| 手机与平板统一安装 | `image-studio-<version>-android-release.apk`。 |

## 平台注意事项

### Windows

- Wails 裸 `exe` 依赖 WebView2 Runtime；安装器版本会在安装阶段检查并静默拉起 WebView2 Runtime 安装。
- `windows-*-portable-fixed-webview.zip` 会把 Fixed Version WebView2 Runtime 一起打包，适合直接解压运行；请保持 `image-studio.exe` 与 `WebView2FixedRuntime/` 在同一目录层级。
- ARM64 设备优先下载 `windows-arm64`，避免 x64 仿真带来的额外开销。
- 对外普通分发时请优先使用 `image-studio-<version>-windows-installer.exe`，不要直接使用裸 `exe`。
- 便携 Fixed WebView2 包是单独 workflow 产物，不替代正式安装器或 MSIX。
- 提交 Microsoft Store 时请优先使用 `image-studio-<version>-windows.msixbundle`，其次再按需要使用分架构 `.msix`。
- 对外分发请优先使用带有效 Authenticode 签名的正式 release；未签名的 CI `exe` 或安装器在 Windows 11 上可能被智能应用控制直接阻止运行。

### macOS

- 安装包是 universal 产物，同时覆盖 Apple Silicon 和 Intel。
- 如果被 Gatekeeper 拦截，可执行：

```bash
xattr -dr com.apple.quarantine "Image Studio.app"
```

或者在 Finder 中右键选择“打开”。

### Linux

- 预编译包主要面向带 GTK / WebKitGTK 依赖的桌面环境。
- 如果你更想避免 WebKitGTK 依赖，可以优先试 Gio 测试版。
- Gio Linux 版支持通过 `go run ./cmd/image-studio-gio protocol register` 或 `bash scripts/register-gio-linux-scheme.sh /path/to/image-studio-gio` 注册 `image-studio://` 网页导入协议。

### Android

- 当前只维护一个 `android-release.apk`，运行时根据窗口尺寸和方向切换 phone / pad 布局。
- Android 壳层会复用前端远程内核和本地桥接能力，不再分别维护两套 APK。

## 相关文档

- [build.md](./build.md)：源码构建、验证脚本、CI。
- [usage.md](./usage.md)：首次配置、API 形态选择、参数策略。
- [showcase.md](./showcase.md)：界面展示与能力概览。
