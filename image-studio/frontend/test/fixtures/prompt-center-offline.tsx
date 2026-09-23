// Offline UI harness: actual StudioApp/components, in-memory Wails/media boundary.
// This does not claim to test native WebView, OS clipboard or real API providers.
import React from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {StudioApp} from '../../src/studio/StudioApp';
import {emptySnapshot, type PromptCard, type Project, type Snapshot} from '../../src/studio/types';
import {orderGraph, uid} from '../../src/studio/graph.mjs';
import {savePromptToSnapshot, removePromptFromSnapshot, importPromptsToSnapshot} from '../../src/studio/promptLibrary.mjs';
if (!globalThis.crypto.randomUUID) Object.defineProperty(globalThis.crypto,'randomUUID',{value: () => [...crypto.getRandomValues(new Uint8Array(16))].map(b=>b.toString(16).padStart(2,'0')).join('')});
let db: Snapshot = emptySnapshot();
let root: Root;
const media = new Map<string,string>();
const fixture = {copied: '', clipboardFail: false, paidCalls: 0, writeFail: false, media,
  snapshot: () => structuredClone(db),
  remount: () => {root.unmount(); mount();}};
Object.assign(window, {__promptFixture: fixture,
  runtime: {ClipboardSetText: async (value: string) => {if(fixture.clipboardFail)return false;fixture.copied=value;return true;}},
  go: {backend: {StudioV2: {
    GetPublicPromptCatalog: async (sourceID:string) => {const fixture = (window as any).__catalogFixture; if(fixture?.fail) throw Error("测试断网"); return fixture?.sources[sourceID] ?? "[]";},
    GetSnapshot: async () => structuredClone(db),
    SaveProject: async (p: Project) => {if(fixture.writeFail)throw Error('模拟磁盘失败'); orderGraph(p);const old=db.projects.find(x=>x.id===p.id);if((old?.revision??0)!==p.revision)throw Error('revision conflict');const saved={...structuredClone(p),revision:p.revision+1,updatedAt:new Date().toISOString()};db.projects=[saved,...db.projects.filter(x=>x.id!==p.id)];return structuredClone(saved);},
    SavePromptCard: async (p: PromptCard) => {if(fixture.writeFail)throw Error('模拟磁盘失败');const r=savePromptToSnapshot(db,p);db=r.snapshot;return structuredClone(r.saved);},
    DeletePromptCard: async (id:string,revision:number) => {db=removePromptFromSnapshot(db,id,revision);},
    ImportPromptCards: async (cards:PromptCard[]) => {const r=importPromptsToSnapshot(db,cards);db=r.snapshot;return structuredClone(r.saved);},
    ImportImage: async (data:string,name:string) => {const mime=data.slice(5,data.indexOf(';'));const a={id:uid(),kind:'image' as const,name,mime,bytes:atob(data.split(',')[1]).length,createdAt:new Date().toISOString(),fileName:''};db.assets.unshift(a);media.set(a.id,data);return a;},
    SubmitGeneration: async () => {fixture.paidCalls++;throw Error('Tests may not generate');},
    RunWorkflow: async () => {fixture.paidCalls++;throw Error('Tests may not generate');},
  }}}
});
function mount(){root=createRoot(document.getElementById('root')!);root.render(<React.StrictMode><StudioApp isMac={false} onClassic={()=>{throw Error('Not a classic-editor test');}}/></React.StrictMode>);}
mount();
