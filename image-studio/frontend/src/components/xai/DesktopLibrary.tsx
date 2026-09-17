import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Columns2, Copy, Download, FolderOpen, ImagePlus, MoreHorizontal, RotateCw, Search } from "lucide-react";
import { useStudioStore } from "../../state/studioStore";
import type { HistoryItem, Mode } from "../../types/domain";
import { historyFullSrc, historyPreviewSrc, useBlobURL } from "../../lib/images";
import { historyDayKey, isHistoryInDateFilter, matchesHistorySearch, type TimelineHistoryDateFilter } from "../history/historyFilters";
import { qualityLabel, sizeLabel } from "../history/historyLabels";
import { useHistoryContextMenu } from "../history/useHistoryContextMenu";
import { ContextMenu, type MenuItem } from "../common/ContextMenu";
import { Modal } from "../common/Modal";
import { BeginNativeFileDrag, OpenOutputDir, ReadTextFile, getHostCapabilities } from "../../platform/runtime/host";
import { usePlatform } from "../../platform/context";
import { saveHistoryItemAs } from "../../lib/saveResultImage";
import { buildHistoryItemDragExport, shouldUseNativeFileDrag, writeImageFileDragData, writeInternalHistoryItemDragData } from "../../lib/dragExport.ts";
import { EmptyState, IconButton, StudioButton } from "./DesktopPrimitives";

export function DesktopResultCard({ item, selected, onOpen, onMenu }: { item: HistoryItem; selected?: boolean; onOpen: () => void; onMenu: (x: number, y: number) => void }) {
  const preview = useBlobURL(item.previewBlob ?? item.imageBlob, item.imageB64);
  return <article className={`studio-result-card${selected ? " selected" : ""}`} onContextMenu={(event) => { event.preventDefault(); onMenu(event.clientX, event.clientY); }}>
    <button type="button" className="studio-result-image" onClick={onOpen} aria-pressed={selected} aria-label={`查看作品：${item.prompt || "未命名作品"}`}>
      <img src={historyPreviewSrc(item, preview)} alt={item.prompt || "生成作品"} loading="lazy" />
    </button>
    <div className="studio-result-meta"><div><strong>{item.prompt || "未命名作品"}</strong><small>{sizeLabel(item.size)} · {item.mode === "edit" ? "图像编辑" : "图像生成"}</small></div>
      <IconButton label="作品操作" className="quiet" onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); onMenu(rect.right, rect.bottom); }}><MoreHorizontal /></IconButton>
    </div>
  </article>;
}

export function DeleteResultDialog({ item, onClose }: { item: HistoryItem | null; onClose: () => void }) {
  const { deleteHistoryItem, pushToast, resultDetail, closeResultDetail } = useStudioStore();
  const [pending, setPending] = useState(false);
  const remove = async () => {
    if (!item) return;
    setPending(true);
    try {
      await deleteHistoryItem(item.id);
      if (resultDetail?.id === item.id) closeResultDetail();
      onClose();
    } catch { pushToast("无法删除作品，请重试", "error"); }
    finally { setPending(false); }
  };
  return <Modal open={!!item} onClose={() => { if (!pending) onClose(); }} title="删除作品" width={440}>
    <p>删除后将无法从作品列表恢复此记录。</p>
    <div className="studio-detail-actions"><StudioButton disabled={pending} onClick={onClose}>取消</StudioButton><StudioButton className="danger" disabled={pending} onClick={() => void remove()}>{pending ? "正在删除…" : "删除作品"}</StudioButton></div>
  </Modal>;
}

