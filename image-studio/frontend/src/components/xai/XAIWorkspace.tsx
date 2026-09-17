import { useEffect, useRef, useState } from "react";
import { BookOpen, ChevronRight, Film, FolderOpen, Image as ImageIcon, MoreHorizontal, PanelLeft, Plus, Settings, SlidersHorizontal, Sparkles, Square, Wand2, X } from "lucide-react";
import { useStudioStore } from "../../state/studioStore";
import { usePlatform } from "../../platform/context";
import { VideoGenerationPanel } from "../panel/VideoGenerationPanel";
import { PromptTemplateManagerModal } from "../panel/PromptTemplateManagerModal";
import { XAIProPanels } from "./XAIProPanels";
import { handleWindowTitleBarDoubleClick, XAIWindowControls } from "./XAIWindowControls";
import { availableQualityOptions, normalizeQualitySelection } from "../panel/panelOptions";
import { buildAspectSizeSelection, deriveAspectPreset, deriveResolutionPreset, listAspectPresetOptions, normalizeSizeSelection, type AspectPreset } from "../panel/sizeCapabilities";
import { useBlobURL } from "../../lib/images";
import type { HistoryItem, SourceImage } from "../../types/domain";
import { XAIProgress } from "./XAIProgress";
import { ContextMenu, type MenuItem } from "../common/ContextMenu";
import { Modal } from "../common/Modal";
import { DeleteResultDialog, DesktopLibrary, DesktopResultCard, DesktopResultDetail } from "./DesktopLibrary";
import { EmptyState, IconButton, SegmentedControl, StudioButton } from "./DesktopPrimitives";
import "./xai-theme.css";

type StudioView = "simple" | "pro";
type MediaTab = "image" | "video";
const modeOptions = [{ value: "simple", label: "简洁模式" }, { value: "pro", label: "专业模式" }] as const;

function ReferenceThumbnail({ source, index, onRemove }: { source: SourceImage; index: number; onRemove: () => void }) {
  const blobURL = useBlobURL(source.imageBlob, source.imageB64);
  return <div className="studio-reference"><img src={source.previewUrl || blobURL || ""} alt={source.name || `参考图 ${index + 1}`} /><IconButton label={`删除参考图 ${index + 1}`} onClick={onRemove}><X size={14} /></IconButton></div>;
}

