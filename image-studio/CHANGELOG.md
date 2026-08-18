# Changelog

按倒序排列;每条对应一次「批量完善」推进。

## 0.1.0 — 初始 GUI 版本(2026-05)

### 新增
- 文生图 / 图生图(单源 + 多参考图)
- Wails GUI:左侧控制面板 / 中间画布 / 右侧历史栏
- 画布 4 项能力:缩放拖动另存、蒙版绘制、画框标注、历史对比
- 蒙版:画笔/橡皮切换,半透明实时叠加,base64 PNG 传后端 `mask` 字段
- 标注:矩形 / 箭头 / 自由画笔 / 文字,8 色调色板,选中后 Delete 删除
- 图变换:旋转 90° / -90°、水平/竖直翻转、矩形选区裁剪(后端 Go image 处理)
- 多参考图:拖入/粘贴/选择/复用累积到列表,可拖动重排顺序,× 单删
- 缩略图条:画布上方横向展示当前所有参考图(支持拖拽重排)
- 历史:IndexedDB 持久化、搜索/筛选(mode/日期)、Shift 点击对比、右键菜单
- 历史对比:左右分屏 + 中间紫色滑块,clip-path 实现
- 拖拽/粘贴:文件管理器拖入或 Ctrl+V 粘贴 → 写到 imports/ → 进画板 + 加 sources
- 撤销/重做:统一 timeline,蒙版/标注/清空全部进栈,Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y
- 工具:全屏 F11、双击 fit/100%、空格临时 pan、F 重置视图、1/2/3 切工具、[/]调笔刷
- Ctrl+C 复制当前画板图到剪贴板(ClipboardItem PNG)
- 高级参数:seed、negative prompt、BASE_URL 切换、文本/图像模型 ID 切换
- 批量生成:1 / 2 / 4 / 8 张,自动随机 seed 顺序执行
- 参数预设保存(localStorage)
- prompt 历史(去重 + cap 50)+ 8 个模板(写实/二次元/水彩/像素等)
- 错误处理:banner 可关闭 + 「↻ 重试上次请求」、Toast 通知系统(成功/警告/失败)
- 进度估算:基于最近 5 次耗时的滚动平均
- 系统通知:窗口非焦点时生成完成 → Windows toast
- raw 响应一键查看(modal 含复制全文)
- 右键菜单:复制 prompt / 复制路径 / 查看 raw / 设为源图 / 用作对比 / 删除
- 关于对话框 + 设置面板(输出目录 / 模型 / 清除 key / 清空历史)

### 修复
- canvas-shell 用 flexbox 代替 grid,彻底切断 Konva canvas 撑爆 stage-host 的正反馈循环(此前 host_dom 测出 2405/3731,真实窗口仅 1424)
- hostRef 改成 callback ref,避免 ResizeObserver 在 empty-state → has-image 切换时残留在已卸载的 div 上
- view 改用 `userView ?? fit`,切换历史图不再保留上一张的平移/缩放状态
- fit 改成普通函数(非 useMemo),消除依赖闭包导致的尺寸延迟

### Go 端
- `pkg/client.Options.ImageDataURLs []string` 多图字段,`BuildPayload` 顺序追加 input_image
- Options 加 Seed / NegativePrompt / BaseURL / TextModelID / ImageModelID 字段,BuildPayload 仅在非零时序列化进 payload
- 测试覆盖:多图、单/多混合、Cloudflare 524/JSON 504 重试识别,共 24 个用例全绿

### 已知遗留
- 应用图标尚用 Wails 默认(需替换 `build/windows/icon.ico`)
- 浅色主题、历史导入导出、Windows 安装包打包未实现
- 上游 gptcodex-image 是否真的接受 `mask` / `seed` / `negative_prompt` 字段尚未联网验证
