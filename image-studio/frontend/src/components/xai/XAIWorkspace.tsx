import { useEffect, useRef, useState } from "react";
import {
  ChevronDown, ChevronRight, CircleHelp, Film, FolderOpen,
  Gauge, Image as ImageIcon, MoreHorizontal, Plus, Settings, Sparkles,
  SlidersHorizontal, Sparkles as Stars, Wand2, X,
} from "lucide-react";
import { useStudioStore } from "../../state/studioStore";
import { VideoTaskPanel as VideoGenerationPanel } from "../panel/VideoTaskPanel";
import { XAIShell, type WorkspaceView } from "./XAIShell";
import { XAIProPanels } from "./XAIProPanels";
import { handleWindowTitleBarDoubleClick, XAIWindowControls } from "./XAIWindowControls";
import { availableQualityOptions, normalizeQualitySelection } from "../panel/panelOptions";
import { buildAspectSizeSelection, deriveAspectPreset, deriveResolutionPreset, listAspectPresetOptions, normalizeSizeSelection, type AspectPreset } from "../panel/sizeCapabilities";
import { historyPreviewSrc, useBlobURL } from "../../lib/images";
import type { HistoryItem, SourceImage } from "../../types/domain";
import { XAIProgress } from "./XAIProgress";
import "./xai-theme.css";
import "../../styles/_xai-typography.css";

type StudioView = "simple" | "pro";
type MediaTab = "image" | "video";