function SimpleWorkspace({ onLibrary, onSettings }: { onLibrary: () => void; onSettings: () => void }) {
  const {
    prompt, setField, submit, cancel, isRunning, jobsCompleted, jobsTotal, progress, sources, selectSourceImage, removeSource, history,
    imageModelID, profiles, activeProfileId, setActiveProfile, size, batchCount, quality, outputFormat, background, seed,
    apiMode, requestPolicy, customAspectRatios, errorMessage, openResultDetail, regenerateFromHistory, promptTemplates,
    optimizePrompt, isOptimizingPrompt,
  } = useStudioStore();
  const [tab, setTab] = useState<MediaTab>("image");
  const [parametersOpen, setParametersOpen] = useState(false);
  const [deleting, setDeleting] = useState<HistoryItem | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const capability = { apiMode, requestPolicy, imageModelID };
  const aspects = listAspectPresetOptions(capability, customAspectRatios);
  const aspect = deriveAspectPreset(normalizeSizeSelection(size, capability, customAspectRatios), customAspectRatios);
  const qualities = availableQualityOptions(imageModelID);
  const activeProfile = profiles.find((entry) => entry.id === activeProfileId);
  const modelChoices = profiles.flatMap((profile) => Array.from(new Set([profile.imageModelID, ...(profile.modelIDs ?? []), ...(profile.id === activeProfileId ? [imageModelID] : [])].filter(Boolean))).map((model) => ({ profile, model, value: JSON.stringify([profile.id, model]) })));
  const selectModel = async (value: string) => {
    const choice = modelChoices.find((entry) => entry.value === value);
    if (!choice) return;
    if (choice.profile.id !== activeProfileId) await setActiveProfile(choice.profile.id);
    setField("imageModelID", choice.model);
  };
  const promptMenu = (button: HTMLButtonElement) => {
    const rect = button.getBoundingClientRect();
    setMenu({ x: rect.left, y: rect.bottom, items: promptTemplates.map((entry) => ({ label: entry.label, onClick: () => setField("prompt", entry.text) })) });
  };
  return <div className="studio-page"><div className="studio-compose">
    <header className="studio-page-header"><div><h1>创作</h1><p>描述画面，或从参考图开始。</p></div><SegmentedControl label="创作类型" value={tab} onChange={setTab} options={[{ value: "image", label: "图片", icon: <ImageIcon size={16} /> }, { value: "video", label: "视频", icon: <Film size={16} /> }]} /></header>
    <div className="studio-media-panel" hidden={tab !== "image"}>
      <section aria-label="图像生成">
        <div className="studio-compose-editor">
          <div className="studio-prompt-heading"><label htmlFor="studio-prompt">提示词</label><div className="studio-secondary-actions"><StudioButton className="quiet" disabled={!prompt.trim() || isOptimizingPrompt} onClick={() => void optimizePrompt()}><Sparkles />{isOptimizingPrompt ? "正在优化…" : "优化提示词"}</StudioButton>{promptTemplates.length > 0 && <StudioButton className="quiet" onClick={(event) => promptMenu(event.currentTarget)}><BookOpen />使用模板</StudioButton>}</div></div>
          <textarea id="studio-prompt" className="studio-prompt" value={prompt} onChange={(event) => setField("prompt", event.target.value)} placeholder="描述主体、构图、光线和风格…" maxLength={2000} />
          <div className="studio-prompt-count">{prompt.length} / 2000</div>
          <div className="studio-reference-row"><StudioButton onClick={() => void selectSourceImage()}><Plus />添加参考图</StudioButton>{sources.map((source, index) => <ReferenceThumbnail key={`${source.path}-${index}`} source={source} index={index} onRemove={() => removeSource(index)} />)}</div>
        </div>
        <div className="studio-compose-controls">
          <label className="studio-field studio-model-select">图像模型<select aria-label="图像模型" value={JSON.stringify([activeProfileId, imageModelID])} onChange={(event) => void selectModel(event.target.value)} disabled={!modelChoices.length}>{!modelChoices.length && <option value={JSON.stringify([activeProfileId, imageModelID])}>{imageModelID || "请先在设置中添加模型"}</option>}{modelChoices.map(({ profile, model, value }) => <option key={value} value={value}>{model}{profiles.length > 1 ? ` · ${profile.name}` : ""}</option>)}</select></label>
          <label className="studio-field">图像比例<select aria-label="图像比例" value={aspect} onChange={(event) => setField("size", buildAspectSizeSelection(event.target.value as AspectPreset, deriveResolutionPreset(size), capability, customAspectRatios))}>{aspects.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label className="studio-field">生成张数<select aria-label="生成张数" value={batchCount} onChange={(event) => setField("batchCount", Number(event.target.value))}>{Array.from(new Set([1, 2, 3, 4, batchCount])).sort((a, b) => a - b).map((count) => <option key={count} value={count}>{count} 张</option>)}</select></label>
          <StudioButton aria-expanded={parametersOpen} aria-controls="studio-generation-parameters" onClick={() => setParametersOpen((open) => !open)}><SlidersHorizontal />参数</StudioButton>
        </div>
        {parametersOpen && <div id="studio-generation-parameters" className="studio-parameter-grid">
          <label className="studio-field">生成质量<select value={normalizeQualitySelection(quality, imageModelID)} onChange={(event) => setField("quality", event.target.value as typeof quality)}>{qualities.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label className="studio-field">输出格式<select value={outputFormat} onChange={(event) => setField("outputFormat", event.target.value as typeof outputFormat)}>{["png", "jpeg", "webp"].map((format) => <option key={format} value={format}>{format.toUpperCase()}</option>)}</select></label>
          <label className="studio-field">背景<select value={background} onChange={(event) => setField("background", event.target.value as typeof background)}><option value="auto">自动</option><option value="opaque">不透明</option><option value="transparent">透明</option></select></label>
          <label className="studio-field">随机种子<input type="number" min={0} value={seed} onChange={(event) => setField("seed", Math.max(0, Number(event.target.value) || 0))} /><span>0 为随机生成</span></label>
        </div>}
        <div className="studio-compose-actions"><StudioButton className="quiet" onClick={onSettings}><Settings />{activeProfile?.name || "配置上游"}</StudioButton>{isRunning ? <StudioButton onClick={cancel}><Square />停止生成</StudioButton> : <StudioButton primary disabled={!prompt.trim()} onClick={() => void submit()}><Sparkles />生成图片</StudioButton>}</div>
        <XAIProgress isRunning={isRunning} progress={progress} jobsCompleted={jobsCompleted} jobsTotal={jobsTotal} />
        {errorMessage && <p className="studio-inline-error" role="alert">{errorMessage}</p>}
      </section>
      <section className="studio-recent" aria-label="最近作品"><div className="studio-section-header"><h2>最近作品</h2><StudioButton className="quiet" onClick={onLibrary}>查看全部<ChevronRight /></StudioButton></div>
        {history.length ? <div className="studio-result-grid">{history.slice(0, 4).map((item) => <DesktopResultCard key={item.id} item={item} onOpen={() => void openResultDetail(item)} onMenu={(x, y) => setMenu({ x, y, items: [{ label: "查看详情", onClick: () => void openResultDetail(item) }, { label: "重新生成", onClick: () => void regenerateFromHistory(item) }, { label: "删除作品", danger: true, separatorBefore: true, onClick: () => setDeleting(item) }] })} />)}</div> : <EmptyState title="你的作品会显示在这里">输入提示词，开始第一次创作。</EmptyState>}
      </section>
    </div>
    <div className="studio-media-panel" hidden={tab !== "video"}><VideoGenerationPanel /></div>
    {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
    <DeleteResultDialog item={deleting} onClose={() => setDeleting(null)} />
  </div></div>;
}

export function XAIWorkspace({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { isMac } = usePlatform();
  const { workspaces, activeWorkspaceId, newWorkspace, switchWorkspace, closeWorkspace, renameWorkspace, historyTimelineOpen, openHistoryTimeline, closeHistoryTimeline, resultDetail, closeResultDetail, pushToast } = useStudioStore();
  const [view, setViewState] = useState<StudioView>(() => { try { return localStorage.getItem("xai-ui-mode") === "pro" ? "pro" : "simple"; } catch { return "simple"; } });
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [workspaceMenu, setWorkspaceMenu] = useState<{ x: number; y: number } | null>(null);
  const renameInput = useRef<HTMLInputElement>(null);
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId);
  const setView = (next: StudioView) => { setViewState(next); closeHistoryTimeline(); closeResultDetail(); try { localStorage.setItem("xai-ui-mode", next); } catch { /* Preview storage can be disabled. */ } };
  const showCreate = () => { closeHistoryTimeline(); closeResultDetail(); };
  const showLibrary = () => { closeResultDetail(); openHistoryTimeline(); };
  useEffect(() => {
    const navigate = (event: Event) => {
      const next = (event as CustomEvent<{ view: StudioView | "library" }>).detail?.view;
      if (next === "library") { closeResultDetail(); openHistoryTimeline(); }
      else if (next === "simple" || next === "pro") { setViewState(next); closeHistoryTimeline(); closeResultDetail(); try { localStorage.setItem("xai-ui-mode", next); } catch { /* Storage unavailable. */ } }
    };
    window.addEventListener("studio:navigate", navigate);
    return () => window.removeEventListener("studio:navigate", navigate);
  }, [closeHistoryTimeline, closeResultDetail, openHistoryTimeline]);
  useEffect(() => { if (renameOpen) renameInput.current?.select(); }, [renameOpen]);
  return <div className="xai-app">
    <header className="studio-titlebar drag-region" onDoubleClick={(event) => handleWindowTitleBarDoubleClick(event, () => pushToast("请在桌面应用中使用窗口控制", "info"))}>
      {isMac ? <div className="studio-native-window-inset" aria-hidden="true" /> : <XAIWindowControls onUnavailable={() => pushToast("请在桌面应用中使用窗口控制", "info")} />}
      <IconButton label={sidebarOpen ? "隐藏侧边栏" : "显示侧边栏"} className="quiet no-drag" aria-expanded={sidebarOpen} aria-controls="studio-sidebar" onClick={() => setSidebarOpen((open) => !open)}><PanelLeft /></IconButton>
      <span className="studio-window-name">{historyTimelineOpen ? "作品" : resultDetail ? "作品详情" : activeWorkspace?.name || "创作"}</span>
      <div className="studio-titlebar-spacer" />
      <div className="no-drag"><SegmentedControl label="工作模式" value={view} options={modeOptions} onChange={setView} /></div>
      <div className="studio-titlebar-spacer" />
      <div className="studio-workspace-picker no-drag"><select aria-label="当前工作区" value={activeWorkspaceId} onChange={(event) => switchWorkspace(event.target.value)}>{workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select><IconButton label="工作区操作" className="quiet" onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setWorkspaceMenu({ x: rect.right, y: rect.bottom }); }}><MoreHorizontal /></IconButton></div>
    </header>
    <div className="studio-body">
      {sidebarOpen && <nav id="studio-sidebar" className="studio-sidebar" aria-label="主导航"><div className="studio-sidebar-heading">工作台</div><button type="button" aria-current={!historyTimelineOpen ? "page" : undefined} onClick={showCreate}><Wand2 />创作</button><button type="button" aria-current={historyTimelineOpen ? "page" : undefined} onClick={showLibrary}><FolderOpen />作品</button><div className="studio-sidebar-divider" /><button type="button" onClick={() => setTemplatesOpen(true)}><BookOpen />提示词模板</button><button type="button" onClick={onOpenSettings}><Settings />设置</button></nav>}
      <div className="studio-content-area">
        <main className="studio-view" hidden={historyTimelineOpen || !!resultDetail || view !== "simple"}><SimpleWorkspace onLibrary={showLibrary} onSettings={onOpenSettings} /></main>
        {view === "pro" && !historyTimelineOpen && !resultDetail && <XAIProPanels />}
        <main className={`studio-library-view${resultDetail ? " has-selection" : ""}`} hidden={!historyTimelineOpen}>
          <div className="studio-library-list"><DesktopLibrary onCreate={() => setView("pro")} /></div>
          {historyTimelineOpen && resultDetail && <aside className="studio-library-inspector" aria-label="作品详情"><DesktopResultDetail key={resultDetail.id} item={resultDetail} onClose={closeResultDetail} onCanvas={() => setView("pro")} /></aside>}
        </main>
        {!historyTimelineOpen && resultDetail && <main className="studio-view"><DesktopResultDetail key={resultDetail.id} item={resultDetail} onClose={closeResultDetail} onCanvas={() => setView("pro")} /></main>}
      </div>
    </div>
    {workspaceMenu && <ContextMenu {...workspaceMenu} onClose={() => setWorkspaceMenu(null)} items={[
      { label: "新建工作区", onClick: () => { newWorkspace(); showCreate(); } },
      { label: "重命名工作区", onClick: () => { setDraftName(activeWorkspace?.name || ""); setRenameOpen(true); } },
      { label: "关闭当前工作区", onClick: () => closeWorkspace(activeWorkspaceId), disabled: workspaces.length <= 1 },
    ]} />}
    <Modal open={renameOpen} onClose={() => setRenameOpen(false)} title="重命名工作区" width={420}><form onSubmit={(event) => { event.preventDefault(); if (!draftName.trim()) return; renameWorkspace(activeWorkspaceId, draftName.trim()); setRenameOpen(false); }}><label className="studio-field">工作区名称<input ref={renameInput} value={draftName} onChange={(event) => setDraftName(event.target.value)} maxLength={80} /></label><div className="studio-detail-actions"><StudioButton onClick={() => setRenameOpen(false)}>取消</StudioButton><StudioButton type="submit" primary disabled={!draftName.trim()}>保存名称</StudioButton></div></form></Modal>
    <PromptTemplateManagerModal open={templatesOpen} onClose={() => setTemplatesOpen(false)} />
  </div>;
}
