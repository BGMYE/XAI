import {get, set} from 'idb-keyval';
import type {Asset, Generation, Job, Profile, Project, Snapshot, PromptCard} from './types';
import {emptySnapshot} from './types';
import {catalogURL} from './publicCatalog.mjs';
import {orderGraph, uid} from './graph.mjs';
import {savePromptToSnapshot, removePromptFromSnapshot, importPromptsToSnapshot} from './promptLibrary.mjs';
interface Host {
  GetPublicPromptCatalog?(sourceID: string): Promise<string>;
  GetSnapshot(): Promise<Snapshot>;
  SavePromptCard?(p: PromptCard): Promise<PromptCard>;
  DeletePromptCard?(id: string, revision: number): Promise<void>;
  ImportPromptCards?(cards: PromptCard[]): Promise<PromptCard[]>;
  SaveAsset(id: string): Promise<boolean>;
  SaveProfile(profile: Profile, key: string): Promise<Profile>;
  DeleteProfile(id: string): Promise<void>;
  TestProfile(id: string): Promise<string[]>;
  SaveProject(project: Project): Promise<Project>;
  SubmitGeneration(request: Generation): Promise<Job>;
  RunWorkflow(projectID: string, profileID: string, runID: string): Promise<Job[]>;
  CancelJob(id: string): Promise<void>;
  ResumeJob(id: string): Promise<void>;
  ImportImage(dataURL: string, name: string): Promise<Asset>;
}
const host = () => (window as unknown as {go?: {backend?: {StudioV2?: Host}}}).go?.backend?.StudioV2;
export const isDesktop = () => Boolean(host());
const previewKey = 'xai-studio-v2-browser-preview';
const urls = new Map<string, string>();
let serial = Promise.resolve<unknown>(undefined);
function transaction<T>(fn: () => Promise<T>): Promise<T> {
  const result = serial.then(fn, fn); serial = result.catch(() => undefined); return result;
}
async function preview(): Promise<Snapshot> {
  return (await get<Snapshot>(previewKey)) ?? emptySnapshot();
}
function unavailable(): never { throw Error('浏览器仅提供本地画布预览。请在桌面应用中配置 API Key 并生成作品。'); }
export const client = {
  async publicCatalog(sourceID: string): Promise<string> {
    const url = catalogURL(sourceID), desktop = host();
    if (desktop) {
      if (!desktop.GetPublicPromptCatalog) throw Error('请同步更新桌面后端以启用公共图库');
      return desktop.GetPublicPromptCatalog(sourceID);
    }
    const response = await fetch(url, {credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', signal: AbortSignal.timeout(25000)});
    if (!response.ok || Number(response.headers.get('Content-Length') ?? 0) > 8*1024*1024) throw Error('公共图库暂不可用或响应过大');
    if (!response.body) throw Error('公共图库响应为空');
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
    try {
      for (;;) {const {done,value} = await reader.read(); if(done) break; bytes += value.byteLength;
        if (bytes > 8*1024*1024) {await reader.cancel(); throw Error('图库响应超过 8 MB');} chunks.push(value);}
    } finally {reader.releaseLock();}
    const data = new Uint8Array(bytes); let offset=0;
    for (const chunk of chunks) {data.set(chunk,offset); offset+=chunk.byteLength;}
    return new TextDecoder('utf-8',{fatal:true}).decode(data);
  },
  async savePromptCard(p: PromptCard): Promise<PromptCard> {
    const desktop = host();
    if (desktop) {if (!desktop.SavePromptCard) throw Error('请更新桌面后端以启用提示词中心'); return desktop.SavePromptCard(p);}
    return transaction(async () => {const result = savePromptToSnapshot(await preview(), p); await set(previewKey, result.snapshot); return result.saved;});
  },
  async deletePromptCard(id: string, revision: number): Promise<void> {
    const desktop = host();
    if (desktop) {if (!desktop.DeletePromptCard) throw Error('请更新桌面后端以启用提示词中心'); return desktop.DeletePromptCard(id, revision);}
    return transaction(async () => {await set(previewKey, removePromptFromSnapshot(await preview(), id, revision));});
  },
  async importPromptCards(cards: PromptCard[]): Promise<PromptCard[]> {
    const desktop = host();
    if (desktop) {if (!desktop.ImportPromptCards) throw Error('请更新桌面后端以启用提示词中心'); return desktop.ImportPromptCards(cards);}
    return transaction(async () => {const result = importPromptsToSnapshot(await preview(), cards); await set(previewKey, result.snapshot); return result.saved;});
  },
  async saveAsset(id: string) { if (host()) return host()!.SaveAsset(id); const a = document.createElement("a"); a.href=mediaURL(id); a.download="xai-asset"; a.click(); return true; },
  async snapshot(): Promise<Snapshot> {
    if (host()) return host()!.GetSnapshot();
    const s = await preview();
    await Promise.all(s.assets.map(async a => { if (!urls.has(a.id)) { const blob = await get<Blob>(`${previewKey}:asset:${a.id}`); if (blob) urls.set(a.id, URL.createObjectURL(blob)); } }));
    return s;
  },
  async saveProject(p: Project): Promise<Project> {
    orderGraph(p);
    if (host()) return host()!.SaveProject(p);
    return transaction(async () => {
      const s = await preview(), old = s.projects.find(x => x.id === p.id);
      if ((old?.revision ?? 0) !== p.revision) throw Error('revision conflict');
      const saved = {...p, revision: p.revision + 1, updatedAt: new Date().toISOString()};
      s.projects = [saved, ...s.projects.filter(x => x.id !== p.id)]; await set(previewKey, s); return saved;
    });
  },
  async saveProfile(p: Profile, key: string) { return host() ? host()!.SaveProfile(p, key) : unavailable(); },
  async deleteProfile(id: string) { return host() ? host()!.DeleteProfile(id) : unavailable(); },
  async testProfile(id: string) { return host() ? host()!.TestProfile(id) : unavailable(); },
  async submit(r: Generation) { return host() ? host()!.SubmitGeneration(r) : unavailable(); },
  async run(project: string, profile: string, id: string) { return host() ? host()!.RunWorkflow(project, profile, id) : unavailable(); },
  async cancel(id: string) { return host() ? host()!.CancelJob(id) : unavailable(); },
  async resume(id: string) { return host() ? host()!.ResumeJob(id) : unavailable(); },
  async importImage(file: File): Promise<Asset> {
    if (file.size > 20 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) throw Error('请选择不超过 20 MB 的 PNG、JPEG、WebP 或 GIF 图片');
    const data = await new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(Error('图片读取失败')); r.readAsDataURL(file); });
    if (host()) return host()!.ImportImage(data, file.name);
    // Preview imports stay in IndexedDB; never silently upload a file.
    const a: Asset = {id: uid(), kind: 'image', name: file.name, mime: file.type, bytes: file.size, createdAt: new Date().toISOString(), fileName: ''};
    await transaction(async () => { const s = await preview(); await set(`${previewKey}:asset:${a.id}`, file); s.assets.unshift(a); await set(previewKey, s); });
    urls.set(a.id, URL.createObjectURL(file)); return a;
  },
};
export function mediaURL(id: string): string { return isDesktop() ? `/studio-media/${encodeURIComponent(id)}` : urls.get(id) ?? ''; }
export function downloadText(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], {type: 'application/json'}));
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
