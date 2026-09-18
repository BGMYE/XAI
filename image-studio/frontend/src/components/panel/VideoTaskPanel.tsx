import { Film, LoaderCircle, RefreshCw, Square, ImagePlus } from "lucide-react";
import { useState } from "react";
import { hasServiceMethod } from "../../platform/runtime/hostBindings";
import { useStudioStore } from "../../state/studioStore";
import { refreshStudioTasks, studioService, useStudioV2, type StudioTask } from "../../state/studioV2Runtime";

const labels: Record<StudioTask["status"], string> = { queued: "排队中", running: "处理中", succeeded: "已保存", failed: "失败", cancelled: "本地已停止", interrupted: "等待恢复" };
export function VideoTaskPanel() {
  const { activeProfileId, activeWorkspaceId, profiles, apiKey, sources, selectSourceImage, openSettings } = useStudioStore();
  const { tasks, taskError } = useStudioV2();
  const profile = profiles.find((p) => p.id === activeProfileId);
  const [prompt, setPrompt] = useState("");
  const [provider, setProvider] = useState("openai-compatible");
  const [seconds, setSeconds] = useState(4);
  const [size, setSize] = useState("1280x720");
  const [ratio, setRatio] = useState("16:9");
  const [resolution, setResolution] = useState("720p");
  const [referencePath, setReferencePath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const available = hasServiceMethod("SubmitVideoTask");
  const workspaceTasks = tasks.filter((t) => t.kind === "video" && t.workspaceId === activeWorkspaceId);
  const options = () => ({ baseURL: profile?.baseURL ?? "", apiKey, profileId: activeProfileId, workspaceId: activeWorkspaceId,
    provider, videoModelID: profile?.videoModelID?.trim() ?? "", prompt, seconds, size, aspectRatio: ratio, resolution, referencePath });
  async function act(action: () => Promise<unknown>) {
    if (busy) return; setBusy(true); setError("");
    try { await action(); await refreshStudioTasks(); } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  async function create() {
    if (!prompt.trim() || !profile?.videoModelID?.trim()) { setError("请输入提示词，并在上游配置中填写独立的视频模型 ID。"); return; }
    await studioService("SubmitVideoTask", { ...options(), requestedJobId: crypto.randomUUID() });
  }
  return <section className="video-generation-panel platform-card" aria-label="视频任务工作台">
    <div className="video-generation-heading"><span className="video-generation-icon"><Film size={20} /></span><div><h3>让灵感，动起来</h3><p>{profile?.videoModelID || "请先配置视频模型"} · API Key 由当前上游配置提供</p></div><button className="xai-link" onClick={openSettings}>上游配置</button></div>
    {!available && <p className="xai-video-note">浏览器预览不发送视频请求。请在本分支构建的桌面应用中配置上游并生成。</p>}
    <textarea aria-label="视频提示词" value={prompt} maxLength={8000} onChange={(e) => setPrompt(e.target.value)} placeholder="描述场景、镜头运动、人物动作、光线与节奏…" />
    <div className="xai-video-fields">
      <label>接口协议<select value={provider} onChange={(e) => { setProvider(e.target.value); if (e.target.value === "xai") setSeconds((s) => Math.min(15, s)); }}><option value="openai-compatible">兼容 Videos API · multipart</option><option value="xai">xAI 视频 API · JSON</option></select></label>
      <label>时长（秒）<input type="number" min={1} max={provider === "xai" ? 15 : 60} value={seconds} onChange={(e) => setSeconds(Math.max(1, Math.min(provider === "xai" ? 15 : 60, Math.floor(Number(e.target.value) || 1))))} /></label>
      {provider === "xai" ? <><label>画幅<select value={ratio} onChange={(e) => setRatio(e.target.value)}>{["16:9", "9:16", "1:1", "4:3", "3:4", "3:2", "2:3"].map((r) => <option key={r}>{r}</option>)}</select></label><label>分辨率<select value={resolution} onChange={(e) => setResolution(e.target.value)}>{["480p", "720p", "1080p"].map((r) => <option key={r}>{r}</option>)}</select></label></> : <label>尺寸<input value={size} onChange={(e) => setSize(e.target.value)} placeholder="1280x720" /></label>}
      <label>参考图（可选）<select value={referencePath} onChange={(e) => setReferencePath(e.target.value)}><option value="">不使用参考图</option>{sources.map((s) => <option value={s.path} key={s.path}>{s.name}</option>)}</select></label>
      <button className="xai-link" onClick={() => void selectSourceImage()}><ImagePlus size={16} />添加参考图</button>
    </div>
    <div className="xai-video-submit"><p>切换页面不打断任务。提交不会自动重试；具体时长、分辨率与参考图支持以所选上游为准。</p><button className="xai-generate" disabled={!available || busy || !prompt.trim() || !profile?.videoModelID?.trim()} onClick={() => void act(create)}>{busy ? <LoaderCircle className="spin" size={16} /> : <Film size={16} />}创建视频</button></div>
    {(error || taskError) && <p role="alert" className="xai-request-error">{error || taskError}</p>}
    <div className="xai-video-jobs" aria-live="polite">
      <h4>当前工作区的任务 <span>{workspaceTasks.length}</span></h4>
      {!workspaceTasks.length && <p className="xai-video-note">完成的视频会自动加入所属工作区的无限画布，并保存为本地文件。</p>}
      {workspaceTasks.slice(0, 30).map((task) => <article key={task.id} className="xai-video-job">
        <div><b>{task.label || "视频生成"}</b><small>{labels[task.status]} · {task.modelId} · {new Date(task.createdAt).toLocaleString()}</small><p>{task.error || task.stage}</p>{task.remoteId && <code>远端任务：{task.remoteId}</code>}</div>
        {task.status === "queued" || task.status === "running" ? <button disabled={busy} title="只停止本地处理；上游可能继续计费" onClick={() => void act(() => studioService("Cancel", task.id))}><Square size={14} />停止</button> : task.remoteId && task.status !== "succeeded" ? <button disabled={busy || task.profileId !== activeProfileId} title="仅恢复已有任务的查询，不重新生成；请使用原来的上游配置" onClick={() => void act(() => studioService("ResumeVideoTask", task.id, { ...options(), provider: task.provider, referencePath: "" }))}><RefreshCw size={14} />恢复查询</button> : null}
        {task.status === "succeeded" && task.result?.mediaUrl && <video src={task.result.mediaUrl} controls preload="metadata" aria-label={task.label || "生成的视频"} />}
      </article>)}
    </div>
  </section>;
}
