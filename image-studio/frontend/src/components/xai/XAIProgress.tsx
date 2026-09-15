import { Loader2 } from "lucide-react";
import type { ProgressInfo } from "../../types/domain";

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function XAIProgress({
  isRunning,
  progress,
  jobsCompleted,
  jobsTotal,
}: {
  isRunning: boolean;
  progress: ProgressInfo | null;
  jobsCompleted: number;
  jobsTotal: number;
}) {
  if (!isRunning) return null;

  const total = Math.max(0, jobsTotal);
  const completed = total > 0 ? Math.min(total, Math.max(0, jobsCompleted)) : Math.max(0, jobsCompleted);
  const percent = total > 0 ? Math.round((completed / total) * 100) : null;
  const stage = progress?.stage?.trim() || "正在生成";
  const bytes = formatBytes(progress?.bytes ?? 0);
  const detail = [
    progress && Number.isFinite(progress.elapsed) ? `${progress.elapsed.toFixed(1)}s` : "",
    bytes,
  ].filter(Boolean).join(" · ");

  return (
    <div className="xai-generation-progress" role="status" aria-live="polite">
      <div className="xai-generation-progress-head">
        <span className="xai-generation-progress-stage"><Loader2 size={14} className="xai-generation-progress-spinner" />{stage}</span>
        <span className="xai-generation-progress-count">{percent === null ? "处理中" : `${percent}% · ${completed}/${total}`}</span>
      </div>
      <div
        className="xai-generation-progress-track"
        role="progressbar"
        aria-label="生图进度"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
      >
        <span className={percent === null || percent === 0 ? "indeterminate" : ""} style={{ width: percent === null || percent === 0 ? "28%" : `${percent}%` }} />
      </div>
      {detail && <small className="xai-generation-progress-detail">{detail}</small>}
    </div>
  );
}
