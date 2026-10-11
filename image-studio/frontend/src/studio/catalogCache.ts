import {get,set} from 'idb-keyval';
import {client} from './client';
import {parseCatalog, type PublicPrompt} from './publicCatalog.mjs';
export interface CatalogResult {cards: PublicPrompt[]; fetchedAt: string; stale: boolean; error?: string; rejected: number; blockedLinks: number}
const inflight = new Map<string,Promise<CatalogResult>>();
const memory = new Map<string,{raw:string; fetchedAt:string}>();
const prefix = 'xai-public-catalog-v1:';
// Last-good cache is independent of generation history and API-key storage.
export async function loadCatalog(id:string,force=false):Promise<CatalogResult>{
  if(inflight.has(id)) return inflight.get(id)!;
  const task = (async()=>{
    let cached=memory.get(id);
    if(!cached) {try {cached=await get<{raw:string;fetchedAt:string}>(prefix+id);}catch{/* Private browsing may deny IndexedDB. */}}
    let previous:CatalogResult|undefined;
    if(cached) {try{previous={...parseCatalog(cached.raw,id),fetchedAt:cached.fetchedAt,stale:false};}catch{cached=undefined;}}
    if(!force&&previous&&Date.now()-Date.parse(previous.fetchedAt)<6*60*60*1000) return previous;
    try {
      const raw=await client.publicCatalog(id), parsed=parseCatalog(raw,id), fetchedAt=new Date().toISOString();
      memory.set(id,{raw,fetchedAt});let warning='';
      try{await set(prefix+id,{raw,fetchedAt});}catch{warning='本次图库已加载，但本机缓存不可用';}
      return {...parsed,fetchedAt,stale:false,error:warning||undefined};
    }catch(e){
      const error=String(e instanceof Error?e.message:e);
      if(previous)return {...previous,stale:true,error};
      return {cards:[],fetchedAt:'',stale:true,error,rejected:0,blockedLinks:0};
    }
  })();
  inflight.set(id,task);
  try{return await task;}finally{inflight.delete(id);}
}