export function DesktopLibrary({ onCreate }: { onCreate: () => void }) {
  const { history, historyHasMore, historyLoading, loadMoreHistory, openResultDetail, resultDetail, currentImage, compareB, setCompareB, applyHistoryParams, regenerateFromHistory, reuseAsSource, pushToast } = useStudioStore();
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"all" | Mode>("all");
  const [date, setDate] = useState<TimelineHistoryDateFilter>("all");
  const [pickedDate, setPickedDate] = useState("");
  const [deleting, setDeleting] = useState<HistoryItem | null>(null);
  const { menu, openMenu, closeMenu, buildMenu } = useHistoryContextMenu({
    currentImageId: currentImage?.id ?? null, compareItemId: compareB?.id ?? null,
    onOpenDetail: openResultDetail, onApplyParams: applyHistoryParams,
    onOpenRaw: openResultDetail,
    onRegenerate: (item) => void regenerateFromHistory(item), onReuseAsSource: (item) => void reuseAsSource(item),
    onToggleCompare: (item) => { setCompareB(compareB?.id === item.id ? null : item); onCreate(); },
    onDelete: setDeleting, pushToast,
  });
  const groups = useMemo(() => {
    const map = new Map<string, HistoryItem[]>();
    for (const item of history) {
      if (mode !== "all" && mode !== item.mode) continue;
      if (!isHistoryInDateFilter(item.createdAt, date, pickedDate) || !matchesHistorySearch(item, query)) continue;
      const day = historyDayKey(item.createdAt);
      const list = map.get(day) ?? [];
      list.push(item);
      map.set(day, list);
    }
    return [...map.entries()];
  }, [history, mode, date, pickedDate, query]);

  return <div className="studio-page">
    <header className="studio-page-header"><div><h1>作品</h1><p>{history.length} 张作品{historyHasMore ? " · 可继续加载" : ""}</p></div><StudioButton onClick={onCreate}><ImagePlus />开始创作</StudioButton></header>
    <div className="studio-library-filters">
      <label className="studio-search"><Search size={18} aria-hidden="true" /><input type="search" aria-label="搜索作品" placeholder="搜索提示词" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <select aria-label="作品类型" value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}><option value="all">全部类型</option><option value="generate">图像生成</option><option value="edit">图像编辑</option></select>
      <select aria-label="作品日期" value={date} onChange={(event) => setDate(event.target.value as TimelineHistoryDateFilter)}><option value="all">全部日期</option><option value="today">今天</option><option value="week">最近 7 天</option><option value="pick">指定日期</option></select>
      {date === "pick" && <input type="date" aria-label="选择日期" value={pickedDate} onChange={(event) => setPickedDate(event.target.value)} />}
    </div>
    {groups.length ? groups.map(([day, items]) => <section className="studio-library-day" key={day}><h2>{day}</h2><div className="studio-result-grid">{items.map((item) => <DesktopResultCard key={item.id} item={item} selected={resultDetail?.id === item.id} onOpen={() => void openResultDetail(item)} onMenu={(x, y) => openMenu(item, x, y)} />)}</div></section>) : <EmptyState title={history.length ? "没有匹配的作品" : "还没有作品"}>{history.length ? "试试其他提示词或日期。" : "从一句提示词或一张参考图开始。"}</EmptyState>}
    {historyHasMore && <div className="studio-load-more"><StudioButton disabled={historyLoading} onClick={() => void loadMoreHistory()}>{historyLoading ? "正在加载…" : "加载更多作品"}</StudioButton></div>}
    {menu && <ContextMenu x={menu.x} y={menu.y} items={buildMenu(menu.item)} onClose={closeMenu} />}
    <DeleteResultDialog item={deleting} onClose={() => setDeleting(null)} />
  </div>;
}