function ModeSwitch({ view, setView }: { view: StudioView; setView: (v: StudioView) => void }) {
  return <div className="xai-mode-switch no-drag" role="tablist">
    <button className={view === "simple" ? "active" : ""} onClick={() => setView("simple")}>简洁模式</button>
    <button className={view === "pro" ? "active" : ""} onClick={() => setView("pro")}>专业模式</button>
  </div>;
}
function SideNav({ active = "创作", onCreate, onHistory, onSettings, onHint }: { active?: string; onCreate?: () => void; onHistory?: () => void; onSettings?: () => void; onHint?: (label: string) => void }) {
  const items = [[Wand2, "创作"], [FolderOpen, "作品"], [Stars, "灵感"], [CircleHelp, "社区"]] as const;
  const handle = (label: string) => label === "创作" ? onCreate?.() : label === "作品" ? onHistory?.() : onHint?.(label);
  return <aside className="xai-side-nav">{items.map(([Icon, label]) => <button key={label} className={active === label ? "active" : ""} onClick={() => handle(label)}><Icon size={18} /><span>{label}</span></button>)}<div className="xai-nav-spacer" /><button onClick={onSettings}><Settings size={18} /><span>设置</span></button></aside>;
}
function ImageDropzone({ sources, onAdd, onRemove }: { sources: SourceImage[]; onAdd: () => void; onRemove: (index: number) => void }) {
  return <div className="xai-reference">
    <div className="xai-section-label"><span>上传参考图</span><small>（可选）</small></div>
    <div className="xai-reference-row"><button className="xai-upload" onClick={onAdd}><Plus size={22} /><span>添加图片</span></button>{sources.map((source, i) => <ReferenceThumbnail source={source} index={i} key={`${source.path}-${i}`} onRemove={() => onRemove(i)} />)}</div>
  </div>;
}
function ReferenceThumbnail({ source, index, onRemove }: { source: SourceImage; index: number; onRemove: () => void }) {
  const blobURL = useBlobURL(source.imageBlob, source.imageB64);
  return <div className="xai-thumb"><img src={source.previewUrl || blobURL || ""} alt={source.name || "参考图"} /><button onClick={onRemove} aria-label={`删除参考图 ${index + 1}`}><X size={12} /></button></div>;
}
function AspectRatioPicker({ value, options, onChange }: { value: AspectPreset; options: ReturnType<typeof listAspectPresetOptions>; onChange: (value: AspectPreset) => void; }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];
  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [open]);
  if (!selected) return null;
  return <div className={`xai-select xai-aspect-picker${open ? " is-open" : ""}`} ref={rootRef} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <span aria-hidden="true">▣</span>
    <button type="button" className="xai-aspect-trigger" aria-haspopup="listbox" aria-expanded={open} aria-label="图像比例" onClick={() => setOpen((current) => !current)} onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); if (event.key === "ArrowDown" && !open) { event.preventDefault(); setOpen(true); } }}>{selected.label}</button>
    <ChevronDown size={14} aria-hidden="true" />
    {open && <div className="xai-aspect-menu" role="listbox" aria-label="可选图像比例">{options.map((option) => <button type="button" role="option" aria-selected={option.value === value} className={`xai-aspect-option${option.value === value ? " active" : ""}`} key={option.value} onClick={() => { onChange(option.value); setOpen(false); }}><span className={`xai-aspect-shape${option.auto ? " auto" : ""}`} style={{ aspectRatio: `${option.w} / ${option.h}` }} aria-hidden="true" /><span>{option.label}</span></button>)}</div>}
  </div>;
}
function ResultCard({ item, onDetail, onRegenerate, onDelete }: { item: HistoryItem; onDetail: () => void; onRegenerate: () => void; onDelete: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const blobURL = useBlobURL(item.previewBlob ?? item.imageBlob, item.imageB64);
  const title = item.prompt?.slice(0, 20) || "生成结果";
  return <article className="xai-result-card" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setMenuOpen(false); }} onKeyDown={(event) => { if (event.key === "Escape") setMenuOpen(false); }}>
    <button className="xai-result-image" onClick={onDetail} aria-label={`查看结果：${title}`}><img src={historyPreviewSrc(item, blobURL)} alt={title} /></button>
    <div className="xai-result-meta"><div><b>{title}</b><small>{item.size === "auto" ? "自适应尺寸" : item.size.replace("x", " × ")}</small></div><div className="xai-result-actions"><button onClick={() => setMenuOpen((open) => !open)} aria-label="结果操作" aria-expanded={menuOpen}><MoreHorizontal size={16} /></button>{menuOpen && <div className="xai-result-menu"><button onClick={() => { setMenuOpen(false); onDetail(); }}>查看详情</button><button onClick={() => { setMenuOpen(false); onRegenerate(); }}>重新生成</button><button onClick={() => { setMenuOpen(false); onDelete(); }}>删除</button></div>}</div></div>
  </article>;
}
function SimpleWorkspace({ tab, setTab, setView }: { tab: MediaTab; setTab: (t: MediaTab) => void; setView: (v: StudioView) => void }) {
  const {
    prompt, setField, submit, isRunning, jobsCompleted, jobsTotal, progress, sources, selectSourceImage, removeSource, history,
    imageModelID, profiles, activeProfileId, setActiveProfile, size, batchCount, quality,
    outputFormat, background, seed, apiMode, requestPolicy, customAspectRatios, errorMessage,
    openHistoryTimeline, closeHistoryTimeline, openSettings, openResultDetail,
    regenerateFromHistory, deleteHistoryItem, pushToast, apiKey, baseURL,
  } = useStudioStore();
  const [filter, setFilter] = useState("全部");
  const [parametersOpen, setParametersOpen] = useState(false);
  const capabilityInput = { apiMode, requestPolicy, imageModelID };
  const aspectOptions = listAspectPresetOptions(capabilityInput, customAspectRatios);
  const aspect = deriveAspectPreset(normalizeSizeSelection(size, capabilityInput, customAspectRatios), customAspectRatios);
  const qualityOptions = availableQualityOptions(imageModelID);
  const cards = filter === "视频" ? [] : history.slice(0, 4);
  const handleNavHint = (label: string) => pushToast(`${label}功能尚未开放，可继续使用创作与作品历史`, "info");
  const returnToCreate = () => { closeHistoryTimeline(); setTab("image"); setView("simple"); };
  return <div className="xai-window simple-window">
    <div className="xai-window-bar drag-region" onDoubleClick={(event) => handleWindowTitleBarDoubleClick(event, () => pushToast("窗口控制请在桌面应用中使用。", "info"))}><XAIWindowControls onUnavailable={() => pushToast("窗口控制请在桌面应用中使用。", "info")} /><span className="xai-window-title">XAI</span><ModeSwitch view="simple" setView={setView} /><div className="xai-connected"><i />{apiKey && baseURL ? "已配置上游" : "待配置上游"}</div></div>
    <div className="xai-window-body"><SideNav onCreate={returnToCreate} onHistory={openHistoryTimeline} onSettings={openSettings} onHint={handleNavHint} /><main className="xai-simple-main">
      <div className="xai-media-tabs"><button className={tab === "image" ? "active" : ""} onClick={() => setTab("image")}><ImageIcon size={17} />图片</button><button className={tab === "video" ? "active" : ""} onClick={() => setTab("video")}><Film size={17} />视频</button></div>
      {tab === "video" ? <VideoGenerationPanel /> : <section className="xai-compose-card">
        <ImageDropzone sources={sources} onAdd={() => void selectSourceImage()} onRemove={removeSource} />
        <textarea value={prompt} onChange={(e) => setField("prompt", e.target.value)} placeholder="描述你想要创作的内容…" maxLength={2000} aria-label="创作提示词" />
        <div className="xai-count">{prompt.length}/2000</div>
        <div className="xai-compose-footer">
          <label className="xai-select"><Gauge size={15} /><select value={activeProfileId} onChange={(e) => void setActiveProfile(e.target.value)} aria-label="图像模型">
            {!profiles.length && <option value="">{imageModelID.trim() || "选择模型"}</option>}
            {profiles.map((profile) => { const configuredModel = profile.imageModelID.trim() || (profile.id === activeProfileId ? imageModelID.trim() : ""); return <option key={profile.id} value={profile.id}>{configuredModel ? `${configuredModel} · ${profile.name}` : profile.name}</option>; })}
          </select><ChevronDown size={14} /></label>
          <AspectRatioPicker value={aspect} options={aspectOptions} onChange={(nextAspect) => setField("size", buildAspectSizeSelection(nextAspect, deriveResolutionPreset(size), capabilityInput, customAspectRatios))} />
          <label className="xai-select"><span>⌘</span><select value={batchCount} onChange={(e) => setField("batchCount", Number(e.target.value))} aria-label="生成张数">{Array.from(new Set([1, 2, 3, 4, batchCount])).sort((a, b) => a - b).map((count) => <option key={count} value={count}>{count}张</option>)}</select><ChevronDown size={14} /></label>
          <button className="xai-round" onClick={() => setParametersOpen((open) => !open)} title="生成参数" aria-label="生成参数" aria-expanded={parametersOpen}><SlidersHorizontal size={16} /></button>
          <button className="xai-generate" disabled={isRunning || !prompt.trim()} onClick={() => void submit()}><Sparkles size={17} />{isRunning ? "生成中…" : "生成"}</button>
        </div>
        <XAIProgress isRunning={isRunning} progress={progress} jobsCompleted={jobsCompleted} jobsTotal={jobsTotal} />
        {parametersOpen && <div className="xai-parameters">
          <label>生成质量<select value={normalizeQualitySelection(quality, imageModelID)} onChange={(e) => setField("quality", e.target.value as typeof quality)}>{qualityOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label>输出格式<select value={outputFormat} onChange={(e) => setField("outputFormat", e.target.value as typeof outputFormat)}>{["png", "jpeg", "webp"].map((format) => <option key={format} value={format}>{format.toUpperCase()}</option>)}</select></label>
          <label>背景<select value={background} onChange={(e) => setField("background", e.target.value as typeof background)}><option value="auto">自动</option><option value="opaque">不透明</option><option value="transparent">透明</option></select></label>
          <label>随机种子<input type="number" min={0} value={seed} onChange={(e) => setField("seed", Math.max(0, Number(e.target.value) || 0))} /><small>0 表示随机</small></label>
        </div>}
        {errorMessage && <p className="xai-request-error" role="alert">{errorMessage}</p>}
      </section>}
      <section className="xai-results"><div className="xai-results-head"><div><h2>创作结果</h2><p>每一次灵感，都值得被看见</p></div><button className="xai-link" onClick={openHistoryTimeline}>查看全部 <ChevronRight size={15} /></button></div>
        <div className="xai-result-tabs">{["全部", "图片", "视频"].map((label) => <button key={label} className={filter === label ? "active" : ""} onClick={() => setFilter(label)}>{label}</button>)}</div>
        <div className="xai-result-grid">{cards.map((item) => <ResultCard item={item} key={item.id} onDetail={() => void openResultDetail(item)} onRegenerate={() => void regenerateFromHistory(item)} onDelete={() => void deleteHistoryItem(item.id)} />)}</div>
        {!cards.length && <p className="xai-empty-results">{filter === "视频" ? "视频结果可在视频生成面板中查看。" : "还没有创作结果，输入提示词开始生成。"}</p>}
      </section>
    </main></div>
  </div>;
}
function ProWorkspace({ setView, onOpenSettings }: { setView: (v: StudioView) => void; onOpenSettings: () => void }) {
  const { openHistoryTimeline, pushToast, apiKey, baseURL } = useStudioStore();
  return <div className="xai-window pro-window"><div className="xai-window-bar drag-region" onDoubleClick={(event) => handleWindowTitleBarDoubleClick(event, () => pushToast("窗口控制请在桌面应用中使用。", "info"))}><XAIWindowControls onUnavailable={() => pushToast("窗口控制请在桌面应用中使用。", "info")} /><span className="xai-window-title">XAI</span><ModeSwitch view="pro" setView={setView} /><div className="xai-connected"><i />{apiKey && baseURL ? "已配置" : "未配置"}</div></div><div className="xai-window-body"><SideNav onCreate={() => setView("simple")} onHistory={openHistoryTimeline} onSettings={onOpenSettings} onHint={(label) => pushToast(`${label}功能尚未开放，当前可继续使用创作与作品历史`, "info")} /><XAIProPanels /></div></div>;
}
export function XAIWorkspace({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [view, setViewState] = useState<WorkspaceView>("home");
  const [tab, setTab] = useState<MediaTab>("image");
  const setView = (next: WorkspaceView) => { setViewState(next); };
  return <XAIShell view={view} setView={setView} onVideo={() => { setTab("video"); setView("simple"); }} onImage={() => { setTab("image"); setView("simple"); }}>
    {view === "simple" ? <SimpleWorkspace tab={tab} setTab={setTab} setView={setView} /> : view === "pro" ? <ProWorkspace setView={setView} onOpenSettings={onOpenSettings} /> : null}
  </XAIShell>;
}
