import {useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import {BookOpen, Check, Copy, Download, Heart, ImagePlus, Pencil, Plus, Search, SlidersHorizontal, Sparkles, Trash2, Upload, Video, X} from 'lucide-react';
import type {Asset, Kind, PromptCard, PromptView, Snapshot} from './types';
import {client, downloadText, mediaURL} from './client';
import {collectPromptCards, exportPromptPack, filterPromptCards, normalizePromptCard, parsePromptPack} from './promptLibrary.mjs';
import {copyPromptText} from './clipboard';
import './prompt-center.css';
import {PublicCatalog,SourcePreview} from './PublicPromptCatalog';

type Props = {snapshot: Snapshot; refresh(): Promise<void>; onUse(card: PromptCard): Promise<void>; onClose?(): void};
const blank = (asset?: Asset): PromptCard => ({id: '', revision: 0, title: asset?.name ?? '', prompt: '', kind: asset?.kind ?? 'image', previewAssetId: asset?.id ?? '', category: '未分类', tags: [], author: '', parameters: {}, favorite: false, createdAt: '', updatedAt: ''});

function LibraryDialog({title, onClose, children}: {title: string; onClose(): void; children: ReactNode}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {const dialog = ref.current; dialog?.showModal(); return () => dialog?.close();}, []);
  return <dialog ref={ref} className="studio-dialog pc-dialog" onCancel={e => {e.preventDefault(); onClose();}} onClick={e => {if(e.target === e.currentTarget) onClose();}}>
    <header><h2>{title}</h2><button aria-label="关闭提示词对话框" onClick={onClose}><X size={20}/></button></header>{children}
  </dialog>;
}
function Preview({asset, remoteURL, large = false}: {asset?: Asset; remoteURL?: string; large?: boolean}) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [asset?.id]);
  if (!asset && remoteURL) return <SourcePreview url={remoteURL} title="来源预览图"/>;
  if (!asset || broken) return <div className="pc-preview-empty"><ImagePlus size={large ? 46 : 32}/><span>{broken ? '预览暂不可用，提示词仍可复制' : '暂无预览图'}</span></div>;
  const src = mediaURL(asset.id);
  if (asset.kind === 'video') return <video src={src} preload="metadata" muted={!large} controls={large} playsInline onError={() => setBroken(true)}/>;
  return <img src={src} alt={asset.name} loading="lazy" draggable={false} onError={() => setBroken(true)}/>;
}

