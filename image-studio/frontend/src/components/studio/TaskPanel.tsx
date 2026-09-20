import { CheckCircle2, Clock3, Film, Image, RefreshCw, Square, ArrowUpRight } from "lucide-react";
import { useState } from "react";
import { isActiveTask, type StudioTask } from "../../lib/studioDocuments";
import { cancelStudioTask, deliverVideoTask, refreshStudioTasks, resumeStudioTask, useStudioV2 } from "../../state/studioV2";
import { useStudioStore } from "../../state/studioStore";
const labels = { queued: "等待中", running: "进行中", succeeded: "已完成", failed: "失败", cancelled: "已停止", interrupted: "等待恢复" };
export function TaskPanel({ compact = false }: { compact?: boolean }) {
  const { tasks, available, taskError } = useStudioV2();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "video">("all");
  const visible = tasks.filter((task) => filter === "active" ? isActiveTask(task) : filter === "video" ? task.kind === "video" : true);
  async function act(task: StudioTask, action: "cancel" | "resume" | "deliver") {
    setError(""); setBusy(task.id);
    try {
      if (action === "cancel") await cancelStudioTask(task);
      else if (action === "resume") await resumeStudioTask(task);
      else deliverVideoTask(task, useStudioStore.getState().activeWorkspaceId);
    } catch (caught) { setError(String(caught instanceof Error ? caught.message : caught)); }
    finally { setBusy(null); }
  }
  return <section className={`studio-task-panel ${compact ? "is-compact" : "studio-page"}`} aria-label="任务中心">
    <div className="studio-section-heading"><div><span className="studio-eyebrow">GENERATION TASKS</span><h2>任务中心</h2></div>
      <button className="studio-icon-button" title="刷新任务" aria-label="刷新任务" onClick={() => void refreshStudioTasks()} disabled={!available}><RefreshCw size={18} /></button></div>
    <p className="studio-muted">切换页面不影响视频生成。退出后可用远端任务 ID 恢复查询，不会自动再次扣费创建。</p>
    <div className="studio-filter" aria-label="任务筛选">{([["all", "全部"], ["active", "进行中"], ["video", "视频"]] as const).map(([value, label]) => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div>
    {(error || taskError) && <p role="alert" className="studio-error">{error || taskError}</p>}
    {!available && <div className="studio-empty"><Clock3 /><h3>在桌面应用中管理生成任务</h3><p>当前为浏览器预览，未连接本地任务后端。</p></div>}
    {available && !visible.length && <div className="studio-empty"><CheckCircle2 /><h3>还没有任务</h3><p>创建图片或视频后，状态与恢复入口会显示在这里。</p></div>}
    <div className="studio-task-list">{visible.slice(0, compact ? 4 : 200).map((task) => <article className="studio-task" key={task.id}>
      <span className="studio-task-icon">{task.kind === "video" ? <Film size={20} /> : <Image size={20} />}</span>
      <div className="studio-task-copy"><strong>{task.label || task.modelId || (task.kind === "video" ? "视频生成" : "图片生成")}</strong>
        <span>{task.stage || labels[task.status]} · {new Date(task.createdAt).toLocaleString("zh-CN", { hour12: false })}</span>
        {task.remoteId && <code>远端 ID：{task.remoteId}</code>}{task.error && <p className="studio-error">{task.error}</p>}</div>
      <span className={`studio-status status-${task.status}`}>{labels[task.status]}</span>
      <div className="studio-task-actions">
        {isActiveTask(task) ? <button disabled={busy === task.id} onClick={() => void act(task, "cancel")} title="停止本地处理；上游可能继续执行和计费"><Square size={13} />停止本地处理</button> : null}
        {task.kind === "video" && task.remoteId && !isActiveTask(task) && task.status !== "succeeded" ? <button disabled={busy === task.id} onClick={() => void act(task, "resume")}><RefreshCw size={13} />恢复查询</button> : null}
        {task.kind === "video" && task.status === "succeeded" && task.result?.mediaUrl ? <button disabled={busy === task.id} onClick={() => void act(task, "deliver")}><ArrowUpRight size={14} />加入当前画布</button> : null}
      </div>
    </article>)}</div>
    {!compact && visible.length > 200 && <p className="studio-muted">此处展示最近 200 项任务；持久化任务记录保存在本地。</p>}
  </section>;
}
