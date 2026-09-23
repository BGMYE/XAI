import {useEffect, useRef, useState, type ReactNode} from 'react';
import {ArrowDownToLine, ArrowRight, Bell, Box, Check, CheckCircle2, ChevronDown, Clock3, ExternalLink, FileImage, Folder, Home, ImagePlus, KeyRound, Layers3, Loader2, Maximize2, Minus, Monitor, Play, Plus, RefreshCw, Search, Settings2, ShieldCheck, Sparkles, Upload, Video, Workflow, X} from 'lucide-react';
import {Canvas} from './Canvas';
import {PromptCenter} from './PromptCenter';
import {addPromptToProject} from './promptLibrary.mjs';
import {client, downloadText, isDesktop, mediaURL} from './client';
import {exportTemplate, importTemplate, newProject, uid} from './graph.mjs';
import {useStudio} from './useStudio';
import type {Asset, Generation, Job, Kind, Parameters, Profile, Project, StudioNode, PromptCard} from './types';

type Page = 'home'|'create'|'works'|'assets'|'canvas'|'projects'|'history'|'settings';
const stateNames: Record<string,string> = {queued:'排队中',running:'生成中',paused:'已暂停',succeeded:'已完成',failed:'失败',cancelled:'已取消',uncertain:'需核对上游'};
const nav = [{id:'home',label:'首页',icon:Home},{id:'create',label:'创作',icon:Sparkles},{id:'works',label:'作品',icon:Folder},{id:'assets',label:'资源',icon:Box},{id:'projects',label:'工作流',icon:Workflow},{id:'history',label:'历史',icon:Clock3}] as const;
const blankProfile = (): Profile => ({id:'',name:'',baseUrl:'',protocol:'xai',imageModel:'',videoModel:'',hasKey:false,allowLocal:false,updatedAt:''});
const dateLabel = (s:string) => { const d=new Date(s); return Number.isNaN(d.getTime())?'':d.toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}); };

function Modal({title,children,onClose}:{title:string;children:ReactNode;onClose():void}) {
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{ref.current?.showModal();return()=>ref.current?.close();},[]);
  return <dialog ref={ref} className="studio-dialog" onCancel={onClose} onClick={e=>{if(e.target===e.currentTarget)onClose();}}><header><h2>{title}</h2><button aria-label="关闭对话框" onClick={onClose}><X size={20}/></button></header>{children}</dialog>;
}
function Mountain({id}:{id:string}) {
  return <svg viewBox="0 0 300 210" role="img" aria-label="创意山景插画"><defs><linearGradient id={`sky-${id}`} x2="0" y2="1"><stop stopColor="#5796d9"/><stop offset="1" stopColor="#d7edff"/></linearGradient><linearGradient id={`peak-${id}`} x2=".8" y2="1"><stop stopColor="#f9fcff"/><stop offset="1" stopColor="#87ade1"/></linearGradient></defs><rect width="300" height="210" fill={`url(#sky-${id})`}/><circle cx="231" cy="45" r="20" fill="#f8fcff" opacity=".9"/><path d="M-20 165 60 67 136 166 216 78 330 197Z" fill="#477eba"/><path d="M13 183 141 26 280 185Z" fill={`url(#peak-${id})`}/><path d="m141 26-17 88 40-20 43 46Z" fill="#4779ad"/><path d="m141 26-44 55 23-3 12 12 10-13 27 6Z" fill="#fff"/><path d="M0 166 Q100 149 300 171 V210 H0Z" fill="#a9d3f3"/><path d="M0 179 Q130 168 300 185" fill="none" stroke="#fff" strokeWidth="2" opacity=".5"/></svg>;
}
function HeroArt({professional=false}:{professional?:boolean}) {
  return <div className={`studio-hero-art ${professional?'professional':''}`} aria-hidden="true">{professional?<><svg className="studio-art-wires" viewBox="0 0 300 220"><path d="M22 58 C126 58 30 130 169 130 M49 178 C120 178 91 132 169 132"/></svg><div className="studio-mini-node one"><Sparkles size={13}/>提示词<span/></div><div className="studio-mini-node two"><ImagePlus size={13}/>参考图<span/></div><div className="studio-art-photo"><Mountain id="pro"/></div><div className="studio-mini-node three"><Video size={13}/>视频生成<ArrowRight size={13}/></div></>:<><div className="studio-art-photo back"><Mountain id="simple"/></div><div className="studio-orb-card"><div className="studio-crystal"/><small>IMAGINATION</small><Sparkles size={24}/></div><div className="studio-art-play"><Play size={21} fill="currentColor"/></div><span className="studio-art-caption">灵感，即刻呈现</span></>}</div>;
}
function AssetTile({asset,onOpen}:{asset:Asset;onOpen():void}) {
  const src=mediaURL(asset.id);
  return <button className="studio-asset-tile" onClick={onOpen}><div className="studio-asset-thumb">{src?(asset.kind==='video'?<><video src={src} preload="metadata" muted/><span className="studio-video-badge"><Play size={19}/></span></>:<img src={src} alt={asset.name} loading="lazy"/>):<FileImage size={35}/>}</div><strong>{asset.name}</strong><small>{asset.kind==='video'?'视频':'图片'} · {(asset.bytes/1024/1024).toFixed(1)} MB · {dateLabel(asset.createdAt)}</small></button>;
}

