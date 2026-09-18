import { Film, ArrowRight, LoaderCircle, Settings2 } from "lucide-react";
import { useRef, useState } from "react";
import { usePlatform } from "../../platform/context";
import { useStudioStore } from "../../state/studioStore";
import { submitStudioVideo, useStudioV2 } from "../../state/studioV2";
import { newStudioTaskID } from "../../lib/studioDocuments";
import { TaskPanel } from "../studio/TaskPanel";
import { VideoGenerationPanel as LegacyVideoGenerationPanel } from "./LegacyVideoGenerationPanel";

export function VideoGenerationPanel() {
  const { isAndroid } = usePlatform();
  return isAndroid ? <LegacyVideoGenerationPanel /> : <DesktopVideoPanel />;
}
function DesktopVideoPanel() {
  const state = useStudioStore();
  const { available, ready, storage } = useStudioV2();
  const profile = state.profiles.find((entry) => entry.id === state.activeProfileId);
  const [prompt, setPrompt] = useState("");
  const [provider, setProvider] = useState<"openai-compatible" | "xai">("openai-compatible");
  const [seconds, setSeconds] = useState(4);
  const [size, setSize] = useState("1280x720");
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [resolution, setResolution] = useState("720p");
  const [reference, setReference] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  async function submit() {
    if (inFlight.current) return;
    setError("");
    if (!profile?.videoModelID?.trim()) { setError("请在上游配置中显式填写视频模型 ID，图像模型不会被用作视频模型。"); return; }
    if (!state.apiKey.trim() || !profile.baseURL.trim() || !prompt.trim()) { setError("请填写视频提示词，并配置 BASE_URL 与 API Key。"); return; }
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > (provider === "xai" ? 15 : 60)) { setError("请输入有效的视频时长。"); return; }
    inFlight.current = true; setSubmitting(true);
    try {
      await submitStudioVideo({ baseURL: profile.baseURL, apiKey: state.apiKey, profileId: profile.id,
        workspaceId: state.activeWorkspaceId, requestedJobId: newStudioTaskID(),
        provider, videoModelID: profile.videoModelID.trim(), prompt: prompt.trim(), seconds,
        ...(provider === "xai" ? { aspectRatio, resolution } : { size }), referencePath: reference || undefined });
      state.pushToast("视频任务已进入队列，完成后将自动放入提交时的画布。", "success");
    } catch (caught) { setError(String(caught instanceof Error ? caught.message : caught)); }
    finally { inFlight.current = false; setSubmitting(false); }
  }
  return <>
    <section className="video-generation-panel studio-video-panel" aria-label="API 视频生成">
      <div className="video-generation-heading"><span className="video-generation-icon"><Film size={22} /></span><div><h3>让灵感动起来</h3><p>API Key 视频生成 · 任务持久化 · 结果自动进入画布</p></div>
        <button className="studio-icon-button" aria-label="配置视频上游" onClick={() => state.openUpstreamConfig("app")}><Settings2 size={18} /></button></div>
      {profile?.baseURL && /^https:\/\/api\.openai\.com(?:\/|$)/i.test(profile.baseURL) && <p className="studio-error">OpenAI 官方 Sora API 已公告于 2026-09-24 停用。此处保留兼容协议，不保证上游服务持续可用；请核对服务商公告。</p>}
      <div className="studio-video-model">当前视频模型：<strong>{profile?.videoModelID?.trim() || "尚未配置"}</strong></div>
      <textarea className="video-generation-prompt" aria-label="视频提示词" maxLength={8000} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="描述镜头、主体动作、光线与节奏，例如：镜头缓缓推近，晨光穿过薄雾，湖面泛起微光…" />
      <div className="studio-video-fields">
        <label>接口协议<select aria-label="视频接口协议" value={provider} onChange={(event) => { setProvider(event.target.value as typeof provider); setSeconds(4); }}><option value="openai-compatible">OpenAI 兼容 · /videos</option><option value="xai">xAI · /videos/generations</option></select></label>
        <label>时长（秒）<input aria-label="视频时长" type="number" min={1} max={provider === "xai" ? 15 : 60} value={seconds} onChange={(event) => setSeconds(Number(event.target.value))} /></label>
        {provider === "xai" ? <><label>画面比例<select aria-label="视频画面比例" value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value)}>{["16:9", "9:16", "1:1", "4:3", "3:4", "3:2", "2:3"].map((ratio) => <option key={ratio}>{ratio}</option>)}</select></label><label>分辨率<select aria-label="视频分辨率" value={resolution} onChange={(event) => setResolution(event.target.value)}>{["480p", "720p", "1080p"].map((value) => <option key={value}>{value}</option>)}</select></label></> : <label>输出尺寸<input aria-label="视频输出尺寸" value={size} onChange={(event) => setSize(event.target.value)} placeholder="1280x720" /></label>}
        <label>参考首帧<select aria-label="视频参考首帧" value={reference} onChange={(event) => setReference(event.target.value)}><option value="">无 · 文生视频</option>{state.sources.map((source) => <option key={source.path} value={source.path}>{source.name}</option>)}</select></label>
      </div>
      <p className="studio-muted">参数和模型权限由上游决定。选择参考首帧后使用图生视频；停止本地任务不等于上游停止计费。</p>
      <div className="studio-video-bottom"><span className="studio-muted">{available ? "密钥不写入任务记录或画布" : "浏览器预览 · 视频提交需要桌面后端"}</span><button className="studio-primary" disabled={!available || !ready || storage === "error" || submitting || !prompt.trim()} onClick={() => void submit()}>{submitting ? <LoaderCircle className="studio-spinning" size={17} /> : <Film size={17} />}{submitting ? "正在提交" : "生成视频"}<ArrowRight size={17} /></button></div>
      {error && <p className="studio-error" role="alert">{error}</p>}
    </section>
    <TaskPanel compact />
  </>;
}
