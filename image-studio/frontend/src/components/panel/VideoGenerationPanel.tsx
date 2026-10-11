import { ExternalLink, Film, LoaderCircle, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CreateVideo, PollVideo } from "../../platform/runtime/host";
import { createCanvasNode } from "../../state/canvasNodes";
import { useStudioStore } from "../../state/studioStore";
import type { VideoResultLike } from "../../platform/runtime/hostTypes";
import { requireExplicitVideoModelID, videoPollingDecision, videoResultError, videoResultSource, cancellableDelay } from "../../lib/videoGeneration";

const POLL_INTERVAL_MS = 2_000;

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function VideoGenerationPanel() {
  const { activeProfileId, profiles, apiKey, addCanvasNodeToWorkspace, canvasNodes } = useStudioStore();
  const activeProfile = profiles.find((profile) => profile.id === activeProfileId) ?? null;
  const [prompt, setPrompt] = useState("");
  const [seconds, setSeconds] = useState(5);
  const [size, setSize] = useState("1280x720");
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [videoURL, setVideoURL] = useState("");
  const runRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  function cancelPolling() {
    runRef.current += 1;
    abortRef.current?.abort();
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    abortRef.current = null;
    timerRef.current = null;
    setRunning(false);
    setStatus("已停止本地轮询");
  }

  useEffect(() => () => {
    runRef.current += 1;
    abortRef.current?.abort();
    if (timerRef.current !== null) clearTimeout(timerRef.current);
  }, []);

  function addVideoToCanvas(workspaceId: string, url: string, label: string) {
    const targetWorkspace = useStudioStore.getState().workspaces.find((workspace) => workspace.id === workspaceId);
    const offset = (targetWorkspace?.canvasNodes?.length ?? canvasNodes.length) * 28;
    addCanvasNodeToWorkspace(workspaceId, createCanvasNode({
      id: `video-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: "video",
      src: url,
      label,
      x: 80 + offset,
      y: 80 + offset,
      width: 480,
      height: 300,
    }));
  }

  async function finishOrPoll(
    result: VideoResultLike,
    videoID: string,
    runID: number,
    workspaceId: string,
    credentials: { baseURL: string; apiKey: string },
  ): Promise<void> {
    if (runRef.current !== runID) return;
    const decision = videoPollingDecision(result.status);
    setStatus(result.status);
    if (decision.outcome === "completed") {
      const source = videoResultSource(result);
      if (!source) throw new Error("视频任务已完成，但上游未返回 URL 或 b64_json");
      setVideoURL(source);
      addVideoToCanvas(workspaceId, source, prompt.trim());
      setRunning(false);
      return;
    }
    if (decision.outcome === "failed" || decision.outcome === "cancelled") {
      throw new Error(videoResultError(result));
    }
    if (!videoID) throw new Error("视频创建响应缺少任务 ID");
    abortRef.current = new AbortController();
    await cancellableDelay(POLL_INTERVAL_MS, abortRef.current.signal);
    timerRef.current = null;
    if (runRef.current !== runID) return;
    const next = await PollVideo({
      baseURL: credentials.baseURL,
      apiKey: credentials.apiKey,
      videoID,
    });
    return finishOrPoll(next, videoID, runID, workspaceId, credentials);
  }

  async function submitVideo() {
    const runID = runRef.current + 1;
    runRef.current = runID;
    const workspaceId = useStudioStore.getState().activeWorkspaceId;
    setError("");
    setVideoURL("");
    setStatus("正在创建");
    try {
      if (!activeProfile) throw new Error("当前没有启用的上游配置");
      if (!activeProfile.baseURL.trim()) throw new Error("当前上游配置缺少 BASE_URL");
      if (!apiKey.trim()) throw new Error("当前上游配置缺少 API Key");
      if (!prompt.trim()) throw new Error("请输入视频 prompt");
      const videoModelID = requireExplicitVideoModelID(activeProfile);
      setRunning(true);
      const credentials = { baseURL: activeProfile.baseURL.trim(), apiKey: apiKey.trim() };
      const created = await CreateVideo({
        ...credentials,
        videoModelID,
        prompt: prompt.trim(),
        seconds,
        size: size.trim(),
      });
      await finishOrPoll(created, created.id, runID, workspaceId, credentials);
    } catch (caught) {
      if (runRef.current !== runID) return;
      setRunning(false);
      setError(errorText(caught));
    }
  }

  return (
    <section className="video-generation-panel platform-card" aria-label="外部视频生成">
      <div className="video-generation-heading">
        <span className="video-generation-icon"><Film className="h-4 w-4" /></span>
        <div>
          <h3>外部视频生成</h3>
          <p>{activeProfile?.videoModelID?.trim() ? `模型 ${activeProfile.videoModelID.trim()}` : "当前 profile 未配置视频模型"}</p>
        </div>
      </div>
      <textarea
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        placeholder="描述镜头、动作、光线和节奏…"
        disabled={running}
        className="focus-ring video-generation-prompt"
      />
      <div className="video-generation-options">
        <label>
          <span>秒数</span>
          <input type="number" min={1} max={60} value={seconds} disabled={running} onChange={(event) => setSeconds(Math.max(1, Math.floor(Number(event.target.value) || 1)))} />
        </label>
        <label>
          <span>尺寸</span>
          <input type="text" value={size} disabled={running} onChange={(event) => setSize(event.target.value)} placeholder="1280x720" />
        </label>
      </div>
      <div className="video-generation-actions">
        {running ? (
          <button type="button" className="video-generation-cancel" onClick={cancelPolling}>
            <Square className="h-3.5 w-3.5" /> 停止轮询
          </button>
        ) : (
          <button type="button" className="video-generation-submit" onClick={() => void submitVideo()}>
            <Film className="h-3.5 w-3.5" /> 创建视频
          </button>
        )}
        {running ? <span className="video-generation-status"><LoaderCircle className="h-3.5 w-3.5 animate-spin" /> {status}</span> : status ? <span className="video-generation-status">{status}</span> : null}
      </div>
      {error ? <div className="video-generation-error" role="alert">{error}</div> : null}
      {videoURL ? (
        <div className="video-generation-result">
          <video src={videoURL} controls preload="metadata" />
          <button type="button" onClick={() => window.open(videoURL, "_blank", "noopener,noreferrer")}>
            <ExternalLink className="h-3.5 w-3.5" /> 打开视频 URL
          </button>
        </div>
      ) : null}
    </section>
  );
}