function ProviderForm({profile,onSave,onTest,report,disabled}:{profile?:Profile;onSave(p:Profile,k:string):Promise<void>;onTest(id:string):Promise<string[]>;report(e:unknown):void;disabled:boolean}) {
  const [draft,setDraft]=useState<Profile>(profile??blankProfile()),[key,setKey]=useState(''),[busy,setBusy]=useState(false),[models,setModels]=useState<string[]>([]);
  const patch=(p:Partial<Profile>)=>setDraft(x=>({...x,...p}));
  return <form className="studio-provider-form" onSubmit={async e=>{e.preventDefault();setBusy(true);try{await onSave(draft,key);setKey('');}catch(err){report(err);}finally{setBusy(false);}}}>
    <div className="studio-section-title"><h2>{profile?'编辑上游':'连接你的 AI 上游'}</h2><ShieldCheck size={23}/></div>
    <p className="studio-muted">密钥只写入系统凭据存储，不进入画布、模板或浏览器存储。图像与视频模型分别配置。</p>
    <div className="studio-form-row"><label>配置名称<input required maxLength={50} value={draft.name} onChange={e=>patch({name:e.target.value})} placeholder="例如：我的创作上游"/></label><label>接口协议<select value={draft.protocol} onChange={e=>patch({protocol:e.target.value as Profile['protocol']})}><option value="xai">xAI 协议</option><option value="openai">OpenAI 兼容协议</option></select></label></div>
    <label>Base URL（含 API 根路径）<input required type="url" value={draft.baseUrl} onChange={e=>patch({baseUrl:e.target.value})} placeholder={draft.protocol==='xai'?'https://api.x.ai/v1':'https://api.openai.com/v1'} autoComplete="off" spellCheck={false}/></label>
    <label>API Key<input type="password" autoComplete="new-password" value={key} onChange={e=>setKey(e.target.value)} placeholder={profile?.hasKey?'留空保留已保存的密钥':'输入你有权使用的 API Key'}/></label>
    <div className="studio-form-row"><label>图像模型 ID<input list="studio-model-list" value={draft.imageModel} onChange={e=>patch({imageModel:e.target.value})} placeholder="填写上游提供的图像模型 ID"/></label><label>视频模型 ID<input list="studio-model-list" value={draft.videoModel} onChange={e=>patch({videoModel:e.target.value})} placeholder="填写上游提供的视频模型 ID"/></label></div>
    <datalist id="studio-model-list">{models.map(m=><option key={m} value={m}/>)}</datalist>
    <label className="studio-checkbox"><input type="checkbox" checked={draft.allowLocal} onChange={e=>patch({allowLocal:e.target.checked})}/>允许本机回环地址（localhost / 127.0.0.1）</label>
    <div className="studio-callout">不会自动替换模型、猜测接口或反复重发收费请求。切换 Base URL 时需重新输入密钥。连接测试只读取模型列表，不发起生成。</div>
    {disabled&&<div className="studio-callout warning">浏览器为本地预览模式，不保存 API Key，也不代理上游生成。请使用桌面构建。</div>}
    <div className="studio-form-actions"><button className="studio-primary" type="submit" disabled={busy||disabled}>{busy?<Loader2 size={16} className="spin"/>:<KeyRound size={16}/>}保存配置</button><button className="studio-secondary" type="button" disabled={busy||disabled||!profile?.id} onClick={async()=>{if(!profile)return;setBusy(true);try{setModels(await onTest(profile.id));}catch(e){report(e);}finally{setBusy(false);}}}><RefreshCw size={16}/>测试已保存配置</button></div>
    {!!models.length&&<p className="studio-muted">已读取 {models.length} 个模型。可在模型输入框中选择；列表可见不代表每个模型都支持图像或视频。</p>}
  </form>;
}