function PromptEditor({initial, assets, refresh, onSaved, onClose}: {initial: PromptCard; assets: Asset[]; refresh(): Promise<void>; onSaved(): void; onClose(): void}) {
  const [draft, setDraft] = useState(initial), [tags, setTags] = useState(initial.tags.join('，'));
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [addedAsset, setAddedAsset] = useState<Asset>();
  const lock = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const patch = (value: Partial<PromptCard>) => setDraft(p => ({...p, ...value}));
  const visibleAssets = addedAsset && !assets.some(a => a.id === addedAsset.id) ? [addedAsset, ...assets] : assets;
  const asset = visibleAssets.find(a => a.id === draft.previewAssetId);
  const action = async (fn: () => Promise<void>) => {
    if (lock.current) return; lock.current = true; setBusy(true); setError('');
    try {await fn();} catch(e) {setError(String(e instanceof Error ? e.message : e));}
    finally {lock.current = false; setBusy(false);}
  };
  return <LibraryDialog title={initial.id || initial.sourceJobId ? '编辑提示词卡片' : '添加图片与提示词'} onClose={() => {if (!busy) onClose();}}>
    <form onSubmit={e => {e.preventDefault(); void action(async () => {
      await client.savePromptCard(normalizePromptCard({...draft, tags: tags.split(/[,，]/).filter(t => t.trim())}));
      await refresh(); onSaved();
    });}}>
      <div className="pc-editor-grid"><div>
        <div className="pc-editor-preview"><Preview asset={asset} remoteURL={draft.previewURL}/></div>
        <label>预览素材<select aria-label="提示词预览素材" disabled={busy || Boolean(draft.sourceJobId)} value={draft.previewAssetId ?? ''} onChange={e => patch({previewAssetId: e.target.value})}>
          <option value="">稍后绑定图片</option>{visibleAssets.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select></label>
        <button className="studio-secondary" type="button" disabled={busy || Boolean(draft.sourceJobId)} onClick={() => fileInput.current?.click()}><Upload size={15}/>上传预览图</button>
        <input ref={fileInput} hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={e => {
          const file = e.target.files?.[0]; e.target.value = '';
          if (file) void action(async () => {const a = await client.importImage(file); setAddedAsset(a); setDraft(p => ({...p, previewAssetId: a.id, title: p.title || a.name.slice(0,60)})); await refresh();});
        }}/>
        <p className="pc-help">仅保存本地图片，不上传到第三方。普通图片不一定包含原始提示词，需要你手动填写。</p>
      </div><div>
        <label>标题<input required maxLength={60} value={draft.title} onChange={e => patch({title: e.target.value})} placeholder="例如：晨光雪山 · 写实风景"/></label>
        <div className="studio-form-row"><label>用途<select aria-label="用途" disabled={Boolean(draft.sourceJobId)} value={draft.kind} onChange={e => patch({kind: e.target.value as Kind})}><option value="image">图片</option><option value="video">视频</option></select></label><label>分类<input maxLength={30} value={draft.category} onChange={e => patch({category: e.target.value})} placeholder="摄影、设计、建筑…"/></label></div>
        <label>标签<input maxLength={240} value={tags} onChange={e => setTags(e.target.value)} placeholder="自然光，风景，电影感（最多 12 个）"/></label>
        <label>作者／来源说明<input maxLength={50} value={draft.author ?? ''} onChange={e => patch({author: e.target.value})} placeholder="可选，例如：我的原创"/></label>
      </div></div>
      <label>完整提示词<textarea aria-label="完整提示词" required rows={7} value={draft.prompt} onChange={e => patch({prompt: e.target.value})} placeholder="粘贴原始提示词，保留换行和细节。图片不会自动还原提示词。"/></label>
      <details className="pc-parameters"><summary>可选生成参数（不包含模型或 API Key）</summary><div className="studio-form-row">
        <label>尺寸<input maxLength={30} value={draft.parameters.size ?? ''} onChange={e => patch({parameters: {...draft.parameters, size: e.target.value}})} placeholder="1024x1024"/></label>
        <label>比例<input maxLength={10} value={draft.parameters.aspectRatio ?? ''} onChange={e => patch({parameters: {...draft.parameters, aspectRatio: e.target.value}})} placeholder="16:9"/></label>
        {draft.kind === 'video' && <label>时长（秒）<input type="number" min="1" max="120" value={draft.parameters.seconds ?? ''} onChange={e => patch({parameters: {...draft.parameters, seconds: e.target.value ? Number(e.target.value) : undefined}})}/></label>}
      </div></details>
      {error && <p role="alert" className="pc-error">{error}</p>}
      <div className="pc-dialog-actions"><button type="button" className="studio-secondary" disabled={busy} onClick={onClose}>取消</button><button type="submit" className="studio-primary" disabled={busy}><Check size={16}/>{busy ? '正在保存…' : '保存提示词'}</button></div>
    </form>
  </LibraryDialog>;
}

export function PromptCenter({snapshot, refresh, onUse, onClose}: Props) {
  const [collection,setCollection]=useState<'public'|'personal'>('public');
  const [tab, setTab] = useState<'prompts' | 'assets'>('prompts');
  const [query, setQuery] = useState(''), [kind, setKind] = useState('all'), [category, setCategory] = useState('all'), [favorites, setFavorites] = useState(false);
  const [limit, setLimit] = useState(60), [detail, setDetail] = useState<PromptView | null>(null), [editing, setEditing] = useState<PromptCard | null>(null);
  const [notice, setNotice] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const lock = useRef(false), packInput = useRef<HTMLInputElement>(null);
  const cards = useMemo(() => collectPromptCards(snapshot), [snapshot]);
  const filtered = useMemo(() => filterPromptCards(cards, {query, kind, category, favorites}), [cards, query, kind, category, favorites]);
  const categories = useMemo(() => [...new Set(cards.map(c => c.category))].sort(), [cards]);
  const assets = new Map(snapshot.assets.map(a => [a.id, a]));
  const activeDetail = detail ? cards.find(c => c.key === detail.key || (detail.sourceJobId && c.sourceJobId === detail.sourceJobId)) ?? detail : null;
  useEffect(() => {setLimit(60);}, [query, kind, category, favorites]);
  useEffect(() => {if (!onClose) return; const listener = (event: KeyboardEvent) => {if (event.key === 'Escape' && !document.querySelector('dialog[open]')) onClose();}; window.addEventListener('keydown', listener); return () => window.removeEventListener('keydown', listener);}, [onClose]);
  useEffect(() => {if (!notice) return; const t = setTimeout(() => setNotice(''), 3500); return () => clearTimeout(t);}, [notice]);
  const action = async (fn: () => Promise<void>) => {
    if(lock.current) return; lock.current = true; setBusy(true); setError(''); setNotice('');
    try {await fn();} catch(e) {setError(String(e instanceof Error ? e.message : e));}
    finally {lock.current = false; setBusy(false);}
  };
  const copy = (p: PromptCard) => void action(async () => {await copyPromptText(p.prompt); setNotice('完整提示词已复制');});
  const favorite = (p: PromptCard) => void action(async () => {await client.savePromptCard({...p, favorite: !p.favorite}); await refresh();});
  const use = (p: PromptCard) => void action(async () => {await onUse(p); setDetail(null);});
  return <section className={`pc-root ${onClose ? 'pc-drawer' : ''}`} aria-label="专业模式资源">
    {onClose && <header className="pc-drawer-header"><strong><BookOpen size={18}/>专业模式资源</strong><button aria-label="关闭资源面板" onClick={onClose}><X size={19}/></button></header>}
    <div className="pc-content">
      <div className="pc-tabs" role="tablist" aria-label="资源分类"><button role="tab" aria-selected={tab === 'prompts'} onClick={() => setTab('prompts')}>提示词中心</button><button role="tab" aria-selected={tab === 'assets'} onClick={() => setTab('assets')}>本地素材</button></div>
      {tab === 'prompts' && <div className="pc-tabs pc-collection-tabs" role="tablist" aria-label="提示词来源"><button role="tab" aria-selected={collection==='public'} onClick={()=>setCollection('public')}>站点图库</button><button role="tab" aria-selected={collection==='personal'} onClick={()=>setCollection('personal')}>我的资源</button></div>}
      {tab === 'prompts' ? collection === 'public' ? <PublicCatalog snapshot={snapshot} refresh={refresh} onUse={onUse}/> : <>
        <div className="pc-heading"><div><span className="studio-eyebrow">PROMPT LIBRARY</span><h2>从一张好图，开始下一次创作</h2><p>看效果 · 复制提示词 · 放入画布继续创作</p></div><div className="pc-count"><b>{cards.length}</b><span>条可复用提示词</span></div></div>
        <div className="pc-actions"><button className="studio-primary" onClick={() => setEditing(blank())}><Plus size={16}/>新建提示词</button><button className="studio-secondary" disabled={busy} onClick={() => packInput.current?.click()}><Upload size={15}/>导入资料包</button><button className="studio-secondary" disabled={busy || !filtered.length} onClick={() => void action(async () => {downloadText(exportPromptPack(filtered), 'xai-prompt-pack.json'); setNotice('已导出提示词文本；不包含预览图和上游配置');})}><Download size={15}/>导出筛选结果</button><button className="pc-refresh" disabled={busy} onClick={() => void action(refresh)}>刷新</button></div>
        <div className="pc-search-row"><label className="pc-search"><Search size={18}/><input aria-label="搜索提示词" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索标题、提示词、标签或作者…"/>{query && <button aria-label="清除提示词搜索" onClick={() => setQuery('')}><X size={15}/></button>}</label><button className={`pc-favorite-filter ${favorites ? 'active' : ''}`} aria-pressed={favorites} onClick={() => setFavorites(v => !v)}><Heart size={17} fill={favorites ? 'currentColor' : 'none'}/>我的收藏</button></div>
        <div className="pc-filters"><SlidersHorizontal size={16}/><label>用途<select aria-label="筛选提示词用途" value={kind} onChange={e => setKind(e.target.value)}><option value="all">全部用途</option><option value="image">图片</option><option value="video">视频</option></select></label><label>分类<select aria-label="筛选提示词分类" value={category} onChange={e => setCategory(e.target.value)}><option value="all">全部分类</option>{categories.map(c => <option value={c} key={c}>{c}</option>)}</select></label><span>{filtered.length} 条结果</span></div>
        <div className="pc-card-grid">{filtered.slice(0,limit).map(p => <article className="pc-card" key={p.key}>
          <div className="pc-card-cover"><button className="pc-cover-button" aria-label={`查看提示词：${p.title}`} onClick={() => setDetail(p)}><Preview asset={assets.get(p.previewAssetId ?? '')} remoteURL={p.previewURL}/><span className="pc-media-badge">{p.kind === 'image' ? <ImagePlus size={12}/> : <Video size={12}/>} {p.kind === 'image' ? '图片' : '视频'}</span></button><button className={`pc-heart ${p.favorite ? 'active' : ''}`} aria-label={`${p.favorite ? '取消收藏' : '收藏'}：${p.title}`} aria-pressed={p.favorite} disabled={busy} onClick={() => favorite(p)}><Heart size={17} fill={p.favorite ? 'currentColor' : 'none'}/></button></div>
          <div className="pc-card-body"><span className="pc-category">{p.category} · {p.sourceJobId ? '生成历史' : p.catalogKey ? '站点图库收藏' : '我的词库'}</span><button className="pc-card-title" onClick={() => setDetail(p)}><h3>{p.title}</h3></button><p className="pc-excerpt">{p.prompt}</p><div className="pc-tags">{p.tags.slice(0,4).map(t => <button key={t} onClick={() => setQuery(t)}>{t}</button>)}</div><div className="pc-card-actions"><button disabled={busy} onClick={() => copy(p)}><Copy size={14}/>复制提示词</button><button disabled={busy} onClick={() => use(p)}><Plus size={15}/>加入画布</button></div></div>
        </article>)}</div>
        {!filtered.length && <div className="pc-empty"><BookOpen size={38}/><h3>{cards.length ? '没有符合筛选条件的提示词' : '让已有作品成为你的灵感库'}</h3><p>{cards.length ? '尝试清除搜索或取消收藏筛选。' : '新版工作室的成功生成记录会自动显示图片和原始提示词。也可以上传已有图片，手动保存配套提示词。'}</p><button className="studio-secondary" onClick={() => cards.length ? (setQuery(''), setKind('all'), setCategory('all'), setFavorites(false)) : setEditing(blank())}>{cards.length ? '清除筛选' : '添加第一条提示词'}</button></div>}
        {filtered.length > limit && <button className="studio-secondary pc-load-more" onClick={() => setLimit(n => n + 60)}>加载更多（{limit}/{filtered.length}）</button>}
        <p className="pc-footnote">提示词来自本机生成历史、手动录入或你保存的公共图库条目。复制、收藏、加入画布均不发起生成、不产生 API 费用。资料包只包含文本和参数，导入后可重新绑定预览图。</p>
      </> : <>
        <div className="pc-heading"><div><span className="studio-eyebrow">LOCAL ASSETS</span><h2>为已有图片保存一份提示词</h2><p>原始提示词需要来自生成记录或由你填写，不会凭空从图片还原。</p></div></div>
        <div className="pc-card-grid">{snapshot.assets.slice(0,limit).map(a => <article className="pc-card" key={a.id}><div className="pc-local-cover"><Preview asset={a}/></div><div className="pc-card-body"><h3>{a.name}</h3><button className="studio-secondary" onClick={() => {
          const existing = cards.find(p => p.previewAssetId === a.id);
          if (existing) {setTab('prompts'); setCollection('personal'); setDetail(existing);} else setEditing(blank(a));
        }}><Sparkles size={15}/>{cards.some(p => p.previewAssetId === a.id) ? '查看关联提示词' : '添加配套提示词'}</button></div></article>)}</div>
        {!snapshot.assets.length && <div className="pc-empty"><ImagePlus size={38}/><h3>还没有本地素材</h3><button className="studio-secondary" onClick={() => setEditing(blank())}>上传图片并填写提示词</button></div>}
        {snapshot.assets.length > limit && <button className="studio-secondary pc-load-more" onClick={() => setLimit(n => n + 60)}>加载更多素材</button>}
      </>}
      {error && <p className="pc-error" role="alert">{error}</p>}
      {notice && <p className="pc-notice" role="status"><Check size={16}/>{notice}</p>}
      <input ref={packInput} hidden type="file" accept="application/json,.json" onChange={e => {
        const file = e.target.files?.[0]; e.target.value = '';
        if (file) void action(async () => {
          if (file.size > 4 * 1024 * 1024) throw Error('资料包最大 4 MB');
          const items = parsePromptPack(await file.text());
          if (!window.confirm(`导入 ${items.length} 条提示词文本？不会下载外部图片，也不会执行 API 请求。`)) return;
          await client.importPromptCards(items); await refresh(); setNotice('提示词已导入，可编辑并重新绑定本地预览图');
        });
      }}/>
    </div>
    {editing && <PromptEditor initial={editing} assets={snapshot.assets} refresh={refresh} onClose={() => setEditing(null)} onSaved={() => {setEditing(null); setNotice('提示词已保存在本地');}}/>}
    {activeDetail && <LibraryDialog title={activeDetail.title} onClose={() => setDetail(null)}><div className="pc-detail-preview"><Preview asset={assets.get(activeDetail.previewAssetId ?? '')} remoteURL={activeDetail.previewURL} large/></div><div className="pc-detail-meta"><span>{activeDetail.category}</span><span>{activeDetail.kind === 'video' ? '视频提示词' : '图片提示词'}</span><span>{activeDetail.author || '本地词库'}</span></div><label>完整提示词<textarea aria-label="完整提示词原文" className="pc-full-prompt" readOnly value={activeDetail.prompt} rows={7} onFocus={e => e.currentTarget.select()}/></label>
      <p className="pc-help">复制保留全部文字与换行。加入画布只创建提示词和生成节点，不自动提交任务，也不把预览图自动作为参考图发送。</p>
      {error && <p className="pc-error" role="alert">{error}</p>}{notice && <p role="status" className="pc-notice-inline">{notice}</p>}
      <div className="pc-detail-actions"><button className="studio-primary" disabled={busy} onClick={() => copy(activeDetail)}><Copy size={16}/>复制完整提示词</button><button className="studio-secondary" disabled={busy} onClick={() => use(activeDetail)}><Plus size={16}/>加入当前画布</button><button className="studio-secondary" disabled={busy} onClick={() => {setEditing(normalizePromptCard(activeDetail)); setDetail(null);}}><Pencil size={15}/>编辑</button>{activeDetail.sourceURL && <a className="pc-source-link" href={activeDetail.sourceURL} target="_blank" rel="noopener noreferrer">原始来源</a>}{activeDetail.id && <button className="pc-delete" disabled={busy} onClick={() => void action(async () => {if (!window.confirm(activeDetail.sourceJobId ? '删除保存的卡片设置？原始生成历史仍会显示，作品文件不会删除。' : '删除此提示词卡片？关联图片和画布不会删除。')) return; await client.deletePromptCard(activeDetail.id, activeDetail.revision); await refresh(); setDetail(null); setNotice('卡片已删除，素材与画布保持不变');})}><Trash2 size={15}/>{activeDetail.sourceJobId ? '还原历史卡片' : '删除卡片'}</button>}</div>
    </LibraryDialog>}
  </section>;
}
