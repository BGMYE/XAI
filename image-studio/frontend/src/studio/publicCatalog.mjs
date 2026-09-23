// The exact public feeds configured by canvas-test.pqai.cc/prompts.
// Data stays attributable to its original authors; no keys or model requests here.
export const CATALOG_BASE = 'https://raw.githubusercontent.com/yukkcat/image-prompts/main/dist/sources';
export const CATALOG_SOURCES = Object.freeze([
  {id: 'banana-prompt-quicker', name: 'Banana Prompt Quicker'},
  {id: 'davidwu-gpt-image2-prompts', name: 'DavidWu GPT Image 2'},
  {id: 'freestylefly-gpt-image-2', name: 'Freestylefly GPT Image 2'},
  {id: 'awesome-gpt-image', name: 'Awesome GPT Image'},
  {id: 'awesome-gpt4o-image-prompts', name: 'Awesome GPT-4o'},
  {id: 'youmind-gpt-image-2', name: 'YouMind GPT Image 2'},
  {id: 'youmind-nano-banana-pro', name: 'YouMind Nano Banana Pro'},
]);
const imageHosts = new Set(['raw.githubusercontent.com', 'cdn.jsdelivr.net', 'cms-assets.youmind.com',
  'pbs.twimg.com', 'cdn.imgedify.com', 'camo.githubusercontent.com', 'github.com', 'linux.do',
  'i.mji.rip', 'storage.googleapis.com']);
export function catalogURL(id) {
  if (!CATALOG_SOURCES.some(s => s.id === id)) throw Error('未知的公共图库来源');
  return `${CATALOG_BASE}/${id}.json`;
}
export function safePublicURL(value, image = false) {
  if (!value) return '';
  if (typeof value !== 'string' || value.length > 8192) throw Error('来源链接无效');
  const u = new URL(value);
  if (u.protocol !== 'https:' || u.username || u.password || u.port
      || !/^[a-z0-9.-]+$/i.test(u.hostname) || !u.hostname.includes('.')
      || /(^|\.)(localhost|local|internal|test|invalid)$/.test(u.hostname)
      || /^\d+(\.\d+)*$/.test(u.hostname)) throw Error('来源仅允许公开 HTTPS 链接');
  if (image && !imageHosts.has(u.hostname)) throw Error('预览图片来源未在允许列表中');
  return value; // Keep the actual source URL, not a substituted or generated image.
}
export function catalogKeyValid(key) {
  return typeof key === 'string' && CATALOG_SOURCES.some(s => key.startsWith(`${s.id}:`))
    && /^[a-zA-Z0-9_-]+:[a-zA-Z0-9_-]{1,120}$/.test(key);
}
export function catalogMetadata(input) {
  const catalogKey = input.catalogKey ?? '';
  if (catalogKey && !catalogKeyValid(catalogKey)) throw Error('图库来源标识无效');
  const refs = input.referenceImageURLs ?? [];
  if (!Array.isArray(refs) || refs.length > 8) throw Error('参考图链接过多');
  return {catalogKey, previewURL: safePublicURL(input.previewURL, true), sourceURL: safePublicURL(input.sourceURL),
    referenceImageURLs: refs.map(u => safePublicURL(u, true)).filter(Boolean)};
}
// A malformed record cannot change another record's image/prompt association.
// Invalid links lose their clickable preview rather than changing the prompt.
export function parseCatalog(text, sourceID) {
  catalogURL(sourceID);
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > 8 * 1024 * 1024) throw Error('图库响应超过 8 MB');
  const rows = JSON.parse(text);
  if (!Array.isArray(rows) || rows.length > 5000) throw Error('公共图库格式无效');
  const cards = [], seen = new Set(); let rejected = 0, blockedLinks = 0;
  const bounded = (v, max) => typeof v === 'string' && new TextEncoder().encode(v).length <= max;
  const link = (u, image) => {try {return safePublicURL(u, image);} catch {blockedLinks++; return '';}};
  for (const row of rows) {
    if (!row || row.sourceId !== sourceID || !catalogKeyValid(row.id) || !row.id.startsWith(`${sourceID}:`) || seen.has(row.id)
        || !bounded(row.title, 200) || !row.title.trim() || !bounded(row.prompt, 16000) || !row.prompt.trim()
        || !Array.isArray(row.tags) || row.tags.length > 12 || row.tags.some(t => !bounded(t, 256))
        || (row.author != null && !bounded(row.author, 160)) || !Array.isArray(row.referenceImageUrls) || row.referenceImageUrls.length > 8) {
      rejected++; continue;
    }
    seen.add(row.id);
    cards.push({id: '', revision: 0, catalogKey: row.id, title: row.title, prompt: row.prompt, kind: 'image',
      previewURL: link(row.coverUrl, true), sourceURL: link(row.sourceUrl, false),
      referenceImageURLs: row.referenceImageUrls.map(u => link(u, true)).filter(Boolean),
      category: CATALOG_SOURCES.find(s => s.id === sourceID).name, tags: row.tags, author: row.author || '',
      parameters: {}, favorite: false, createdAt: '', updatedAt: '',
      sourceID, imageMode: row.imageMode === 'edit' ? 'edit' : 'generate', imageModel: typeof row.imageModel === 'string' ? row.imageModel.slice(0,200) : ''});
  }
  if (rows.length && !cards.length) throw Error('图库没有可用记录；未覆盖上次缓存');
  return {cards, rejected, blockedLinks};
}
