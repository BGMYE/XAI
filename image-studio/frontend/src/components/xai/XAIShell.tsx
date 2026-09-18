import { useState, type ReactNode } from "react";
import { ArrowRight, Box, Check, ChevronRight, Clock3, Film, FolderOpen, Home, Image as ImageIcon, Layers3, Search, Settings, Sparkles, Upload, Workflow } from "lucide-react";
import { useStudioStore } from "../../state/studioStore";
import { useStudioV2 } from "../../state/studioV2Runtime";
import { historyPreviewSrc, useBlobURL } from "../../lib/images";
import type { HistoryItem } from "../../types/domain";
import { XAIWindowControls, handleWindowTitleBarDoubleClick } from "./XAIWindowControls";
import { WorkspaceBar } from "../layout/WorkspaceBar";
import "./xai-dashboard.css";

export type WorkspaceView = "home" | "simple" | "pro";
function WorkPreview({ item }: { item: HistoryItem }) {
  const blob = useBlobURL(item.previewBlob ?? item.imageBlob, item.imageB64);
  const open = useStudioStore((s) => s.openResultDetail);
  return <button className="xai-home-work" onClick={() => void open(item)}><img src={historyPreviewSrc(item, blob)} alt={item.prompt || "生成作品"} loading="lazy" /><span><b>{item.prompt || "未命名作品"}</b><small>{item.size} · {new Date(item.createdAt).toLocaleDateString()}</small></span><ChevronRight size={15} /></button>;
}
export function XAIShell({ view, setView, onVideo, onImage, children }: { view: WorkspaceView; setView: (view: WorkspaceView) => void; onVideo: () => void; onImage: () => void; children: ReactNode }) {
  const state = useStudioStore();
  const { ready, saving, storageError, tasks } = useStudioV2();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("全部");
  const profile = state.profiles.find((p) => p.id === state.activeProfileId);
  const configured = !!(profile?.baseURL && state.apiKey);
  const videos = tasks.filter((t) => t.kind === "video" && t.status === "succeeded");
  const matches = (text: string) => text.toLowerCase().includes(search.toLowerCase().trim());
  const recentImages = filter === "视频" ? [] : state.history.filter((h) => matches(h.prompt || "")).slice(0, 5);
  const recentVideos = filter === "图片" ? [] : videos.filter((v) => matches(v.label || "")).slice(0, 5);
  const configuredText = configured ? "已配置 · 未验证连接" : "待配置";
  const unavailable = () => state.pushToast("窗口控制请在桌面应用中使用", "info");
  const startNew = () => { state.newWorkspace(); setView("pro"); };
  const importImage = async () => { await state.selectSourceImage(); onImage(); };
  const steps = [
    { label: "连接上游模型", description: "填写你的服务地址、API Key 与模型", done: configured, action: state.openSettings },
    { label: "生成你的第一张图片", description: "用文字描述你脑海中的画面", done: state.history.length > 0, action: onImage },
    { label: "尝试生成一段视频", description: "为镜头注入运动与节奏", done: videos.length > 0, action: onVideo },
    { label: "探索无限画布", description: "安排图像、视频与每一个镜头", done: state.workspaces.some((w) => (w.canvasNodes?.length ?? 0) > 1), action: () => setView("pro") },
  ];
  const completed = steps.filter((s) => s.done).length;
  const actions = [
    { Icon: ImageIcon, name: "生成图片", text: "把文字灵感变成画面", action: onImage },
    { Icon: Film, name: "生成视频", text: "让创意流动起来", action: onVideo },
    { Icon: FolderOpen, name: "最近项目", text: "继续上次的创作", action: () => setView("pro") },
    { Icon: Workflow, name: "新建画布", text: "从空白工作区开始", action: startNew },
    { Icon: Upload, name: "导入参考图", text: "为创作提供参考", action: () => void importImage() },
  ];
  const nav = [
    { Icon: Home, name: "首页", active: view === "home", action: () => setView("home") },
    { Icon: Sparkles, name: "创作", active: view === "simple", action: onImage },
    { Icon: FolderOpen, name: "作品", active: false, action: state.openHistoryTimeline },
    { Icon: Box, name: "资源", active: false, action: () => void importImage() },
    { Icon: Workflow, name: "无限画布", active: view === "pro", action: () => setView("pro") },
    { Icon: Clock3, name: "历史", active: false, action: state.openHistoryTimeline },
  ];
  return <div className="xai-app xai-dashboard-app">
    <header className="xai-shell-header drag-region" onDoubleClick={(e) => handleWindowTitleBarDoubleClick(e, unavailable)}>
      <XAIWindowControls onUnavailable={unavailable} />
      <button className="xai-brand no-drag" onClick={() => setView("home")} aria-label="返回 XAI 首页"><strong>XAI</strong><span>Image Studio</span><small>更自由地创造</small></button>
      <label className="xai-global-search no-drag"><Search size={17} /><input aria-label="搜索已加载的作品" placeholder="搜索已加载的作品、提示词…" value={search} onFocus={() => setView("home")} onChange={(e) => setSearch(e.target.value)} /><kbd>搜索</kbd></label>
      <div className="xai-shell-mode no-drag" aria-label="创作模式"><button className={view !== "pro" ? "active" : ""} onClick={onImage}>简洁模式</button><button className={view === "pro" ? "active" : ""} onClick={() => setView("pro")}>专业模式</button></div>
      <button className="xai-profile-button no-drag" onClick={state.openSettings} aria-label="打开上游和应用设置"><span>{(profile?.name || "X").slice(0, 1)}</span><b>{profile?.name || "本地工作室"}</b><Settings size={16} /></button>
    </header>
    <div className="xai-shell-body"><nav className="xai-shell-nav" aria-label="主导航">{nav.map(({ Icon, name, active, action }) => <button key={name} onClick={action} className={active ? "active" : ""} aria-current={active ? "page" : undefined}><Icon size={21} /><span>{name}</span></button>)}<div className="xai-nav-bottom"><button onClick={state.openSettings}><Settings size={21} /><span>设置</span></button><div className="xai-signature"><b>XAI</b><span>From Imagination<br />to Everything</span></div></div></nav>
    <div className={`xai-shell-content ${view === "home" ? "is-home" : "is-editor"}`}>
      {!ready ? <div className="xai-boot-message" role="status">正在恢复你的工作室…</div> : view === "home" ? <>
        <main className="xai-home-main">
          <section className="xai-hero"><div><span className="xai-eyebrow">你的灵感，自有天地</span><h1>用 AI，创造无限可能</h1><p>从灵感到作品，XAI 与你一起，让想象力触手可及。</p></div><span className="xai-hero-motto">想象 · 探索 · 创造 · 分享<small>From Imagination to Everything</small></span></section>
          <section className="xai-home-modes" aria-label="选择创作方式">
            <article className="xai-mode-card"><div><h2>简洁模式 <small>快速创作</small></h2><p>专注创作，简单高效<br />一站式完成图片与视频生成。</p><button className="xai-home-button secondary" onClick={onImage}>立即开始 <ArrowRight size={19} /></button></div><div className="xai-mode-art simple-art" aria-hidden="true"><div className="art-frame large"><ImageIcon size={64} strokeWidth={1} /><span>IDEA → IMAGE</span></div><div className="art-frame small"><Film size={30} strokeWidth={1.4} /><span>MOTION</span></div><i /></div></article>
            <article className="xai-mode-card professional"><div><h2>专业模式 <small>深度控制</small></h2><p>持久化工作区 · 无限画布<br />精细参数，让每一帧各就其位。</p><button className="xai-home-button" onClick={() => setView("pro")}>进入专业模式 <ArrowRight size={19} /></button></div><div className="xai-mode-art pro-art" aria-hidden="true"><div><Sparkles size={16} />提示词</div><i /><div><ImageIcon size={16} />图像节点</div><div><Film size={16} />视频节点</div><span><Layers3 size={42} strokeWidth={1} /></span></div></article>
          </section>
          <section className="xai-quick"><div className="xai-section-heading"><h2>快捷操作</h2><button onClick={() => setView("pro")}>进入工作区 <ChevronRight size={14} /></button></div><div className="xai-quick-grid">{actions.map(({ Icon, name, text, action }) => <button key={name} onClick={action}><span className="xai-quick-icon"><Icon size={24} /></span><span><b>{name}</b><small>{text}</small></span></button>)}</div></section>
          <section className="xai-recent"><div className="xai-section-heading"><h2>最近作品</h2><div className="xai-home-filters" aria-label="作品分类">{["全部", "图片", "视频"].map((f) => <button className={filter === f ? "active" : ""} onClick={() => setFilter(f)} key={f}>{f}</button>)}</div><button onClick={state.openHistoryTimeline}>图片历史 <ChevronRight size={14} /></button></div>
            {recentImages.length + recentVideos.length > 0 ? <div className="xai-home-works">{recentImages.map((h) => <WorkPreview key={h.id} item={h} />)}{recentVideos.map((v) => <button className="xai-home-work" key={v.id} onClick={() => { if (v.workspaceId && state.workspaces.some((w) => w.id === v.workspaceId)) state.switchWorkspace(v.workspaceId); setView("pro"); }}><div className="xai-video-tile"><Film size={32} /><span>VIDEO</span></div><span><b>{v.label || "生成的视频"}</b><small>本地视频 · 查看画布</small></span></button>)}</div> : <div className="xai-home-empty"><div><ImageIcon size={30} strokeWidth={1.3} /><Film size={26} strokeWidth={1.3} /></div><b>{search ? "没有找到匹配的作品" : "你的下一件作品，从这里开始"}</b><p>{search ? "这里只搜索已加载的本地作品；完整图片记录可在历史中查看。" : "生成的图片与视频会出现在这里。没有预置作品，也没有虚构的使用数据。"}</p><button onClick={onImage}>开始创作 <ArrowRight size={15} /></button></div>}
          </section>
        </main>
        <aside className="xai-home-rail"><section className="xai-model-card"><div className="xai-section-heading"><h2>当前模型 <small>/ 连接状态</small></h2></div><p className={`xai-model-status ${configured ? "configured" : ""}`}><i />{configuredText}</p><button className="xai-current-model" onClick={state.openSettings}><span><Layers3 size={27} /></span><b>{profile?.imageModelID || "尚未选择模型"}</b><ChevronRight size={16} /></button><div className="xai-model-tags"><span>文本生图</span><span>图像编辑</span><span className={profile?.videoModelID ? "available" : ""}>视频生成</span></div><div className="xai-home-stats"><div><small>已加载图片</small><b>{state.history.length}</b></div><div><small>已完成视频</small><b>{videos.length}</b></div><div><small>工作区</small><b>{state.workspaces.length}</b></div></div><small className="xai-usage-note">统计来自本地记录，不代表上游额度或账单。</small></section>
          <section className="xai-onboarding"><div className="xai-section-heading"><h2>新手引导</h2><span>{completed}/4</span></div><div className="xai-onboarding-track" role="progressbar" aria-label="新手引导完成度" aria-valuenow={completed} aria-valuemin={0} aria-valuemax={4}><i style={{ width: `${completed * 25}%` }} /></div><p>完成以下步骤，开启你的创作之旅</p><div className="xai-onboarding-steps">{steps.map((step) => <button key={step.label} onClick={step.action}><i className={step.done ? "done" : ""}>{step.done && <Check size={13} />}</i><span><b>{step.label}</b><small>{step.description}</small></span></button>)}</div><button className="xai-home-button" onClick={configured ? onImage : state.openSettings}>{configured ? "开始创作" : "配置上游"}<ArrowRight size={18} /></button></section>
        </aside>
      </> : <><WorkspaceBar />{children}</>}
    </div></div>
    <footer className="xai-shell-footer"><span>{storageError ? "保存需要处理" : !ready ? "正在恢复" : saving ? "正在保存画布…" : "工作区自动保存"}</span><span>本地工作室 · 密钥不写入画布文档</span></footer>
    {storageError && <div role="alert" className="xai-storage-error">{storageError}</div>}
  </div>;
}
