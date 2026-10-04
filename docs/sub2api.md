# sub2api 接入与部署验收

本文把接入路线落实为配置说明和待执行的部署检查。客户端继续使用 **Base URL + API Key**；不导入 ChatGPT Cookie 或上游 OAuth Token，也不冒充 Codex User-Agent。这里的请求示例不代表已经对任何用户实例执行过真实生图。

## 推荐起步配置

| 项目 | 设置 |
|---|---|
| 提供商预设 | sub2api；底层仍为 OpenAI 兼容协议 |
| Base URL | sub2api 的真实 API 根路径，例如 `https://gateway.example/v1` |
| API Key | sub2api 签发、分组允许图片生成的下游 Key |
| 图像接口 | 纯生图和编辑优先验证 Images；需要文本模型编排时验证 Responses |
| 图像模型 | 账号实际可用的精确 ID；不自动选择“最新”模型 |
| 输出参数 | 起步使用已确认支持的明确尺寸、质量和 PNG；不统一开启扩展参数 |
| 请求策略 | OpenAI 标准；仅在确认网关支持时启用扩展 |
| Responses 传输 | 先验证 HTTP SSE，再单独验证 WebSocket |
| 能力确认 | 根据真实结果手动确认；模型列表不证明生图权限 |

Responses 的顶层 `model` 是文本模型，`tools[].model` 是图像模型；两者分别填写。Key 只有 Images 权限时不应强行使用 Responses。更高 reasoning 不等于更高图像质量。

## 图片桥接策略 TIPS

XAI 已显式声明 hosted `image_generation` 和对应 `tool_choice`，专用 sub2api 账号推荐选 **「不注入 Hosted 工具」**：停止自动补工具，同时仍放行客户端已经声明的工具。不要选择「移除客户端图片工具」，否则适用的 Responses 请求可能失去图片工具。

「启用 Hosted 桥接」适合同时服务未声明图片工具的 Codex 客户端；没有已证明的 XAI 画质增益。「跟随渠道」依赖渠道或全局设置。这些开关控制注入/移除行为，并不是画质档位，也不等于独立 Images 接口的统一开关。

此结论来自路线文档分析的 sub2api 提交 `b8dece9000c68815a5b867ca5a1e6f236e173905`。实际部署版本、ForceCodexCLI、Responses Lite、模型映射与权限配置可能改变行为，应先核对。客户端不假定存在额外的能力探测 API。

## 能力记录

Profile 使用 `providerPreset` 和版本为 `1` 的 `capabilities`。按精确模型 ID 的 `modelRules[model].images` / `.responses` 分别记录质量、尺寸、格式、参考图上限、mask 和 input fidelity 支持；省略表示未知。接口层单独记录 Images 的 generate/edit/stream、Responses 的 imageTool/sse/websocket。

改变地址、密钥、模型、协议、接口、传输、请求策略、安全连接选项或预设会清除旧能力确认。清除密钥、复制或导入配置也不会继承已确认能力。保存配置和测试连接都不暗中提交收费图片；真实验证须由用户明确发起。

`input_fidelity` 是否可用必须按模型和路径判断。sub2api 的原生 Images、Images 内部转 Responses、直接 Responses 不能混为一谈；字段能转发不等于上游支持。相同限制也适用于 `n`、seed、negative_prompt、透明背景与超大尺寸。

## 手动请求样例

先在本机设置任务专用变量 `SUB2API_BASE_URL`、`SUB2API_API_KEY`，不要把 Key 写入仓库。Base URL 应包含真实 API 根路径。确认账号支持示例模型和参数后，创建 `images-request.json`：

```json
{
  "model": "gpt-image-2",
  "prompt": "一张产品摄影：白色陶瓷杯，浅灰背景，柔和自然光，杯上清晰印着中文“早安”。",
  "size": "1024x1024",
  "quality": "high",
  "output_format": "png",
  "stream": true,
  "partial_images": 1
}
```

显式执行一次生成（可能产生费用）：

```bash
curl --no-buffer --silent --show-error \
  --request POST "${SUB2API_BASE_URL%/}/images/generations" \
  --header "Authorization: Bearer ${SUB2API_API_KEY}" \
  --header "Content-Type: application/json" \
  --data-binary @images-request.json \
  --output images-response.sse
```

如需验证非流式路径，明确将 `stream` 改为 `false` 并移除 `partial_images`，另存 JSON 响应。收到预览后断流时先核对上游，不能把改参数重跑视作无成本的自动回退。

## 真实部署验收清单

每轮记录 XAI 提交、sub2api 版本/镜像、协议、精确模型 ID、脱敏的请求参数、结果数、耗时、request ID，以及上游实际返回的 usage。模型映射同时记录客户端 ID 和网关执行 ID；不记录完整 Key。

| 场景 | 验收标准 |
|---|---|
| Images JSON 与 SSE | 最终图片可解码，格式/尺寸正确，预览与成品区分 |
| Responses SSE | 文本模型和工具模型分离，实际调用图像工具并返回最终图 |
| Responses WebSocket | 单独验证生成、编辑、断连与重连；不能据握手成功宣布生图可用 |
| 2–3 张参考图 | 数量、顺序、内容一致；超过支持上限时报错，不静默丢图 |
| PNG mask | alpha 含义、尺寸和区域符合预期；不支持时明确拒绝 |
| PNG/JPEG/WebP | 内容、MIME、扩展名一致；保留原始成品 |
| 精确/辅助模式 | 中文文字、数量和编辑约束均记录实际请求，多次采样比较 |
| 多个最终结果 | completed-only 不漏图，重复事件不重复入库，每图成为独立资产 |
| partial 后断流 | 不记完整成功，不自动重发；保留可用诊断 |
| 401/403/429/5xx | 原因可查，不通过自动重复收费提交解决 |
| 连续编辑 | 以前一轮最终图为参考可恢复；不宣称已实现服务器会话续接 |
| 账号/地址/模型变更 | 旧能力确认失效；重新验证权限和映射 |

客户端、共享远程内核和 Worker 不叠加自动图片重发；Worker 透传流与可用 request ID，不自动切换提供商或改写尺寸。网关自身的行为仍需单独核对。

HTTP mock 和自动化测试只能证明对应客户端行为。未完成上表实测前，不把分支标为“已验证兼容你的 sub2api 部署”。网关与上游自身的重试、原生尺寸上限、`store=false` 会话亲和与计费仍需在部署侧核对。
