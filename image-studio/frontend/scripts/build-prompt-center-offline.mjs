// Build only for offline component testing, not for the application distribution.
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await build({absWorkingDir:root,entryPoints:['test/fixtures/prompt-center-offline.tsx'],outfile:'studio-evidence/prompt-center-offline.js',bundle:true,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},loader:{'.css':'empty'},plugins:[{
 name:'offline-media-adapter',setup(builder){builder.onLoad({filter:/src\/studio\/client\.ts$/},async ({path:filename})=>{
  let contents=await readFile(filename,'utf8');
  const original="export function mediaURL(id: string): string { return isDesktop() ? `/studio-media/${encodeURIComponent(id)}` : urls.get(id) ?? ''; }";
  if(!contents.includes(original))throw Error('Media adapter changed; update offline harness explicitly');
  contents=contents.replace(original,"export function mediaURL(id: string): string { return (window as any).__promptFixture.media.get(id) ?? ''; }");
  return {contents,loader:'ts'};
 });}
}]});
