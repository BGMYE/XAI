import {useEffect,useMemo,useRef,useState} from 'react';
import {Copy,ExternalLink,ImagePlus,Plus,RefreshCw,Search,X} from 'lucide-react';
import {CATALOG_SOURCES, safePublicURL, type PublicPrompt} from './publicCatalog.mjs';
import {loadCatalog, type CatalogResult} from './catalogCache';
import {client} from './client';
import {copyPromptText} from './clipboard';
import {filterPromptCards,normalizePromptCard} from './promptLibrary.mjs';
import type {PromptCard,Snapshot} from './types';

export function SourcePreview({url,title}:{url?:string;title:string}){
  const [broken,setBroken]=useState(false);
  useEffect(()=>setBroken(false),[url]);
  let safe='';try{safe=safePublicURL(url,true);}catch{/* Never render untrusted URLs. */}
  if(!safe||broken)return <div className="pc-preview-empty"><ImagePlus size={32}/><span>{broken?'原站图片暂不可用，提示词仍可复制':'原条目暂无预览图'}</span></div>;
  return <img src={safe} alt={title} loading="lazy" decoding="async" referrerPolicy="no-referrer" draggable={false} onError={()=>setBroken(true)}/>;
}
function SourceDialog({card,onClose,onCopy,onUse,onSave,busy,message}:{card:PublicPrompt;onClose():void;onCopy():void;onUse():void;onSave():void;busy:boolean;message:string}){
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const d=ref.current;d?.showModal();return()=>d?.close();},[]);
  return <dialog ref={ref} className="studio-dialog pc-dialog" onCancel={onClose} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
    <header><h2>{card.title}</h2><button aria-label="关闭图库详情" onClick={onClose}><X size={20}/></button></header>
    <div className="pc-detail-preview"><SourcePreview url={card.previewURL} title={card.title}/></div>
    <div className="pc-detail-meta"><span>{card.category}</span><span>{card.author||'上游未署名'}</span><span>{card.imageMode==='edit'?'图像编辑提示词':'图像生成提示词'}</span></div>
    <label>完整提示词原文<textarea aria-label="图库完整提示词" readOnly rows={8} value={card.prompt}/></label>
    {Boolean(card.referenceImageURLs?.length)&&<details><summary>查看原条目的参考图（{card.referenceImageURLs!.length}）</summary><div className="pc-reference-grid">{card.referenceImageURLs!.map(u=><a key={u} href={u} target="_blank" rel="noopener noreferrer"><SourcePreview url={u} title="原条目参考图"/></a>)}</div></details>}
    <p className="pc-help">保留原作者的正文与图片配对；预览图不是自动生成的参考输入。加入画布不会发起生成，参考图需显式导入。{card.imageModel&&`原条目标注模型：${card.imageModel}（不会自动替换你的模型）。`}</p>
    {card.sourceURL&&<a className="pc-source-link" href={card.sourceURL} target="_blank" rel="noopener noreferrer">查看原始来源 <ExternalLink size={13}/></a>}
    {message&&<p role="status" className="pc-notice-inline">{message}</p>}
    <div className="pc-detail-actions"><button className="studio-primary" disabled={busy} onClick={onCopy}><Copy size={15}/>复制完整提示词</button><button className="studio-secondary" disabled={busy} onClick={onSave}><Plus size={15}/>加入我的资源</button><button className="studio-secondary" disabled={busy} onClick={onUse}><Plus size={15}/>加入当前画布</button></div>
  </dialog>;
}
export function PublicCatalog({snapshot,refresh,onUse}:{snapshot:Snapshot;refresh():Promise<void>;onUse(card:PromptCard):Promise<void>}){
  const [results,setResults]=useState<Record<string,CatalogResult>>({}),[loading,setLoading]=useState(false);
  const [query,setQuery]=useState(''),[source,setSource]=useState('all'),[limit,setLimit]=useState(24);
  const [detail,setDetail]=useState<PublicPrompt|null>(null),[message,setMessage]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const mounted=useRef(false),fetching=useRef(false),lock=useRef(false);
  const reload=async(force=false)=>{
    if(fetching.current)return;fetching.current=true;setLoading(true);let next=0;
    // Bounded parallelism, stable source ordering, per-source errors and cache.
    const worker=async()=>{for(;;){const s=CATALOG_SOURCES[next++];if(!s)break;const result=await loadCatalog(s.id,force);if(mounted.current)setResults(old=>({...old,[s.id]:result}));}};
    try{await Promise.all([worker(),worker(),worker()]);}finally{fetching.current=false;if(mounted.current)setLoading(false);}
  };
  useEffect(()=>{mounted.current=true;void reload();return()=>{mounted.current=false;};},[]);
  useEffect(()=>setLimit(24),[query,source]);
  const cards=useMemo(()=>CATALOG_SOURCES.flatMap(s=>results[s.id]?.cards??[]),[results]);
  const filtered=useMemo(()=>filterPromptCards(cards.filter(p=>source==='all'||p.sourceID===source),{query}) as PublicPrompt[],[cards,source,query]);
  const errors=CATALOG_SOURCES.filter(s=>results[s.id]?.error),savedKeys=new Set((snapshot.promptCards??[]).map(p=>p.catalogKey).filter(Boolean));
  const action=async(fn:()=>Promise<void>)=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');setMessage('');try{await fn();}catch(e){if(mounted.current)setError(String(e instanceof Error?e.message:e));}finally{lock.current=false;if(mounted.current)setBusy(false);}};
  const copy=(p:PublicPrompt)=>void action(async()=>{await copyPromptText(p.prompt);setMessage(`已复制「${p.title}」的完整原文`);});
  const save=(p:PublicPrompt)=>void action(async()=>{
    if(savedKeys.has(p.catalogKey)){setMessage('此条目已在我的资源中，不重复创建');return;}
    await client.savePromptCard(normalizePromptCard(p));await refresh();setMessage('已加入我的资源：原文、作者、图片和参考图链接已关联保存');
  });
  const use=(p:PublicPrompt)=>void action(async()=>{await onUse(p);setDetail(null);});
  return <div className="pc-public-catalog" aria-label="站点同源提示词图库">
    <div className="pc-heading"><div><span className="studio-eyebrow">VISUAL PROMPT DISCOVERY</span><h2>看见好图，复制好灵感</h2><p>与参考站使用相同的公开图库 · 原始图片与提示词逐条关联</p></div><div className="pc-count"><b>{cards.length.toLocaleString()}</b><span>{loading?'正在加载…':'条已加载提示词'}</span></div></div>
    <div className="pc-source-note">来源：参考站的 7 个公开数据源。图片由原站托管，浏览时会连接原图服务；不会发送你的 API Key、项目或生成历史。作者与素材权利归原来源所有。</div>
    <div className="pc-search-row"><label className="pc-search"><Search size={18}/><input aria-label="搜索站点图库" value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索标题、提示词、标签或作者…"/></label><button className="studio-secondary" disabled={loading} onClick={()=>void reload(true)}><RefreshCw size={15}/>{loading?'正在同步':'刷新图库'}</button></div>
    <div className="pc-filters"><label>图库来源<select aria-label="选择图库来源" value={source} onChange={e=>setSource(e.target.value)}><option value="all">全部来源</option>{CATALOG_SOURCES.map(s=><option key={s.id} value={s.id}>{s.name} · {results[s.id]?.cards.length??'…'}</option>)}</select></label><span>{filtered.length} 条结果</span></div>
    {!!errors.length&&<details className="pc-source-warning"><summary>{errors.length} 个来源有加载提示；可用的旧缓存和已保存提示词不会被清空</summary>{errors.map(s=><p key={s.id}>{s.name}：{results[s.id].error} {results[s.id].fetchedAt&&`（缓存：${new Date(results[s.id].fetchedAt).toLocaleString()}）`}</p>)}</details>}
    {Object.values(results).some(r=>r.rejected||r.blockedLinks)&&<p className="pc-help">部分上游记录或链接未通过安全校验，已跳过或隐藏；其余条目保持原始配对。</p>}
    <div className="pc-card-grid pc-public-grid">{filtered.slice(0,limit).map(p=><article className="pc-card" key={p.catalogKey} data-catalog-key={p.catalogKey}>
      <div className="pc-card-cover"><button className="pc-cover-button" aria-label={`查看图库提示词：${p.title}`} onClick={()=>{setMessage('');setError('');setDetail(p);}}><SourcePreview url={p.previewURL} title={p.title}/></button></div>
      <div className="pc-card-body"><button className="pc-card-title" onClick={()=>setDetail(p)}><h3>{p.title}</h3></button><p className="pc-excerpt">{p.prompt}</p><div className="pc-tags">{p.tags.map((t,i)=><button key={`${i}:${t}`} onClick={()=>setQuery(t)}>{t}</button>)}</div><span className="pc-category">{p.author||'原作者未署名'} · {p.category}</span>
        <div className="pc-card-actions"><button disabled={busy} onClick={()=>copy(p)}><Copy size={14}/>复制</button><button disabled={busy||savedKeys.has(p.catalogKey)} onClick={()=>save(p)}><Plus size={14}/>{savedKeys.has(p.catalogKey)?'已加入我的资源':'加入我的资源'}</button></div>
      </div></article>)}</div>
    {!filtered.length&&<div className="pc-empty"><ImagePlus size={38}/><h3>{loading?'正在读取公开提示词图库…':cards.length?'没有符合搜索条件的条目':'暂时无法读取站点图库'}</h3><p>{cards.length?'可以清除筛选条件。':'联网后点击刷新；也可以在“我的资源”中使用本地卡片，不以示例图冒充原站图片。'}</p></div>}
    {filtered.length>limit&&<button className="studio-secondary pc-load-more" onClick={()=>setLimit(n=>n+24)}>加载更多（{limit}/{filtered.length}）</button>}
    {error&&<p className="pc-error" role="alert">{error}</p>}{message&&<p className="pc-notice" role="status">{message}</p>}
    <p className="pc-footnote">“加入我的资源”保存原文和图片链接，不自动下载外部图片；已加载的目录保留本地缓存，原图离线时可能不可见。复制和加入画布不会发起收费生成。</p>
    {detail&&<SourceDialog card={detail} onClose={()=>setDetail(null)} onCopy={()=>copy(detail)} onSave={()=>save(detail)} onUse={()=>use(detail)} busy={busy} message={error||message}/>}
  </div>;
}
