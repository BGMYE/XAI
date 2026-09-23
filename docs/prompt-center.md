# 专业模式：同源提示词图库与我的资源

入口：专业模式 → 资源 → 提示词中心。也可点击画布顶部的「资源 · 提示词」。在画布上打开，不退出专业模式；保留本地素材与原有作品历史。

## 站点图库：使用原图与原始提示词

本次成功读取 `https://canvas-test.pqai.cc/prompts` 的公开页面与前端脚本。其脚本配置的 7 个源均来自 `https://raw.githubusercontent.com/yukkcat/image-prompts/main/dist/sources/`：

| 数据文件 | 来源 | 2026-09-22 核对数量 |
|---|---|---:|
| banana-prompt-quicker.json | Banana Prompt Quicker | 323 |
| davidwu-gpt-image2-prompts.json | DavidWu GPT Image 2 | 494 |
| freestylefly-gpt-image-2.json | Freestylefly GPT Image 2 | 541 |
| awesome-gpt-image.json | Awesome GPT Image | 53 |
| awesome-gpt4o-image-prompts.json | Awesome GPT-4o | 76 |
| youmind-gpt-image-2.json | YouMind GPT Image 2 | 126 |
| youmind-nano-banana-pro.json | YouMind Nano Banana Pro | 129 |

核对快照 `431009fe550f5b70f482b4484119ffe69b7773f6` 共 **1742** 条。应用请求与原站相同的 main 数据源，因此未来数量可能变化；CI 使用核对快照做可复现验证。UI 按来源顺序展示，保留每条原始 ID、标题、prompt 全文、coverUrl、referenceImageUrls、作者、标签和来源地址的关联，不靠图像反推，也不把摘要冒充完整提示词。

截图首屏的「苹果风格海报」「疯狂动物城海报」「贴吧老哥疯狂吐槽批注」「锐评世间万物」「渐变玻璃风格 PPT」「根据已有食材做菜」「城市海报艺术生成」「Q版角色LINE风格表情包生成」等来自第一个源。使用源记录的图片 URL，不内置随机图或替代示例。原来源图片不可用时显示占位提示，原始提示词仍可复制。

支持搜索标题/全文/标签/作者，按来源筛选、分批显示、详情、复制原文、加入我的资源和加入当前画布。原条目的模型标签只做说明，不会自动替换用户模型。原图库均按图片提示词显示，与参考站该页面一致；本地历史仍支持视频提示词。

## 我的资源与画布

「加入我的资源」把文本、作者、来源 ID、原图链接与参考图链接关联保存，不重复加入相同源 ID，不自动下载外部图片。桌面写入 Go 管理的 studio.json；浏览器预览写入 IndexedDB。也可维护自己的图片+提示词、收藏、搜索、编辑、删除卡片，以及复用新版 StudioV2 的成功生成历史。删除卡片不删除图片、生成任务或画布。旧经典编辑器历史未自动迁移。

「加入当前画布」只创建提示词节点、图像或视频生成节点及连线，不自动发起收费生成，不把预览图静默上传到模型。需要参考图时用户应显式导入；可在详情查看原条目的参考图。节点文字超过当前 5000 字符限制时会明确拒绝，而不是截断原文；复制仍保留最多 16000 UTF-8 字节的完整文本。

文本资料包仍采用白名单，仅带提示词、标签、作者及参数，不导出本地 ID、远程图片 URL、模型端点或 API Key。资料包导入后重新绑定图片，避免导入文件自动触发任意外部请求。用户写入正文的敏感信息仍需自行检查。单标签容量为256字节以保留原作者署名标签。

## 网络与密钥边界

公共目录只在打开站点图库时读取，最多3路并发。桌面 Go 方法仅接受7个来源 ID，不接受任意 URL；无 Authorization/Cookie、不读取凭据库、无用户提示词或项目传出。响应限制8 MB、每源5000条。Web 预览读取相同源，credentials=omit，referrerPolicy=no-referrer。

预览图为原站 HTTPS URL，仅接受已审阅图床域名，不复制到本仓库或应用分发包；img 使用 no-referrer。浏览原图会连接原图服务，它可看到常规网络请求信息。若图床扩展需审阅白名单，不能为绕过失败开放任意内网 URL。原图失效时不制造替代图片。

目录缓存与任务历史分开存储。6小时内优先使用上次有效缓存，可点击刷新；刷新失败保留旧缓存并明确提示。已保存个人卡片文本离线可用，远端缩略图离线未必可见。首次离线且没有缓存时明确显示不可用，不生成虚假图文。此模块不需要 cloudflare-worker，不影响生成服务的 API Key 设置。

## 来源和素材权利

`yukkcat/image-prompts/NOTICE.md` 明确说明其 MIT 许可只覆盖同步代码和文档，不重新许可汇集的提示词、图像或姓名。本实现读取同一公开来源并保留逐条作者和链接，不将这些第三方作品标为 XAI 原创、也不声称统一拥有其商业再分发权。公开预览不等于素材可任意商用，需查看各源条款。第三方版权说明见 `THIRD_PARTY_CATALOG_NOTICE.md`。

## 验证

```bash
node scripts/verify-desktop-architecture.mjs
cd image-studio && go test -race -count=3 ./backend/studio/...
cd frontend && npm ci && npm test && npm run build:windows
cd ../..
python -m pip install playwright==1.57.0
python -m playwright install chromium
python scripts/test-prompt-center.py
python scripts/verify-reference-catalog.py
python scripts/test-public-catalog.py
```

原站公网获取不需要账户或模型 Key，CI 的来源下载只作为测试证据，不打包至应用。生成测试使用本地 mock，不产生真实生成费用。完整 Wails 和系统剪贴板验收与浏览器组件测试应区分；CI截图来源测试使用真实抓取图文，不是示例生成历史。