export function StudioApp({isMac,onClassic}:{isMac:boolean;onClassic():void}) {
  const studio=useStudio();
  const [page,setPage]=useState<Page>('home'),[kind,setKind]=useState<Kind>('image'),[prompt,setPrompt]=useState(''),[parameters,setParameters]=useState<Parameters>({}),[referenceID,setReferenceID]=useState('');
  const [resourcesOpen,setResourcesOpen]=useState(false);
  const [profileID,setProfileID]=useState(''),[query,setQuery]=useState(''),[filter,setFilter]=useState<'all'|Kind>('all'),[viewAsset,setViewAsset]=useState<Asset|null>(null),[providerEdit,setProviderEdit]=useState<Profile|null|undefined>(undefined);
  const [busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  const busyRef=useRef(false),searchRef=useRef<HTMLInputElement>(null),imageInput=useRef<HTMLInputElement>(null),templateInput=useRef<HTMLInputElement>(null),importTarget=useRef<string|undefined>();
  const lastRequest=useRef<{signature:string;id:string}|null>(null),lastRun=useRef<{signature:string;id:string}|null>(null);
  const profile=studio.snapshot.profiles.find(p=>p.id===profileID)??studio.snapshot.profiles[0];
  const desktop=isDesktop();
  useEffect(()=>{if(!profileID&&studio.snapshot.profiles[0])setProfileID(studio.snapshot.profiles[0].id);},[profileID,studio.snapshot.profiles]);
  useEffect(()=>{const onKey=(e:KeyboardEvent)=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();searchRef.current?.focus();}};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);},[]);
  useEffect(()=>{if(!notice)return;const t=setTimeout(()=>setNotice(''),5000);return()=>clearTimeout(t);},[notice]);
  const runAction=async(action:()=>Promise<void>)=>{if(busyRef.current)return;busyRef.current=true;setBusy(true);try{await action();}catch(e){studio.report(e);}finally{busyRef.current=false;setBusy(false);}};
  const ensureProject=async()=>studio.project??await studio.create(newProject('我的创作画布'));
  const goCanvas=()=>void runAction(async()=>{await ensureProject();setPage('canvas');});
  const newCanvas=()=>void runAction(async()=>{await studio.create();setPage('canvas');});
  const askImage=(target?:string)=>{importTarget.current=target;imageInput.current?.click();};
  const importedImage=async(file:File)=>{
    const target=importTarget.current;
    await runAction(async()=>{
      const a=await client.importImage(file);await studio.refresh();setReferenceID(a.id);
      if(target){const p=studio.getProject(target);if(p){const v=p.viewport;const node:StudioNode={id:uid(),kind:'asset',title:a.name.slice(0,60),assetId:a.id,x:(220-v.x)/v.zoom,y:(160-v.y)/v.zoom,parameters:{}};studio.edit({...p,nodes:[...p.nodes,node]});await studio.flush(target);}}
      setNotice('参考图已保存在本地');
    });
  };
  const submit=()=>void runAction(async()=>{
    if(!desktop)throw Error('请在桌面应用中连接上游后生成；浏览器预览不会发送 API 请求。');
    if(!profile){setPage('settings');throw Error('请先连接你的上游。');}
    const p=await ensureProject();await studio.flush(p.id);
    const request:Generation={id:'',profileId:profile.id,projectId:p.id,kind,prompt,referenceAssetId:referenceID||undefined,parameters};
    const signature=JSON.stringify(request);if(lastRequest.current?.signature!==signature)lastRequest.current={signature,id:uid()};request.id=lastRequest.current.id;
    await client.submit(request);lastRequest.current=null;await studio.refresh();setNotice('任务已提交，结果将自动保存在当前画布');
  });
  const workflowRun=()=>void runAction(async()=>{
    if(!studio.project)return;if(!profile){setPage('settings');throw Error('请先配置上游和模型。');}
    const p=studio.project,count=p.nodes.filter(n=>n.kind==='image'||n.kind==='video').length;
    if(!count)throw Error('请先添加图片或视频生成节点。');
    if(!window.confirm(`将执行 ${count} 个生成节点，可能产生 ${count} 次上游 API 费用。继续运行？`))return;
    await studio.flush(p.id);const signature=JSON.stringify({project:p.id,profile:profile.id,nodes:p.nodes,edges:p.edges});
    if(lastRun.current?.signature!==signature)lastRun.current={signature,id:uid()};
    await client.run(p.id,profile.id,lastRun.current.id);lastRun.current=null;await studio.refresh();setNotice('工作流已进入队列，可在历史中查看进度');
  });
  const useLibraryPrompt = async (card: PromptCard) => {
    const target = await ensureProject();
    const current = studio.getProject(target.id) ?? target;
    const next = addPromptToProject(current, card);
    studio.edit(next);
    await studio.flush(next.id);
    setPage('canvas'); setResourcesOpen(false);
    setNotice('已添加提示词和生成节点；尚未发起 API 请求');
  };
  const nativeWindow=(method:string)=>{const runtime=(window as unknown as {runtime?:Record<string,()=>void>}).runtime;runtime?.[method]?.();};
  const generatedIDs=new Set(studio.snapshot.jobs.map(j=>j.resultAssetId).filter(Boolean));
  const relevantAssets=studio.snapshot.assets.filter(a=>page==='assets'||generatedIDs.has(a.id));
  const matches=(a:Asset)=>a.name.toLowerCase().includes(query.toLowerCase())||studio.snapshot.jobs.some(j=>j.resultAssetId===a.id&&j.request.prompt.toLowerCase().includes(query.toLowerCase()));
  const assets=relevantAssets.filter(a=>(filter==='all'||a.kind===filter)&&matches(a));
  const finished=studio.snapshot.jobs.filter(j=>j.state==='succeeded'),today=finished.filter(j=>new Date(j.updatedAt).toDateString()===new Date().toDateString()).length;
  const activeJobs=studio.snapshot.jobs.filter(j=>j.state==='running'||j.state==='queued');
  const completed=[Boolean(profile?.hasKey),finished.some(j=>j.request.kind==='image'),finished.some(j=>j.request.kind==='video'),studio.snapshot.projects.some(p=>p.nodes.some(n=>n.kind==='image'||n.kind==='video'))];
  const completeCount=completed.filter(Boolean).length;
  const gallery=(items:Asset[],limit?:number)=><div className="studio-gallery">{items.slice(0,limit??items.length).map(a=><AssetTile key={a.id} asset={a} onOpen={()=>setViewAsset(a)}/>)}</div>;
  const jobsPanel=(jobs:Job[])=><div className="studio-job-list">{jobs.map(j=><article className="studio-job" key={j.id}><div className={`studio-job-icon ${j.request.kind}`}>{j.request.kind==='video'?<Video size={21}/>:<ImagePlus size={21}/>}</div><div className="studio-job-detail"><div className="studio-section-title"><strong>{j.request.kind==='video'?'视频生成':'图像生成'}</strong><span className={`studio-status ${j.state}`}>{stateNames[j.state]}</span></div><p>{j.request.prompt}</p><small>{j.profile.name||'上游'} · {dateLabel(j.createdAt)}</small>{j.state==='running'&&<progress max={100} value={j.progress} aria-label="上游报告的生成进度"/>}{j.error&&<p className="studio-job-error">{j.error}</p>}{j.remoteId&&<small>远端任务：{j.remoteId}</small>}<div className="studio-job-actions">{['queued','running','paused'].includes(j.state)&&<button onClick={()=>void runAction(async()=>{await client.cancel(j.id);await studio.refresh();})}>停止本地任务</button>}{j.state==='paused'&&<button onClick={()=>void runAction(async()=>{await client.resume(j.id);await studio.refresh();})}>恢复任务</button>}{j.resultAssetId&&<button onClick={()=>{const a=studio.snapshot.assets.find(a=>a.id===j.resultAssetId);if(a)setViewAsset(a);}}>查看作品</button>}<button onClick={()=>{setPrompt(j.request.prompt);setKind(j.request.kind);setParameters(j.request.parameters);setReferenceID(j.request.referenceAssetId??'');setPage('create');}}>复用参数</button></div></div></article>)}</div>;

  return <div className={`studio-app ${isMac?'is-mac':''}`}>
    <div className="studio-ambient" aria-hidden="true"><i/><i/><i/></div>
    <header className="studio-topbar"><button className="studio-brand" onClick={()=>setPage('home')}><b>XAI</b><span>Image Studio</span><small>更自由地创造</small></button>
      <form className="studio-search" onSubmit={e=>{e.preventDefault();setPage('works');}}><Search size={17}/><input ref={searchRef} value={query} onChange={e=>setQuery(e.target.value)} aria-label="搜索作品、提示词" placeholder="搜索作品、提示词…"/><kbd>{isMac?'⌘':'Ctrl'} K</kbd></form>
      <div className="studio-mode-switch"><button className={page!=='canvas'?'active':''} onClick={()=>{setPage('create');}}>简洁模式</button><button className={page==='canvas'?'active':''} onClick={goCanvas}>专业模式</button></div>
      <button className="studio-notifications" title="任务历史" onClick={()=>setPage('history')}><Bell size={21}/>{activeJobs.length>0&&<i/>}</button><div className="studio-account"><span>✦</span><div>本地工作室<small>{desktop?'桌面端':'浏览器预览'}</small></div><ChevronDown size={13}/></div>
      {!isMac&&<div className="studio-window-controls"><button disabled={!desktop} title="最小化" onClick={()=>nativeWindow('WindowMinimise')}><Minus size={15}/></button><button disabled={!desktop} title="最大化或还原" onClick={()=>nativeWindow('WindowToggleMaximise')}><Maximize2 size={13}/></button><button disabled={!desktop} title="关闭应用" onClick={()=>nativeWindow('Quit')}><X size={16}/></button></div>}
    </header>
    <nav className="studio-sidebar" aria-label="主导航"><div>{nav.map(n=><button key={n.id} className={(n.id==='assets'&&page==='canvas'&&resourcesOpen)||page===n.id||(n.id==='projects'&&page==='canvas'&&!resourcesOpen)?'active':''} onClick={()=>{if(n.id==='assets'&&page==='canvas'){setResourcesOpen(v=>!v);}else{setResourcesOpen(false);setPage(n.id);}}}><n.icon size={21}/><span>{n.label}</span></button>)}</div><div className="studio-sidebar-bottom"><button onClick={()=>{void runAction(async()=>{for(const p of studio.snapshot.projects)await studio.flush(p.id);onClassic();});}} title="保留原有图像编辑与 Responses API 功能"><Monitor size={20}/><span>经典编辑</span></button><button className={page==='settings'?'active':''} onClick={()=>setPage('settings')}><Settings2 size={21}/><span>设置</span></button><footer><b>XAI</b><span>From Imagination<br/>to Everything</span></footer></div></nav>
    <main className={`studio-main ${page==='canvas'?'canvas-page':''}`}>
      {page==='home'?<>
        <section className="studio-welcome"><div><span className="studio-eyebrow">YOUR CREATIVE SPACE</span><h1>用 AI，创造无限可能</h1><p>从灵感到作品，XAI 与你一起，让想象力触手可及。</p></div><span className="studio-welcome-note">想象 · 探索 · 创造 · 分享<small>From Imagination to Everything</small></span></section>
        <section className="studio-mode-cards"><article className="studio-mode-card"><div className="studio-mode-copy"><h2>简洁模式 <span>快速创作</span></h2><p>专注创作，简单高效<br/>一站式完成图片与视频生成。</p><button className="studio-secondary" onClick={()=>setPage('create')}>立即开始 <ArrowRight size={19}/></button></div><HeroArt/></article><article className="studio-mode-card"><div className="studio-mode-copy"><h2>专业模式 <span>深度控制</span></h2><p>节点式工作流 · 无限画布<br/>精细参数 · 专业创作工具。</p><button className="studio-primary" onClick={goCanvas}>进入专业模式 <ArrowRight size={19}/></button></div><HeroArt professional/></article></section>
        <div className="studio-section-title"><h3>快捷操作</h3><button onClick={()=>setPage('projects')}>更多工具 <ArrowRight size={12}/></button></div>
        <section className="studio-quick-grid">{[{title:'生成图片',detail:<>从文字或参考图<br/>生成精美图片</>,Icon:ImagePlus,action:()=>{setKind('image');setPage('create');}},{title:'生成视频',detail:<>让创意动起来<br/>使用视频 API 生成</>,Icon:Play,action:()=>{setKind('video');setPage('create');}},{title:'最近项目',detail:<>继续创作<br/>打开最近的画布</>,Icon:Folder,action:()=>setPage('projects')},{title:'新建工作流',detail:<>从空白画布开始<br/>搭建专属工作流</>,Icon:Workflow,action:newCanvas},{title:'导入参考图',detail:<>上传本地图片<br/>作为创作参考</>,Icon:Upload,action:()=>askImage()}].map(q=><button key={q.title} onClick={q.action}><span className="studio-quick-icon"><q.Icon size={24}/></span><span><strong>{q.title}</strong><small>{q.detail}</small></span></button>)}</section>
        <div className="studio-section-title studio-recent-heading"><h3>最近作品</h3><div className="studio-filter">{(['all','image','video']as const).map(f=><button key={f} className={filter===f?'active':''} onClick={()=>setFilter(f)}>{f==='all'?'全部':f==='image'?'图片':'视频'}</button>)}</div><button onClick={()=>setPage('works')}>查看全部 <ArrowRight size={12}/></button></div>
        {assets.length?gallery(assets,5):<section className="studio-empty-works"><div className="studio-empty-icon"><ImagePlus size={29}/></div><div><strong>你的第一份灵感，即将在这里呈现</strong><p>这里展示真实生成的作品，不包含示例图片或虚构使用记录。</p></div><button className="studio-secondary" onClick={()=>setPage('create')}>开始创作 <ArrowRight size={16}/></button></section>}
        <div className="studio-local-note"><ShieldCheck size={14}/>项目与素材保存在本机，只有生成时选定的提示词和参考图会发送到你配置的上游。</div>
      </>:page==='canvas'?<>
        <div className="studio-page-heading compact"><div><span className="studio-eyebrow">PRO WORKSPACE</span><h1>无限画布</h1></div><div className="studio-form-actions"><button className="studio-secondary pc-open-button" aria-expanded={resourcesOpen} onClick={()=>setResourcesOpen(v=>!v)}><Layers3 size={16}/>资源 · 提示词</button><span className="studio-muted">{studio.saving?'正在保存…':studio.conflicted?'保存冲突':'自动保存'}</span><select aria-label="选择画布" value={studio.activeID} onChange={e=>studio.setActiveID(e.target.value)}>{studio.snapshot.projects.map(p=><option key={p.id} value={p.id}>{studio.getProject(p.id)?.name??p.name}</option>)}</select><button className="studio-secondary" onClick={newCanvas}><Plus size={16}/>新建</button></div></div>
        {studio.project?<Canvas project={studio.project} assets={studio.snapshot.assets} onChange={studio.edit} onRun={workflowRun} onImport={()=>askImage(studio.activeID)} report={studio.report} running={busy}/>:<div className="studio-empty-panel"><Workflow size={42}/><h2>一个画布，无限可能</h2><button className="studio-primary" onClick={newCanvas}>新建画布</button></div>}
      {resourcesOpen&&<PromptCenter snapshot={studio.snapshot} refresh={studio.refresh} onUse={useLibraryPrompt} onClose={()=>setResourcesOpen(false)}/>}
      </>:page==='create'?<>
        <div className="studio-page-heading"><div><span className="studio-eyebrow">MAKE SOMETHING WONDERFUL</span><h1>把想象，变成作品</h1><p>专注灵感，让创作自然发生。</p></div><button className="studio-secondary" onClick={goCanvas}><Workflow size={16}/>打开专业画布</button></div>
        <div className="studio-create-layout"><form className="studio-generation-form" onSubmit={e=>{e.preventDefault();submit();}}><div className="studio-tabs"><button type="button" className={kind==='image'?'active':''} onClick={()=>{setKind('image');setParameters({});}}><ImagePlus size={18}/>生成图片</button><button type="button" className={kind==='video'?'active':''} onClick={()=>{setKind('video');setParameters({});}}><Video size={18}/>生成视频</button></div>
          <label>创作描述<textarea required maxLength={5000} rows={7} value={prompt} onChange={e=>setPrompt(e.target.value)} placeholder={kind==='video'?'描述场景、动作、镜头运动与光影变化…':'描述主体、场景、构图、光线和细节…'}/></label>
          <label>使用上游<select value={profile?.id??''} onChange={e=>{setProfileID(e.target.value);setParameters({});}}><option value="" disabled>请先连接上游</option>{studio.snapshot.profiles.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <div className="studio-form-row"><label>参考图片<select value={referenceID} onChange={e=>setReferenceID(e.target.value)}><option value="">无参考图</option>{studio.snapshot.assets.filter(a=>a.kind==='image').map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label><button type="button" className="studio-secondary" onClick={()=>askImage()}><Upload size={16}/>导入参考图</button></div>
          {profile?.protocol==='openai'?<label>输出尺寸<input value={parameters.size??''} placeholder={kind==='video'?'1280x720（留空由上游决定）':'1024x1024（留空由上游决定）'} onChange={e=>setParameters(p=>({...p,size:e.target.value}))}/></label>:<div className="studio-form-row"><label>画面比例<select value={parameters.aspectRatio??''} onChange={e=>setParameters(p=>({...p,aspectRatio:e.target.value}))}><option value="">上游默认</option>{['16:9','9:16','1:1','4:3','3:4','3:2','2:3'].map(x=><option key={x}>{x}</option>)}</select></label>{kind==='video'&&<label>视频分辨率<select value={parameters.resolution??''} onChange={e=>setParameters(p=>({...p,resolution:e.target.value}))}><option value="">上游默认</option>{['480p','720p','1080p'].map(x=><option key={x}>{x}</option>)}</select></label>}</div>}
          {kind==='video'&&<label>视频时长<select value={parameters.seconds??''} onChange={e=>setParameters(p=>({...p,seconds:e.target.value?Number(e.target.value):undefined}))}><option value="">上游默认</option>{(profile?.protocol==='openai'?[4,8,12]:Array.from({length:15},(_,i)=>i+1)).map(s=><option value={s} key={s}>{s} 秒</option>)}</select></label>}
          <label>结果画布<select value={studio.activeID} onChange={e=>studio.setActiveID(e.target.value)}><option value="">自动创建创作画布</option>{studio.snapshot.projects.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select></label>
          <button className="studio-primary full" disabled={busy||!studio.ready} type="submit">{busy?<Loader2 size={18} className="spin"/>:<Sparkles size={18}/>}生成{kind==='image'?'图片':'视频'} <ArrowRight size={18}/></button><small>使用你配置的 {kind==='video'?(profile?.videoModel||'视频模型'):(profile?.imageModel||'图像模型')}；费用与生成能力由上游决定。</small>
        </form><section className="studio-generation-results"><div className="studio-section-title"><h3>创作动态</h3><span>{activeJobs.length} 个进行中</span></div>{studio.snapshot.jobs.length?jobsPanel(studio.snapshot.jobs.slice(0,8)):<div className="studio-empty-panel"><Sparkles size={44}/><h3>一切，从一个想法开始</h3><p>写下提示词并提交，图片与视频会自动加入结果画布。</p></div>}</section></div>
      </>:page==='assets'?<PromptCenter snapshot={studio.snapshot} refresh={studio.refresh} onUse={useLibraryPrompt}/>:page==='works'?<>
        <div className="studio-page-heading"><div><span className="studio-eyebrow">YOUR CREATIVE LIBRARY</span><h1>我的作品</h1><p>每一个灵感，都值得被珍藏。</p></div><button className="studio-primary" onClick={()=>askImage()}><Upload size={16}/>导入图片</button></div><div className="studio-section-title"><div className="studio-filter">{(['all','image','video']as const).map(f=><button key={f} className={filter===f?'active':''} onClick={()=>setFilter(f)}>{f==='all'?'全部':f==='image'?'图片':'视频'}</button>)}</div><span>{assets.length} 项{query?` · 搜索“${query}”`:''}</span></div>{assets.length?gallery(assets):<div className="studio-empty-panel"><Folder size={46}/><h2>{query?'没有匹配的作品':'这里还没有作品'}</h2><p>生成或导入你的第一张图片，开始建立创作资料库。</p></div>}
      </>:page==='projects'?<>
        <div className="studio-page-heading"><div><span className="studio-eyebrow">CONNECTED IDEAS</span><h1>你的工作流</h1><p>把创作步骤连接起来，复用你的灵感。</p></div><div className="studio-form-actions"><button className="studio-secondary" onClick={()=>templateInput.current?.click()}><Upload size={16}/>导入模板</button><button className="studio-primary" onClick={newCanvas}><Plus size={17}/>新建画布</button></div></div><div className="studio-project-grid">{studio.snapshot.projects.map(p=><button className="studio-project-card" key={p.id} onClick={()=>{studio.setActiveID(p.id);setPage('canvas');}}><div className="studio-project-art"><Workflow size={43}/><span>{p.nodes.length} NODES</span></div><h3>{studio.getProject(p.id)?.name??p.name}</h3><p>{p.nodes.length} 个节点 · {p.edges.length} 条连线</p><small>{dateLabel(p.updatedAt)} <ArrowRight size={15}/></small></button>)}<button className="studio-project-new" onClick={newCanvas}><Plus size={30}/><strong>开始新的创作</strong><span>无限画布，从这里展开</span></button></div><div className="studio-callout">模板只包含节点、连线与参数，不包含 API Key 和本地媒体文件。导入后请重新绑定素材；实际运行前会校验整个工作流。</div>
      </>:page==='history'?<>
        <div className="studio-page-heading"><div><span className="studio-eyebrow">CREATIVE JOURNEY</span><h1>任务历史</h1><p>真实状态、可恢复的查询、明确的失败原因。</p></div><button className="studio-secondary" onClick={()=>void studio.refresh()}><RefreshCw size={16}/>刷新</button></div>{studio.snapshot.jobs.length?jobsPanel(studio.snapshot.jobs):<div className="studio-empty-panel"><Clock3 size={45}/><h2>还没有生成任务</h2><p>任务提交后将在这里展示，不会在启动时自动生成。</p></div>}
      </>:<>
        <div className="studio-page-heading"><div><span className="studio-eyebrow">BUILT AROUND YOU</span><h1>工作室设置</h1><p>你的模型、你的密钥、你的创作方式。</p></div><button className="studio-primary" onClick={()=>setProviderEdit(null)}><Plus size={17}/>添加上游</button></div>
        <div className="studio-settings-grid"><section><div className="studio-section-title"><h3>上游连接</h3><span>{studio.snapshot.profiles.length} 个配置</span></div>{studio.snapshot.profiles.map(p=><article className="studio-provider-card" key={p.id}><KeyRound size={23}/><div><h3>{p.name}</h3><p>{p.baseUrl}</p><small>{p.protocol==='xai'?'xAI':'OpenAI 兼容'} · {p.hasKey?'密钥已保存':'缺少密钥'} · {p.verifiedAt?'已验证模型列表':'未测试'}</small><div className="studio-job-actions"><button onClick={()=>setProviderEdit(p)}>编辑配置</button><button onClick={()=>void runAction(async()=>{await client.testProfile(p.id);await studio.refresh();setNotice('已验证模型列表连接，不代表所有生成参数可用');})}>测试连接</button><button onClick={()=>void runAction(async()=>{if(window.confirm(`删除上游“${p.name}”及其保存的密钥？`)){await client.deleteProfile(p.id);await studio.refresh();}})}>删除</button></div></div></article>)}{!studio.snapshot.profiles.length&&<ProviderForm disabled={!desktop} onSave={async(p,k)=>{const saved=await client.saveProfile(p,k);setProfileID(saved.id);await studio.refresh();setNotice('上游已保存');}} onTest={async id=>{const names=await client.testProfile(id);await studio.refresh();return names;}} report={studio.report}/>}</section><aside className="studio-settings-note"><ShieldCheck size={31}/><h3>本地优先，边界清晰</h3><p>API Key 存入操作系统凭据库。画布与任务元数据、下载后的作品存入独立的 studio-v2 数据目录。</p><p>浏览器预览仅在 IndexedDB 保存画布和导入图片，不保存密钥、不生成虚假结果。</p><p>旧项目与旧上游配置保持原样，可通过左侧「经典编辑」访问。新版采用独立存储，不覆盖旧数据。</p><button className="studio-secondary" onClick={onClassic}><Monitor size={16}/>打开经典编辑器</button></aside></div>
      </>}
    </main>
    {page!=='canvas'&&<aside className="studio-right-rail"><section className="studio-model-panel"><div className="studio-section-title"><h3>当前模型 <span>/ 连接状态</span></h3><span className={`studio-connection ${profile?.verifiedAt?'verified':''}`}><i/>{profile?.verifiedAt?'已验证':'未测试'}</span></div><button className="studio-model-button" onClick={()=>setPage('settings')}><span className="studio-model-logo">Λ</span><div><strong>{profile?.imageModel||'连接你的 AI 模型'}</strong><small>{profile?.name||'使用自己的 API Key'}</small></div><ChevronDown size={14}/></button><div className="studio-capabilities"><span>文本生图</span><span>参考图生成</span><span>视频生成</span></div><div className="studio-stats"><div><small>已完成任务</small><strong>{finished.length.toLocaleString()}</strong></div><div><small>今日完成</small><strong>{today}</strong></div><div><small>工作空间</small><strong>本地</strong></div></div></section>
      <section className="studio-guide"><div className="studio-section-title"><h3>新手引导</h3><span>{completeCount}/4</span></div><progress max={4} value={completeCount} aria-label="新手引导完成进度"/><p>完成以下步骤，快速开启你的创作之旅</p><div className="studio-guide-steps">{[{title:'连接上游模型',detail:'选择并配置你喜欢的 AI 模型',action:()=>setPage('settings')},{title:'生成你的第一张图片',detail:'尝试用简单的文字描述创作',action:()=>{setKind('image');setPage('create');}},{title:'尝试生成一段视频',detail:'体验视频生成的能力',action:()=>{setKind('video');setPage('create');}},{title:'探索专业模式',detail:'了解工作流与更多高级功能',action:goCanvas}].map((s,i)=><button key={s.title} className={completed[i]?'complete':''} onClick={s.action}><span className="studio-guide-check">{completed[i]&&<Check size={13}/>}</span><span><strong>{s.title}</strong><small>{s.detail}</small></span></button>)}</div><button className="studio-primary full" onClick={()=>setPage('create')}>开始创作 <ArrowRight size={18}/></button><button className="studio-text-button" onClick={()=>setPage('projects')}>探索工作流 <ExternalLink size={12}/></button></section>
      {!desktop&&<div className="studio-preview-note"><Monitor size={15}/><span>本地交互预览<br/><small>生成服务需桌面应用</small></span></div>}
    </aside>}
    <input hidden ref={imageInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)void importedImage(f);}}/>
    <input hidden ref={templateInput} type="file" accept="application/json,.json" onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)void runAction(async()=>{if(f.size>2*1024*1024)throw Error('模板最大 2 MB');const p=importTemplate(await f.text());await studio.create(p);setPage('canvas');setNotice('模板已导入，请重新绑定本地素材');});}}/>
    {studio.error&&<div className="studio-error-banner" role="alert"><div><strong>需要处理</strong><p>{studio.error}</p></div>{studio.project&&<><button onClick={()=>downloadText(exportTemplate(studio.project!),'xai-unsaved-draft.json')}>导出草稿</button><button onClick={()=>{if(window.confirm('重新载入会丢弃未保存的草稿。已导出需要保留的内容吗？'))void studio.reload(studio.activeID).catch(studio.report);}}>重新载入</button></>}<button aria-label="关闭错误提示" onClick={()=>studio.setError('')}><X size={17}/></button></div>}
    {notice&&<div className="studio-toast" role="status"><CheckCircle2 size={18}/>{notice}</div>}
    {viewAsset&&<Modal title={viewAsset.name} onClose={()=>setViewAsset(null)}><div className="studio-media-viewer">{viewAsset.kind==='video'?<video src={mediaURL(viewAsset.id)} controls autoPlay/>:<img src={mediaURL(viewAsset.id)} alt={viewAsset.name}/>}</div><div className="studio-form-actions"><button className="studio-primary" onClick={()=>void runAction(async()=>{if(await client.saveAsset(viewAsset.id))setNotice('作品已保存');})}><ArrowDownToLine size={17}/>保存作品</button>{viewAsset.kind==='image'&&<button className="studio-secondary" onClick={()=>{setReferenceID(viewAsset.id);setViewAsset(null);setPage('create');}}>用作参考图</button>}</div></Modal>}
    {providerEdit!==undefined&&<Modal title={providerEdit?'编辑上游':'添加上游'} onClose={()=>setProviderEdit(undefined)}><ProviderForm key={providerEdit?.id??'new'} profile={providerEdit??undefined} disabled={!desktop} onSave={async(p,k)=>{const saved=await client.saveProfile(p,k);setProfileID(saved.id);await studio.refresh();setProviderEdit(undefined);setNotice('上游已安全保存');}} onTest={async id=>{const names=await client.testProfile(id);await studio.refresh();return names;}} report={studio.report}/></Modal>}
  </div>;
}
