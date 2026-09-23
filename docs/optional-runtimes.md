# Android 壳层与可选 Worker 的边界

## android-shell（已下线）

该模块用 Kotlin/Gradle/Android WebView 把已有 React 前端打成 APK，并提供 Android 侧文件、原生 HTTP、后台请求等桥接。桌面 Wails 不从这里加载业务实现。

本次已删除 Android 壳层和专用验证脚本，移除 Release 的 APK 构建/发布依赖及 CI 中的 JDK/Android SDK 准备步骤。保留桌面共享的前端平台兼容代码和测试，不再提供 Android APK 新构建；不修改用户已安装的程序或历史 Releases。

## cloudflare-worker

代码在 `cloudflare-worker/src/index.js`，说明在同目录 README。它是可选的远端 API 中转／验证入口，不是本地桌面后端，不是模型服务，也不是提示词图片库。

直连：桌面 Go 后端 → 用户自己的上游 API。
中转：客户端 → 自行部署的 Worker → 配置的上游 API。

当前路由包括 `/healthz`、`/v1/models`、`/v1/responses`、`/v1/images/generations`、`/v1/images/edits`、`/kernel/prompt-optimize`、`/kernel/generate`。当前没有 `/v1/videos` 或 `/videos/generations` 视频适配；不要把它配置为图片/视频通用网关。

真实上游 API Key 通过 Bearer 请求头进入 Worker，再转发给上游；它不是一个自动隐藏用户密钥的保险箱，部署者必须可信。代码没有实现项目、历史、作品的持久化，也没有 KV/R2 文件库。现有实现也不应直接当作具备完整跨域授权、认证、配额和多租户隔离的公开生产代理。

不部署 Worker、直接在桌面配置真实模型服务商时，桌面 API 生图、生视频与无限画布不需要该模块。保留源码不会使所有桌面请求自动绕经 Cloudflare。提示词中心本地预览、复制与收藏同样不依赖它。
