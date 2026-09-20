# Image-Prompts 配套项目与导入说明

[Image-Prompts](https://prompts.sorry.ink/) 是 Image Studio 的配套提示词站。网页使用 `image-studio://import?...` 请求调用系统注册的桌面处理器；能否拉起应用取决于本机的协议关联。

## 当前桌面主线

桌面统一维护 `image-studio/` 下的 React + Wails + Go 工作室。macOS 原有 Wails URL 接收与经典编辑器的导入确认实现保留，本次不改变其行为。提示词导入与新版图片/视频任务、无限画布是不同功能，不应将深链送达经典编辑器解释为新版画布已自动创建任务。

Windows / Linux 过去由独立 Gio 客户端负责协议注册和网页导入。该客户端及其专用 Linux 注册脚本已下线，仓库不再提供相应 CLI。本次没有增加 Wails 的自动协议注册，也没有自动迁移用户已有的系统关联。

## 旧关联注意事项

旧设备可能仍将 `image-studio://` 指向 `image-studio-gio`。直接删除旧可执行文件后，网页按钮可能失效。需要使用网页一键导入时，应先检查系统的默认协议处理器；本次源码清理不会改动用户电脑的注册表、`.desktop` 文件或用户数据。

在主工作室内手动输入或粘贴提示词、导入本地参考图、调用 API Key 生图/生视频及使用无限画布，不依赖该深链入口。不能保证旧关联已自动切换到 Wails。架构与下线边界见 [desktop-architecture.md](./desktop-architecture.md)。

## 导入安全边界

保留的导入流程会先展示确认界面，不应把外部网页链接直接当作生成或付费授权。导入能力不包含 Android。一次性 token 的有效期与消费策略由提示词站控制，不由本次桌面清理改变。

## 相关链接

- 站点：[prompts.sorry.ink](https://prompts.sorry.ink/)
- 配套仓库：[RoseKhlifa/Image-Prompts](https://github.com/RoseKhlifa/Image-Prompts)
