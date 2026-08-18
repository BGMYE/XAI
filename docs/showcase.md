# 应用展示与能力概览

本文档集中展示当前应用界面与高层能力。安装包选择见 [packages.md](./packages.md)，详细功能说明见 [features.md](./features.md)，首次配置见 [usage.md](./usage.md)。

## 界面预览

<p align="center">
  <img src="./picture/mac.png" alt="Image Studio · macOS" width="880">
  <br />
  <img src="./picture/windows.png" alt="Image Studio · Windows" width="880">
  <br />
  <img src="./picture/android.jpg" alt="Image Studio · Android" width="280">
  <br />
  <sub>macOS · Windows · Android 端界面预览</sub>
</p>

## 产品定位

Image Studio 面向 OpenAI 兼容图像上游，重点覆盖三类使用场景：

- 上游推理时间长，普通请求容易在 Cloudflare / Nginx 后面被 524/504 中断。
- 需要把图像生成、图生图、蒙版编辑、历史复用放在同一个本地工作台里完成。
- 希望在桌面端与 Android 端保持相近的参数模型、历史行为和保存路径语义。

## 能力概览

| 模块 | 当前能力 |
|---|---|
| Responses API | 使用 `/v1/responses` 和 `image_generation` 工具，SSE 持续回流事件，适合长推理和抗空闲断连场景。 |
| Images API | 支持 `/v1/images/generations` 与 `/v1/images/edits`，兼容只开放 image 分组的中转站。 |
| 参数系统 | 支持比例、分辨率、质量、风格、seed、negative prompt、输出格式；参数策略可在 OpenAI 标准与兼容中转扩展之间切换。 |
| 自定义比例 | 可在比例面板打开弹窗，添加多个自定义宽高比并持久化保存；新增比例会立即出现在按钮区，并按当前 1K / 2K / 4K 档位自动换算像素尺寸。 |
| 图像编辑 | 多参考图、蒙版、标注、旋转、翻转、裁剪、历史对比、复制粘贴、撤销重做。 |
| Workspace | 多标签工作区；每个 workspace 独立保存 prompt、参数、源图、当前画板状态和运行进度。 |
| 平台 UI | macOS Apple 风格、Windows Fluent 风格、Linux 通用桌面风格、Android Material 3 phone/pad 自适应壳层。 |
| 双端内核 | 桌面端优先走 Go/Wails 本地内核；Android / 浏览器预览可走前端远程内核，Android 壳层提供 native HTTP、文件和保存桥接。 |
| 本地数据 | API Key、历史、图片和日志默认保存在本机；外部请求只发往你配置的上游 BASE_URL。 |
| Gio 测试客户端 | Windows / Linux 可单独构建 Gio 原生 GUI 测试版，不影响当前 Wails / WebView2 主实现。 |

## 界面分工

- 左侧控制面板：负责 prompt、参数、参考图、上游配置入口和提交操作。
- 中央画板：负责当前图像预览、蒙版与标注编辑、对比和变换操作。
- 右侧历史栏：负责历史检索、复用、对比、重新生成与原始响应排查。
- Android phone / pad：沿用相同业务语义，但把参数和设置改成更适合触控的弹层与分栏结构。

## 相关文档

- [features.md](./features.md)：完整功能清单、平台能力、快捷键。
- [packages.md](./packages.md)：安装包下载、平台差异、产物选择。
- [build.md](./build.md)：源码构建、验证脚本、CI 流程。
- [usage.md](./usage.md)：首次配置、API 形态选择、参数策略。