export function DesktopResultDetail({ item, onClose, onCanvas }: { item: HistoryItem; onClose: () => void; onCanvas: () => void }) {
  const { pushToast, setField, regenerateFromHistory, reuseAsSource, selectBatchResult, upscaleCurrent, upscaleRunning, upscaleProgress, currentImage, compareB, setCompareB } = useStudioStore();
  const blob = useBlobURL(item.imageBlob ?? item.previewBlob, item.imageB64);
  const { targetPlatform } = usePlatform();
  const image = historyFullSrc(item, blob) || historyPreviewSrc(item, blob);
  const dragSpec = buildHistoryItemDragExport(item);
  const [more, setMore] = useState<{ x: number; y: number } | null>(null);
  const copy = async (value: string) => { try { await navigator.clipboard.writeText(value); pushToast("已复制", "success"); } catch { pushToast("无法复制，请重试", "error"); } };
  const apply = async () => { await reuseAsSource(item); if (!useStudioStore.getState().errorMessage) { onClose(); onCanvas(); } };
  const save = async () => { try { const path = await saveHistoryItemAs(item); if (path) pushToast("作品已保存", "success"); } catch { pushToast("无法保存作品，请重试", "error"); } };
  const extraActions: MenuItem[] = [
    { label: "打开保存位置", onClick: () => { void OpenOutputDir().catch(() => pushToast("无法打开保存位置", "error")); }, disabled: !item.savedPath },
    { label: "复制文件路径", onClick: () => void copy(item.savedPath || ""), disabled: !item.savedPath },
    ...([2, 4] as const).map((scale) => ({ label: `本地 CPU 放大 ${scale}×`, disabled: upscaleRunning || !item.savedPath || !getHostCapabilities().localUpscale, onClick: () => { void (async () => { await selectBatchResult(item); await upscaleCurrent(scale); })(); } })),
  ];
  return <div className="studio-page">
    <header className="studio-page-header"><div className="studio-secondary-actions"><StudioButton className="quiet" onClick={onClose}><ArrowLeft />返回</StudioButton><h1>作品详情</h1></div><IconButton label="更多作品操作" onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setMore({ x: rect.right, y: rect.bottom }); }}><MoreHorizontal /></IconButton></header>
    <div className="studio-detail-layout"><div>
      <div className="studio-detail-preview" draggable={!!dragSpec} title={dragSpec ? "拖到文件夹以复制原图" : undefined} onDragStart={(event) => {
        if (!dragSpec) { event.preventDefault(); return; }
        if (shouldUseNativeFileDrag(targetPlatform, item.savedPath)) { event.preventDefault(); void BeginNativeFileDrag(item.savedPath).catch(() => pushToast("无法拖出图片", "error")); return; }
        event.dataTransfer.effectAllowed = "copy"; writeInternalHistoryItemDragData(event.dataTransfer, item); writeImageFileDragData(event.dataTransfer, dragSpec);
      }}><img src={image} alt={item.prompt || "生成作品"} draggable={false} /></div>
      <div className="studio-detail-actions"><StudioButton primary onClick={() => void save()}><Download />另存为</StudioButton><StudioButton onClick={() => void apply()}><ImagePlus />用作参考图</StudioButton><StudioButton onClick={() => void regenerateFromHistory(item)}><RotateCw />重新生成</StudioButton></div>
      <div className="studio-detail-actions"><StudioButton disabled={!currentImage || currentImage.id === item.id} aria-pressed={compareB?.id === item.id} onClick={() => { setCompareB(compareB?.id === item.id ? null : item); onClose(); onCanvas(); }}><Columns2 />{compareB?.id === item.id ? "取消对比" : "与当前画布对比"}</StudioButton></div>
      {upscaleRunning && <p role="status">正在放大图片：{upscaleProgress}%</p>}
    </div><div>
      <section className="studio-detail-section"><h2>提示词</h2><p>{item.prompt || "未填写提示词"}</p>{item.prompt && <div className="studio-detail-actions"><StudioButton onClick={() => void copy(item.prompt)}><Copy />复制</StudioButton><StudioButton onClick={() => { setField("prompt", item.prompt); onClose(); onCanvas(); }}><ArrowRight />应用提示词</StudioButton></div>}</section>
      {item.revisedPrompt && <section className="studio-detail-section"><h2>调整后的提示词</h2><p>{item.revisedPrompt}</p><StudioButton onClick={() => void copy(item.revisedPrompt!)}><Copy />复制</StudioButton></section>}
      {item.negativePrompt && <section className="studio-detail-section"><h2>负向提示词</h2><p>{item.negativePrompt}</p></section>}
      <section className="studio-detail-section"><h2>图像信息</h2><dl className="studio-detail-metadata"><dt>尺寸</dt><dd>{sizeLabel(item.size)}</dd><dt>生成质量</dt><dd>{qualityLabel(item.quality)}</dd><dt>格式</dt><dd>{item.outputFormat?.toUpperCase() || "—"}</dd><dt>模式</dt><dd>{item.mode === "edit" ? "图像编辑" : "图像生成"}</dd><dt>创建时间</dt><dd>{new Date(item.createdAt).toLocaleString()}</dd>{typeof item.elapsedSec === "number" && <><dt>生成耗时</dt><dd>{item.elapsedSec.toFixed(1)} 秒</dd></>}{!!item.seed && <><dt>随机种子</dt><dd>{item.seed}</dd></>}{item.background && <><dt>背景</dt><dd>{item.background === "transparent" ? "透明" : item.background === "opaque" ? "不透明" : "自动"}</dd></>}{item.inputFidelity && <><dt>参考图保真</dt><dd>{item.inputFidelity === "high" ? "高" : item.inputFidelity === "low" ? "低" : "自动"}</dd></>}</dl></section>
      {item.savedPath && <section className="studio-detail-section"><h2>文件位置</h2><p className="studio-detail-path">{item.savedPath}</p><StudioButton onClick={() => void OpenOutputDir().catch(() => pushToast("无法打开保存位置", "error"))}><FolderOpen />打开保存位置</StudioButton></section>}
      <ResultDiagnostics key={item.id} item={item} />
    </div></div>
    {more && <ContextMenu {...more} items={extraActions} onClose={() => setMore(null)} />}
  </div>;
}

function ResultDiagnostics({ item }: { item: HistoryItem }) {
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!open || !item.rawPath) return;
    let active = true;
    setRaw(null); setError(false);
    void ReadTextFile(item.rawPath).then((text) => {
      if (active) setRaw(text.length > 200_000 ? `${text.slice(0, 200_000)}\n\n…响应过长，已截断预览。` : text);
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [open, item.rawPath]);
  return <details className="studio-diagnostics" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>诊断信息</summary>
    <dl className="studio-detail-metadata"><dt>记录 ID</dt><dd>{item.id}</dd>{item.imageId && <><dt>图像 ID</dt><dd>{item.imageId}</dd></>}{item.parentId && <><dt>来源记录</dt><dd>{item.parentId}</dd></>}{item.outputCompression !== undefined && <><dt>输出压缩</dt><dd>{item.outputCompression}%</dd></>}{item.moderation && <><dt>内容审核</dt><dd>{item.moderation}</dd></>}{item.imageStyle && <><dt>生成风格</dt><dd>{item.imageStyle}</dd></>}{item.upscaleAcceleration && <><dt>放大方式</dt><dd>{item.upscaleAcceleration} · {item.upscaleScale}×</dd></>}</dl>
    {item.sourcePaths?.length ? <><h3>参考图路径</h3><p className="studio-detail-path">{item.sourcePaths.join("\n")}</p></> : null}
    <h3>原始上游响应</h3>
    {item.rawPath ? <><p className="studio-detail-path">{item.rawPath}</p>{error ? <p role="alert">无法读取原始响应。</p> : raw === null ? <p role="status">正在读取…</p> : <pre tabIndex={0} aria-label="原始上游响应">{raw}</pre>}</> : <p>这张作品未保留原始响应。</p>}
  </details>;
}
