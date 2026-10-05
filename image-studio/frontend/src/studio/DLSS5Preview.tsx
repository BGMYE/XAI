import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Loader2, Play, Square } from "lucide-react";
import { client, isDesktop, mediaURL } from "./client";
import { uid } from "./graph.mjs";
import { dlss5AspectRatio, validateDLSS5Clip, validateDLSS5Options } from "./DLSS5Options.mjs";
import type { Asset, DLSS5Options, DLSS5PreviewResult, DLSS5Probe, Job } from "./types";
export function DLSS5Preview({ options, jobs, assets, probe, onRefresh, report }: {
  options: DLSS5Options; jobs: Job[]; assets: Asset[]; probe: DLSS5Probe;
  onRefresh(): Promise<unknown>; report(error: unknown): void;
}) {
  const candidates = useMemo(() => jobs.flatMap(job => {
    if (job.request.kind !== "video" || job.state !== "succeeded") return [];
    const asset = assets.find(asset => asset.id === (job.dlss5?.sourceAssetId || job.resultAssetId) && asset.kind === "video" && !asset.deletedAt);
    return asset ? [{ job, asset }] : [];
  }), [jobs, assets]);
  const [selection, setSelection] = useState(""), [position, setPosition] = useState(0), [duration, setDuration] = useState(3),
    [pending, setPending] = useState(false), [exporting, setExporting] = useState(false),
    [result, setResult] = useState<DLSS5PreviewResult>(), [side, setSide] = useState<"original" | "enhanced">("enhanced"),
    [status, setStatus] = useState(""), [failedURL, setFailedURL] = useState(""), [autoPreview, setAutoPreview] = useState(false);
  const selected = candidates.find(candidate => candidate.job.id === selection) ?? candidates[0];
  const sourceID = selected?.asset.id;
  const context = JSON.stringify([sourceID, options, position, duration, probe]);
  const latestContext = useRef(context), current = useRef<{ token: number; id?: string }>(), counter = useRef(0),
    completedID = useRef<string>(), mounted = useRef(true), exportLock = useRef(false), video = useRef<HTMLVideoElement>(null), playhead = useRef(0);
  latestContext.current = context;
  const cancelCurrent = () => {
    const active = current.current;
    current.current = undefined;
    counter.current++;
    const ids = new Set([active?.id, completedID.current].filter((id): id is string => Boolean(id)));
    completedID.current = undefined;
    for (const id of ids) void client.cancelDLSS5Preview(id).catch(report);
    return Boolean(active);
  };
  useEffect(() => {
    cancelCurrent(); setPending(false); setResult(undefined); setStatus(""); setFailedURL(""); playhead.current = 0;
  }, [context]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; cancelCurrent(); };
  }, []);
  const error = validateDLSS5Options(options) || validateDLSS5Clip(position, duration);
  const desktop = isDesktop();
  const ready = desktop && probe.available && !validateDLSS5Options(options) && Boolean(sourceID);
  const assertReady = async () => {
    const validation = validateDLSS5Options(options);
    if (validation) throw Error(validation);
    if (!probe.available) throw Error(probe.reason || "内置引擎暂不可用，请重新检测。");
    if (options.flowBackend !== "off" && !probe.supportsFlow?.includes(options.flowBackend))
      throw Error(`本地引擎未确认支持 ${options.flowBackend} 处理方式，请关闭时间一致性或选择已支持的选项。`);
  };
  const start = async () => {
    if (!ready || current.current || exportLock.current || !sourceID) return;
    cancelCurrent();
    const token = ++counter.current, capturedContext = context, id = `preview-${uid()}`;
    current.current = { token }; setPending(true); setResult(undefined); setStatus("正在检查本地引擎…"); setFailedURL("");
    const live = () => mounted.current && current.current?.token === token && latestContext.current === capturedContext;
    try {
      const invalidClip = validateDLSS5Clip(position, duration); if (invalidClip) throw Error(invalidClip);
      await assertReady(); if (!live()) return;
      current.current = { token, id }; setStatus("正在本地处理短片，修改参数会取消本次预览。");
      const output = await client.previewDLSS5({ id, sourceAssetId: sourceID, options: structuredClone(options), positionSeconds: position, durationSeconds: duration });
      if (!live()) { void client.cancelDLSS5Preview(id).catch(report); return; }
      if (output.id !== id || !output.url.startsWith("/studio-dlss5-preview/") || !output.sourceUrl.startsWith("/studio-dlss5-preview/"))
        throw Error("预览返回了无效的本地文件地址，请重新生成预览。");
      completedID.current = output.id;
      playhead.current = 0; setResult(output); setSide("enhanced"); setStatus("短片预览已完成。切换前后画面会暂停在相同时间点。");
    } catch (cause) { if (live()) setStatus(`预览失败：${String(cause)}`); }
    finally { if (live()) { current.current = undefined; setPending(false); } }
  };
  const cancel = () => { setAutoPreview(false); if (cancelCurrent()) { setPending(false); setStatus("已取消预览；迟到的结果不会替换当前画面。"); } };
  const apply = async () => {
    if (!ready || !selected || current.current || exportLock.current) return;
    exportLock.current = true; setExporting(true); setStatus("正在检查导出配置…");
    const capturedContext = context, jobID = selected.job.id;
    try {
      await assertReady();
      if (!mounted.current || latestContext.current !== capturedContext) return;
      await client.applyDLSS5(jobID, structuredClone(options));
      await onRefresh();
      if (mounted.current) setStatus("已开始本地完整增强，请在创作动态中查看进度。原视频保持保留。" );
    } catch (cause) { if (mounted.current) { setStatus(`导出失败：${String(cause)}`); report(cause); } }
    finally { exportLock.current = false; if (mounted.current) setExporting(false); }
  };
  const switchSide = (next: "original" | "enhanced") => {
    if (video.current) { playhead.current = video.current.currentTime; video.current.pause(); }
    setSide(next); setFailedURL("");
  };
  const videoURL = result ? (side === "enhanced" ? result.url : result.sourceUrl) : (sourceID ? mediaURL(sourceID) : "");
  const activeEnhancement = selected?.job.dlss5?.state === "running" || selected?.job.dlss5?.state === "queued";
  const startLatest = useRef(start);
  startLatest.current = start;
  useEffect(() => {
    if (!autoPreview || !ready || error || activeEnhancement || exporting) return;
    // Debounce changes rather than queue a render for every slider event. The
    // existing context token cancels in-flight work and rejects late results.
    const timer = setTimeout(() => { void startLatest.current(); }, 1000);
    return () => clearTimeout(timer);
  }, [autoPreview, context, ready, Boolean(error), activeEnhancement, exporting]);
  return <section className="dlss5-preview" aria-label="DLSS5 视频预览与导出">
    <h4>用已有视频预览</h4>
    <label>生成的原视频<select value={selected?.job.id ?? ""} onChange={event => setSelection(event.target.value)} disabled={!candidates.length || exporting}>
      {!candidates.length && <option value="">视频生成完成后可选择</option>}
      {candidates.map(({ job, asset }) => <option key={job.id} value={job.id}>{asset.name} · {job.request.prompt.slice(0, 28)}</option>)}
    </select></label>
    {selected && <p className="dlss5-tip">始终使用这次生成的原片。{selected.asset.width && selected.asset.height ? `原片 ${selected.asset.width} × ${selected.asset.height} · ${dlss5AspectRatio(selected.asset.width, selected.asset.height)}` : "原片尺寸在处理前检测。"}</p>}
    <div className="dlss5-two-columns"><label>开始位置 · 秒<input type="number" min={0} step={0.1} value={Number.isFinite(position) ? position : ""} onChange={event => setPosition(event.target.valueAsNumber)} /></label>
      <label>预览时长 · 秒<input type="number" min={0.1} max={10} step={0.1} value={Number.isFinite(duration) ? duration : ""} onChange={event => setDuration(event.target.valueAsNumber)} /></label></div>
    <label className="dlss5-check"><input type="checkbox" aria-label="自动更新短片预览" checked={autoPreview} disabled={!ready} onChange={event => setAutoPreview(event.target.checked)} />停止调参后自动更新短片</label>
    <p className="dlss5-tip">开启后，停止调参 1 秒开始处理；完成后可播放对比。处理速度取决于显卡，不代表逐帧实时推理。</p>
    <div className="dlss5-actions"><button type="button" className="studio-secondary" disabled={!ready || Boolean(error) || pending || exporting} onClick={() => void start()}>{pending ? <Loader2 size={16} className="spin" /> : <Play size={16} />}生成短片预览</button>
      {pending && <button type="button" className="studio-secondary" onClick={cancel}><Square size={14} />取消预览</button>}</div>
    {error && <p className="dlss5-error">{error}</p>}
    {videoURL && <div className="dlss5-compare">
      {result ? <div className="dlss5-compare-tabs" role="group" aria-label="相同时间点前后对比">
        <button type="button" aria-pressed={side === "original"} onClick={() => switchSide("original")}>原片短片</button>
        <button type="button" aria-pressed={side === "enhanced"} onClick={() => switchSide("enhanced")}>增强短片</button>
      </div> : <p className="dlss5-tip">原视频 · 尚未生成当前参数的增强预览</p>}
      {failedURL === videoURL ? <p className="dlss5-error">本地视频暂不可用，请重新生成预览或检查原片文件。</p> : <video ref={video} src={videoURL} controls playsInline preload="metadata" onError={() => setFailedURL(videoURL)} onLoadedMetadata={() => {
        if (result && video.current) video.current.currentTime = Math.min(playhead.current, Number.isFinite(video.current.duration) ? video.current.duration : playhead.current);
      }} aria-label={result ? (side === "enhanced" ? "增强预览短片" : "原片预览短片") : "生成的原视频"} />}
      {result && <small>{result.width} × {result.height} · 仅为短片预览，尚未替换完整成片</small>}
    </div>}
    <p className="dlss5-preview-status" role="status">{status || (!desktop ? "浏览器不能调用本地引擎，参数仍可编辑。" : !probe.available ? "请先完成本地引擎检测，再预览或导出。" : "预览最多 10 秒，只在本地处理，不再次请求生成视频。")}</p>
    <button type="button" className="studio-secondary full" disabled={!ready || pending || exporting || activeEnhancement} onClick={() => void apply()}>{exporting ? <Loader2 size={16} className="spin" /> : <Download size={16} />}应用当前参数并导出完整视频</button>
    <p className="dlss5-tip">使用独立的导出分辨率。只对选中原视频重新增强，不重复付费生成；每次提交会固定当前参数。{activeEnhancement ? "该视频正在增强，请先完成或取消当前任务。" : ""}</p>
  </section>;
}
