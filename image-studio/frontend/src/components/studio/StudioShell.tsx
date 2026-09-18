import { useEffect, useRef, useState } from "react";
import { ArrowRight, Bell, Box, Check, CheckCircle2, ChevronRight, Clock3, Film, FolderOpen, HelpCircle, Home, Image as ImageIcon, Layers3, LoaderCircle, Plus, Search, Settings, Sparkles, Upload, Workflow, X } from "lucide-react";
import { useStudioStore } from "../../state/studioStore";
import { useStudioV2, retryStudioSave, deliverVideoTask } from "../../state/studioV2";
import { isActiveTask, safeMediaSource, type StudioTask } from "../../lib/studioDocuments";
import { historyPreviewSrc, useBlobURL } from "../../lib/images";
import type { HistoryItem } from "../../types/domain";
import { XAIWorkspace } from "../xai/XAIWorkspace";
import { handleWindowTitleBarDoubleClick, XAIWindowControls } from "../xai/XAIWindowControls";
import { WorkspaceBar } from "../layout/WorkspaceBar";
import { TaskPanel } from "./TaskPanel";
import "./studio-shell.css";

type Page = "home" | "create" | "assets" | "resources" | "workspaces" | "tasks" | "guide";
type Mode = "simple" | "pro";
function readMode(): Mode {
  try { return localStorage.getItem("xai-ui-mode") === "pro" ? "pro" : "simple"; } catch { return "simple"; }
}
function readExplored(): boolean { try { return localStorage.getItem("xai-pro-explored") === "1"; } catch { return false; } }
function Artwork({ item, onSelect }: { item: HistoryItem; onSelect: () => void }) {
  const url = useBlobURL(item.previewBlob || item.imageBlob, item.imageB64);
  return <button className="studio-artwork" onClick={onSelect} aria-label={`查看作品：${item.prompt}`}>
    <div className="studio-artwork-cover"><img src={historyPreviewSrc(item, url)} alt={item.prompt || "生成图片"} loading="lazy" /><span><ImageIcon size={13} />图片</span></div>
    <div className="studio-artwork-caption"><strong>{item.prompt || "未命名作品"}</strong><small>{item.size === "auto" ? "自适应尺寸" : item.size.replace("x", " × ")} · {new Date(item.createdAt).toLocaleDateString("zh-CN")}</small></div>
  </button>;
}
function VideoArtwork({ task }: { task: StudioTask }) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (open) dialog.current?.showModal(); else dialog.current?.close(); }, [open]);
  const src = safeMediaSource(task.result?.mediaUrl);
  return <><button className="studio-artwork" onClick={() => setOpen(true)} aria-label={`查看视频：${task.label || task.id}`}>
    <div className="studio-artwork-cover studio-video-cover"><Film size={34} /><span><Film size={13} />视频</span></div><div className="studio-artwork-caption"><strong>{task.label || "生成视频"}</strong><small>{task.modelId} · {new Date(task.createdAt).toLocaleDateString("zh-CN")}</small></div></button>
    {open && <dialog ref={dialog} className="studio-video-dialog" onCancel={() => setOpen(false)} onClick={(event) => { if (event.target === event.currentTarget) setOpen(false); }}><div><button className="studio-icon-button" aria-label="关闭视频预览" onClick={() => setOpen(false)}><X size={20} /></button><h3>{task.label || "生成视频"}</h3><video src={src} controls autoPlay /><button className="studio-primary" onClick={() => { deliverVideoTask(task, useStudioStore.getState().activeWorkspaceId); setOpen(false); }}>加入当前画布<ArrowRight size={16} /></button></div></dialog>}
  </>;
}
function Works({ compact = false, query = "" }: { compact?: boolean; query?: string }) {
  const { history, openResultDetail, openHistoryTimeline } = useStudioStore();
  const tasks = useStudioV2((state) => state.tasks);
  const [filter, setFilter] = useState("全部");
  const images = filter === "视频" ? [] : history.filter((item) => !query || item.prompt.toLowerCase().includes(query.toLowerCase()));
  const videos = filter === "图片" ? [] : tasks.filter((task) => task.kind === "video" && task.status === "succeeded" && task.result?.mediaUrl && (!query || task.label?.toLowerCase().includes(query.toLowerCase())));
  const items = [...images.map((image) => ({ type: "image" as const, image, time: image.createdAt })), ...videos.map((video) => ({ type: "video" as const, video, time: video.createdAt }))].sort((a, b) => b.time - a.time);
  return <section className={compact ? "studio-works" : "studio-page"} aria-label="作品库"><div className="studio-section-heading"><h2>{compact ? "最近作品" : "我的作品"}</h2><div className="studio-filter">{["全部", "图片", "视频"].map((label) => <button key={label} aria-pressed={filter === label} onClick={() => setFilter(label)}>{label}</button>)}</div><button className="studio-text-button" onClick={openHistoryTimeline}>完整图片历史<ChevronRight size={14} /></button></div>
    <div className="studio-works-grid">{items.slice(0, compact ? 5 : 100).map((item) => item.type === "image" ? <Artwork key={item.image.id} item={item.image} onSelect={() => void openResultDetail(item.image)} /> : <VideoArtwork key={item.video.id} task={item.video} />)}</div>
    {!items.length && <div className="studio-empty studio-empty-works"><ImageIcon size={24} /><div><h3>{query ? "没有找到匹配的作品" : "灵感的下一站，在这里"}</h3><p>{query ? "尝试搜索提示词中的其他关键词。" : "你的图片和视频将在生成后显示在这里。现在，开始第一份创作。"}</p></div></div>}
  </section>;
}
function Guide({ explored, create }: { explored: boolean; create: (mode: Mode, tab?: "image" | "video") => void }) {
  const state = useStudioStore(); const tasks = useStudioV2((value) => value.tasks);
  const configured = !!state.apiKey && !!state.baseURL;
  const steps = [
    { title: "连接上游模型", text: "填写你自己的 API 地址、密钥与模型", done: configured, action: () => state.openUpstreamConfig("app") },
    { title: "生成你的第一张图片", text: "用一句话，让想象成为作品", done: state.history.length > 0, action: () => create("simple", "image") },
    { title: "尝试生成一段视频", text: "为镜头赋予动作、光线与节奏", done: tasks.some((task) => task.kind === "video" && task.status === "succeeded"), action: () => create("simple", "video") },
    { title: "探索专业模式", text: "在无限画布中组织你的创作", done: explored, action: () => create("pro") },
  ];
  const done = steps.filter((step) => step.done).length;
  return <section className="studio-glass studio-guide"><div className="studio-section-heading"><h2>新手引导</h2><span>{done}/4</span></div><progress max={4} value={done} aria-label="新手引导进度" /><p className="studio-muted">完成以下步骤，开启你的创作之旅</p>
    <div className="studio-steps">{steps.map((step) => <button key={step.title} onClick={step.action}><span className={step.done ? "is-done" : ""}>{step.done ? <Check size={13} /> : null}</span><div><strong>{step.title}</strong><small>{step.text}</small></div><ChevronRight size={14} /></button>)}</div>
    <button className="studio-primary studio-wide" onClick={() => create("simple")}>开始创作<ArrowRight size={18} /></button>
  </section>;
}
export function StudioShell({ onOpenSettings }: { onOpenSettings: () => void }) {
  const state = useStudioStore(); const runtime = useStudioV2();
  const [page, setPage] = useState<Page>("home");
  const [mode, setModeState] = useState<Mode>(readMode);
  const [tab, setTab] = useState<"image" | "video">("image");
  const [query, setQuery] = useState("");
  const [explored, setExplored] = useState(readExplored);
  const search = useRef<HTMLInputElement>(null);
  const profile = state.profiles.find((entry) => entry.id === state.activeProfileId);
  const configured = !!state.apiKey && !!state.baseURL;
  const activeTasks = runtime.tasks.filter(isActiveTask).length;
  const setMode = (next: Mode) => {
    setModeState(next);
    try { localStorage.setItem("xai-ui-mode", next); if (next === "pro") localStorage.setItem("xai-pro-explored", "1"); } catch { /* Restricted webviews may disable storage. */ }
    if (next === "pro") setExplored(true);
  };
  const create = (next: Mode, media: "image" | "video" = "image") => { setMode(next); setTab(media); setPage("create"); };
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); search.current?.focus(); } };
    window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
  }, []);
  async function importReference() {
    await state.selectSourceImage(); create("simple");
  }
  function newWorkspace() {
    if (state.workspaces.length >= 100) { state.pushToast("最多保存 100 个画布工作区", "warn"); return; }
    state.newWorkspace(`画布 ${state.workspaces.length + 1}`); create("pro");
  }
  const nav = [["home", Home, "首页"], ["create", Sparkles, "创作"], ["assets", FolderOpen, "作品"], ["resources", Box, "资源"], ["workspaces", Workflow, "工作区"], ["tasks", Clock3, "任务"]] as const;
  const storageText = { loading: "正在加载画布", preview: "浏览器预览", unsaved: "有未保存更改", saving: "正在保存", saved: "画布已保存", error: "保存需要处理" }[runtime.storage];
  return <div className="studio-shell">
    <div className="studio-silk" aria-hidden="true"><i /><i /><i /></div>
    <header className="studio-topbar drag-region" onDoubleClick={(event) => handleWindowTitleBarDoubleClick(event, () => undefined)}>
      <XAIWindowControls onUnavailable={() => state.pushToast("窗口控制需要桌面应用。", "info")} />
      <button className="studio-brand no-drag" onClick={() => setPage("home")} aria-label="XAI 首页"><b>XAI</b><span>Image Studio</span><small>更自由地创造</small></button>
      <form className="studio-search no-drag" onSubmit={(event) => { event.preventDefault(); setPage("assets"); }}><Search size={17} /><input ref={search} aria-label="搜索作品提示词" placeholder="搜索作品、提示词…" value={query} onChange={(event) => setQuery(event.target.value)} /><kbd>⌘ K</kbd></form>
      <div className="studio-mode-switch no-drag" aria-label="创作模式"><button aria-pressed={mode === "simple"} onClick={() => create("simple")}>简洁模式</button><button aria-pressed={mode === "pro"} onClick={() => create("pro")}>专业模式</button></div>
      <button className="studio-notification studio-icon-button no-drag" aria-label={`任务中心，${activeTasks} 个进行中`} onClick={() => setPage("tasks")}><Bell size={20} />{activeTasks > 0 && <i>{activeTasks}</i>}</button>
      <button className="studio-profile no-drag" onClick={onOpenSettings}><span><Layers3 size={18} /></span><div>本地工作室<small>{runtime.available ? "DESKTOP" : "PREVIEW"}</small></div></button>
    </header>
    <div className="studio-body"><nav className="studio-sidebar" aria-label="主导航">{nav.map(([value, Icon, label]) => <button key={value} aria-current={page === value ? "page" : undefined} onClick={() => setPage(value)}><Icon size={20} /><span>{label}</span></button>)}<div className="studio-sidebar-spacer" /><button aria-current={page === "guide" ? "page" : undefined} onClick={() => setPage("guide")}><HelpCircle size={20} /><span>使用指南</span></button><button onClick={onOpenSettings}><Settings size={20} /><span>设置</span></button><div className="studio-sidebar-sign"><strong>XAI</strong><small>From Imagination<br />to Everything</small></div></nav>
      <div className="studio-content">
        {runtime.storage === "error" && <div className="studio-save-error" role="alert"><strong>画布保存已暂停</strong><span>{runtime.error}</span>{!runtime.error.includes("CANVAS_CONFLICT") && runtime.ready && <button onClick={() => void retryStudioSave()}>重试保存</button>}</div>}
        {page === "home" ? <div className="studio-home"><main className="studio-home-main">
          <section className="studio-welcome"><div><span className="studio-eyebrow">YOUR IMAGINATION, UNLIMITED</span><h1>用 AI，创造无限可能</h1><p>从灵感到作品，XAI 与你一起，让想象力触手可及。</p></div><span className="studio-welcome-mark">想象 · 探索 · 创造 · 分享<small>From Imagination to Everything</small></span></section>
          <div className="studio-hero-grid"><article className="studio-glass studio-hero-card"><div><h2>简洁模式 <span>快速创作</span></h2><p>专注创作，简单高效<br />一站式完成图片与视频生成。</p><button className="studio-soft-button" onClick={() => create("simple")}>立即开始<ArrowRight size={19} /></button></div><div className="studio-hero-art" aria-hidden="true"><div className="studio-art-card"><div className="studio-art-sky"><span /><i /><i /></div><small>把灵感，变成作品</small></div><div className="studio-art-video"><Film size={24} /></div><span className="studio-art-spark">✦</span></div></article>
            <article className="studio-glass studio-hero-card studio-hero-pro"><div><h2>专业模式 <span>深度控制</span></h2><p>自由布局 · 无限画布<br />图片、视频与创作参数，尽在掌握。</p><button className="studio-primary" onClick={() => create("pro")}>进入专业模式<ArrowRight size={19} /></button></div><div className="studio-flow-art" aria-hidden="true"><div><Sparkles size={13} />提示词</div><i /><div><ImageIcon size={15} />图像节点</div><div><Film size={15} />视频节点</div><span>自由组织你的创意</span></div></article></div>
          <section className="studio-quick"><div className="studio-section-heading"><h2>快捷操作</h2><button className="studio-text-button" onClick={() => setPage("guide")}>创作指南<ChevronRight size={14} /></button></div><div className="studio-quick-grid">{[
            { title: "生成图片", text: "从文字或参考图\n生成精美图片", Icon: ImageIcon, action: () => create("simple", "image") },
            { title: "生成视频", text: "让创意动起来\nAPI 驱动镜头生成", Icon: Film, action: () => create("simple", "video") },
            { title: "最近项目", text: "继续创作\n打开保存的画布", Icon: FolderOpen, action: () => setPage("workspaces") },
            { title: "新建画布", text: "从空白画布开始\n组织你的创作", Icon: Workflow, action: newWorkspace },
            { title: "导入参考图", text: "上传图片\n作为创作参考", Icon: Upload, action: () => void importReference() },
          ].map(({ title, text, Icon, action }) => <button key={title} onClick={action}><span><Icon size={23} /></span><div><strong>{title}</strong><small>{text}</small></div></button>)}</div></section>
          <Works compact />
        </main><aside className="studio-home-rail"><section className="studio-glass studio-model"><div className="studio-section-heading"><h2>当前模型 <small>/ 连接配置</small></h2><span className={`studio-config-state ${configured ? "configured" : ""}`}><i />{configured ? "已配置" : "待配置"}</span></div><button className="studio-model-select" onClick={() => state.openUpstreamConfig("app")}><span><Layers3 size={25} /></span><strong>{profile?.imageModelID || "连接你的 AI 模型"}<small>{profile?.name || "自定义 Base URL + API Key"}</small></strong><ChevronRight size={16} /></button><div className="studio-model-tags"><span>图像生成</span><span>图像编辑</span><span>视频生成</span></div><div className="studio-model-stats"><div><small>已载入图片</small><strong>{state.history.length}</strong></div><div><small>进行中任务</small><strong>{activeTasks}</strong></div><div><small>存储方式</small><strong>本地</strong></div></div><p className="studio-model-note">配置状态不代表连接成功；可在设置中测试上游。</p></section><Guide explored={explored} create={create} /></aside></div> : null}
        {page === "create" && <div className="studio-creator"><div className="studio-creator-toolbar"><button className="studio-text-button" onClick={() => setPage("workspaces")}><Layers3 size={15} />{state.workspaces.find((workspace) => workspace.id === state.activeWorkspaceId)?.name || "创作工作区"}</button><button className="studio-text-button" onClick={newWorkspace}><Plus size={15} />新建画布</button><span /><small>{runtime.available ? "" : "浏览器 · "}{storageText}</small></div><WorkspaceBar />{runtime.ready ? <div className="studio-embedded"><XAIWorkspace onOpenSettings={onOpenSettings} controlledView={mode} onViewChange={setMode} initialTab={tab} key={tab} /></div> : <div className="studio-empty"><LoaderCircle size={24} /><h3>{runtime.storage === "error" ? "请先处理画布加载错误" : "正在恢复你的工作区…"}</h3></div>}</div>}
        {page === "assets" && <Works query={query} />}
        {page === "tasks" && <TaskPanel />}
        {page === "workspaces" && <section className="studio-page"><div className="studio-section-heading"><div><span className="studio-eyebrow">INFINITE POSSIBILITIES</span><h2>画布工作区</h2></div><button className="studio-primary" onClick={newWorkspace}><Plus size={17} />新建画布</button></div><p className="studio-muted">每个工作区独立保存素材节点、位置、视口与提示词。当前为自由画布，不执行节点连线工作流。</p><div className="studio-workspace-grid">{state.workspaces.map((workspace) => <article className="studio-glass studio-workspace-card" key={workspace.id}><div className="studio-workspace-art"><Layers3 size={36} /><span>{workspace.canvasNodes?.length || 0} 个节点</span></div><input aria-label={`工作区名称 ${workspace.id}`} value={workspace.name} maxLength={120} onChange={(event) => state.renameWorkspace(workspace.id, event.target.value)} /><p>{workspace.prompt || "等待一个新的灵感"}</p><button className="studio-soft-button" onClick={() => { state.switchWorkspace(workspace.id); create("pro"); }}>继续创作<ArrowRight size={17} /></button></article>)}</div></section>}
        {page === "resources" && <section className="studio-page"><div className="studio-section-heading"><div><span className="studio-eyebrow">CREATIVE MATERIALS</span><h2>当前工作区参考图</h2></div><button className="studio-primary" onClick={() => void state.selectSourceImage()}><Upload size={17} />导入参考图</button></div><p className="studio-muted">参考图用于图像编辑或视频首帧。导入后可放到专业画布中查看。</p><div className="studio-resource-list">{state.sources.map((source, index) => <article className="studio-glass" key={source.path}><ImageIcon size={25} /><strong>{source.name}</strong><small>{source.size ? `${Math.round(source.size / 1024)} KB` : "本地文件"}</small><button onClick={() => { void state.viewSourceOnCanvas(index); create("pro"); }}>查看画布</button><button aria-label={`移除参考图 ${source.name}`} onClick={() => state.removeSource(index)}><X size={17} /></button></article>)}</div>{!state.sources.length && <div className="studio-empty"><Upload size={30} /><h3>把参考图放进来</h3><p>导入仅保存在本地；调用上游生成或图像理解功能时才发送。</p></div>}</section>}
        {page === "guide" && <section className="studio-page studio-guide-page"><span className="studio-eyebrow">START CREATING</span><h2>从第一个灵感开始</h2><Guide explored={explored} create={create} /><div className="studio-glass studio-guide-notes"><h3>画布操作</h3><p>滚轮以指针为中心缩放；按住空格或鼠标中键平移画布；拖动素材调整位置。专业模式支持图片蒙版、标注以及视频预览。</p><h3>视频与密钥</h3><p>先在上游配置里填写独立的视频模型 ID，再选择对应协议。接口连通性、支持参数及费用由上游决定；本应用不会自动替换模型。</p><h3>保存与恢复</h3><p>桌面版自动保存画布。看到“画布已保存”后再退出。视频中断时，在任务中心恢复已有远端任务查询；没有远端 ID 的任务不会自动再次提交。</p></div></section>}
      </div>
    </div>
    <footer className="studio-footer"><span><span className={`studio-save-dot ${runtime.storage === "error" ? "is-error" : ""}`} />{runtime.available ? "" : "浏览器 · "}{storageText}</span><span>XAI Image Studio · 让想象发生</span><button onClick={() => setPage("tasks")}>{activeTasks > 0 ? `${activeTasks} 个任务进行中` : "准备好开始创作"}<ChevronRight size={13} /></button></footer>
  </div>;
}
