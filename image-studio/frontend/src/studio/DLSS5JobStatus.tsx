import { useRef, useState } from "react";
import { Loader2, RefreshCw, Square } from "lucide-react";
import { client, isDesktop } from "./client";
import type { Job } from "./types";
import "./DLSS5.css";
const states = { idle: "等待原视频", queued: "等待本地增强", running: "正在本地增强", succeeded: "增强完成", failed: "增强失败", cancelled: "增强已取消" };
export function DLSS5JobStatus({ job, onRefresh, report }: { job: Job; onRefresh(): Promise<unknown>; report(error: unknown): void }) {
  const [busy, setBusy] = useState(false), lock = useRef(false);
  const enhancement = job.dlss5;
  if (!enhancement) return null;
  const running = enhancement.state === "queued" || enhancement.state === "running";
  const action = async (cancel: boolean) => {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try { if (cancel) await client.cancelDLSS5(job.id); else await client.retryDLSS5(job.id); await onRefresh(); }
    catch (error) { report(error); }
    finally { lock.current = false; setBusy(false); }
  };
  const resolution = enhancement.options?.exportResolution || job.request.parameters.dlss5?.exportResolution;
  return <section className="dlss5-job" aria-label="DLSS5 增强状态">
    <div className="dlss5-job-heading"><strong>DLSS5 视频增强</strong><span role="status">{states[enhancement.state]}</span></div>
    {running && <><progress max={100} value={Math.max(0, Math.min(100, enhancement.progress || 0))} aria-label="本地视频增强进度" /><small>{enhancement.stage || "处理中"} · {Math.round(enhancement.progress || 0)}%</small></>}
    {enhancement.error && <p className="dlss5-error">{enhancement.error}</p>}
    <p className="dlss5-tip">本地处理，原视频保留。{resolution ? `本次导出：${resolution.mode === "source" ? "原视频尺寸" : `${resolution.width} × ${resolution.height}`}。` : ""}</p>
    <div className="dlss5-actions">
      {running && <button type="button" className="studio-secondary" disabled={busy || !isDesktop()} onClick={() => void action(true)}>{busy ? <Loader2 size={14} className="spin" /> : <Square size={14} />}取消增强</button>}
      {(enhancement.state === "failed" || enhancement.state === "cancelled") && <button type="button" className="studio-secondary" disabled={busy || !isDesktop()} onClick={() => void action(false)}>{busy ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}仅重试增强</button>}
    </div>
    {(enhancement.state === "failed" || enhancement.state === "cancelled") && <p className="dlss5-tip">重试使用本次固定参数，不再次生成视频；调整参数请在视频表单选择原视频后导出。</p>}
  </section>;
}
