import { Lightbulb } from "lucide-react";
import type { Profile } from "./types";

/** Keep advice next to the choices; protocol selection is not a quality preset. */
export function ProtocolTips({ profile, id }: { profile: Profile; id: string }) {
  return (
    <aside id={id} className="studio-protocol-tips" aria-label="接口协议选择 TIPS">
      <strong><Lightbulb size={16} aria-hidden="true" /> TIPS · 接口怎么选？</strong>
      {profile.protocol === "xai" ? (
        <p>上游明确提供 xAI 原生接口时选择此项，例如：api.x.ai。图片按画面比例配置；视频使用 duration / resolution。使用 Grok 模型名并不意味着接口一定是 xAI 协议。</p>
      ) : (
        <>
          <p><b>OpenAI 兼容：</b>适用于 OpenAI 及提供相应接口的中转；<b>sub2api 选择此项</b>。按上游文档确认端点，模型名称不能代替协议说明。</p>
          <p><b>Images API：</b>直接生图、参考图编辑和蒙版编辑优先从此路径验证。<b>Responses API：</b>适合需要文本模型理解或图片工具编排的任务，账号必须允许调用 image_generation。</p>
          <p>两条路径的画质取决于实际图像模型、参数与素材，协议不是画质档位。模型列表可见不代表 Key 有生图权限，首次请用已确认的模型与尺寸主动生成一张验证。</p>
        </>
      )}
      {profile.providerPreset === "sub2api" && (
        <p><b>sub2api：</b>填写下游 API Key。专用账号建议选择「不注入 Hosted 工具」；XAI 会显式声明图片工具。不要选「移除客户端图片工具」，它可能破坏 Responses 生图；该开关不是画质设置，其作用范围也取决于网关的客户端识别。</p>
      )}
    </aside>
  );
}
