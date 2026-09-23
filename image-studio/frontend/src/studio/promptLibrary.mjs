import {orderGraph, uid} from './graph.mjs';
import {catalogMetadata} from './publicCatalog.mjs';

const bytes = value => new TextEncoder().encode(value).length;
const idPattern = /^[a-zA-Z0-9][\w-]{0,159}$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, max, label, fallback = '') => {
  const result = value ?? fallback;
  if (typeof result !== 'string' || bytes(result) > max) throw Error(`${label}格式无效或过长`);
  return result;
};
export function normalizePromptCard(input) {
  if (!object(input)) throw Error('提示词记录格式无效');
  const id = text(input.id, 160, '标识');
  const revision = input.revision ?? 0;
  if ((id && !idPattern.test(id)) || !Number.isSafeInteger(revision) || revision < 0) throw Error('提示词版本无效');
  const title = text(input.title, 200, '标题').trim();
  const prompt = text(input.prompt, 16000, '提示词'); // Never trim/collapse the actual prompt.
  if (!title || !prompt.trim()) throw Error('请填写标题和完整提示词');
  if (!['image', 'video'].includes(input.kind)) throw Error('提示词用途必须是图片或视频');
  const previewAssetId = text(input.previewAssetId, 160, '预览素材');
  const sourceJobId = text(input.sourceJobId, 160, '来源任务');
  if ([previewAssetId, sourceJobId].some(id => id && !idPattern.test(id))) throw Error('素材或任务标识无效');
  const rawTags = input.tags ?? [];
  if (!Array.isArray(rawTags) || rawTags.length > 12) throw Error('最多 12 个标签');
  const tags = [...new Set(rawTags.map(t => text(t, 256, '标签').trim()).filter(Boolean))];
  const raw = input.parameters ?? {};
  if (!object(raw)) throw Error('生成参数格式无效');
  const parameters = {};
  for (const [name, limit] of [['size', 30], ['aspectRatio', 10], ['resolution', 10]]) {
    const v = text(raw[name], limit, '生成参数'); if (v) parameters[name] = v;
  }
  if (raw.seconds !== undefined && raw.seconds !== 0) {
    if (!Number.isInteger(raw.seconds) || raw.seconds < 1 || raw.seconds > 120) throw Error('视频时长无效');
    parameters.seconds = raw.seconds;
  }
  return {...catalogMetadata(input), id, revision, title, prompt, kind: input.kind, previewAssetId, sourceJobId,
    category: text(input.category, 100, '分类').trim() || '未分类', tags,
    author: text(input.author, 160, '作者').trim(), favorite: input.favorite === true, parameters,
    createdAt: text(input.createdAt, 100, '创建时间'), updatedAt: text(input.updatedAt, 100, '修改时间')};
}

// Read actual successful generation history; no fake examples or remote scraping.
export function collectPromptCards(snapshot) {
  const assets = new Map(snapshot.assets.map(a => [a.id, a]));
  const saved = (snapshot.promptCards ?? []).map(p => ({...p, key: p.id, origin: 'saved'}));
  const overrides = new Set(saved.map(p => p.sourceJobId).filter(Boolean));
  const history = snapshot.jobs.flatMap(j => {
    const asset = assets.get(j.resultAssetId);
    if (j.state !== 'succeeded' || !asset || !j.request.prompt?.trim() || overrides.has(j.id)) return [];
    return [{id: '', key: `history:${j.id}`, revision: 0, title: asset.name || '我的创作',
      prompt: j.request.prompt, kind: j.request.kind, previewAssetId: asset.id, sourceJobId: j.id,
      category: '生成历史', tags: [], author: '我的创作', parameters: j.request.parameters ?? {},
      favorite: false, createdAt: j.createdAt, updatedAt: j.updatedAt, origin: 'history'}];
  });
  return [...saved, ...history].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.key.localeCompare(b.key));
}
export function filterPromptCards(cards, {query = '', kind = 'all', category = 'all', favorites = false} = {}) {
  const normalize = s => s.normalize('NFKC').toLocaleLowerCase();
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  return cards.filter(p => (kind === 'all' || p.kind === kind) && (category === 'all' || p.category === category)
    && (!favorites || p.favorite) && terms.every(t => normalize([p.title, p.prompt, p.category, p.author, ...(p.tags ?? [])].join('\n')).includes(t)));
}
function assertReferences(snapshot, p) {
  if (p.catalogKey && (snapshot.promptCards ?? []).some(c => c.catalogKey === p.catalogKey && c.id !== p.id)) throw Error('prompt revision conflict：此图库条目已加入我的资源，请刷新');
  if (p.previewAssetId && !snapshot.assets.some(a => a.id === p.previewAssetId && ['image','video'].includes(a.kind))) throw Error('预览素材不存在，请先导入图片');
  if (p.sourceJobId) {
    const j = snapshot.jobs.find(j => j.id === p.sourceJobId);
    if (!j || j.state !== 'succeeded' || j.resultAssetId !== p.previewAssetId || j.request.kind !== p.kind) throw Error('来源不是匹配的已完成生成任务');
    if ((snapshot.promptCards ?? []).some(c => c.sourceJobId === p.sourceJobId && c.id !== p.id)) throw Error('prompt revision conflict：请刷新后重试');
  }
}
export function savePromptToSnapshot(snapshot, raw) {
  const p = normalizePromptCard(raw), cards = snapshot.promptCards ?? [];
  const old = cards.find(c => c.id === p.id);
  if ((old?.revision ?? 0) !== p.revision) throw Error('prompt revision conflict：请刷新后重试');
  if (!old && cards.length >= 5000) throw Error('提示词数量达到 5000 条上限');
  assertReferences(snapshot, p);
  const timestamp = new Date().toISOString();
  const saved = {...p, id: p.id || uid(), revision: p.revision + 1, createdAt: old?.createdAt ?? timestamp, updatedAt: timestamp};
  return {saved, snapshot: {...snapshot, promptCards: [saved, ...cards.filter(c => c.id !== saved.id)]}};
}
export function removePromptFromSnapshot(snapshot, id, revision) {
  const cards = snapshot.promptCards ?? [], card = cards.find(c => c.id === id);
  if (!card) throw Error('提示词不存在');
  if (card.revision !== revision) throw Error('prompt revision conflict：请刷新后重试');
  return {...snapshot, promptCards: cards.filter(c => c.id !== id)};
}
function portable(p) {
  // Explicit allowlist: no host address, API Key, credentials, paths, job IDs or local asset IDs.
  return {title: p.title, prompt: p.prompt, kind: p.kind, category: p.category, tags: p.tags,
    author: p.author, parameters: p.parameters};
}
export function exportPromptPack(cards) {
  if (!cards.length || cards.length > 200) throw Error('每次导出需为 1–200 条，请缩小筛选范围');
  const items = cards.map(p => portable(normalizePromptCard(p)));
  return JSON.stringify({format: 'xai.prompt-pack', version: 1, items}, null, 2);
}
export function parsePromptPack(raw) {
  if (typeof raw !== 'string' || bytes(raw) > 4 * 1024 * 1024) throw Error('提示词资料包最大 4 MB');
  const input = JSON.parse(raw);
  if (!object(input) || input.format !== 'xai.prompt-pack' || input.version !== 1
      || !Array.isArray(input.items) || input.items.length < 1 || input.items.length > 200) throw Error('不支持的提示词资料包（每次 1–200 条）');
  return input.items.map(item => normalizePromptCard({...portable(item ?? {}), id: '', revision: 0}));
}
export function importPromptsToSnapshot(snapshot, input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 200) throw Error('每次导入需为 1–200 条');
  const clean = input.map(p => normalizePromptCard({...portable(p), id: '', revision: 0}));
  if ((snapshot.promptCards?.length ?? 0) + clean.length > 5000) throw Error('导入后将超过 5000 条上限');
  let next = snapshot; const saved = [];
  for (const p of clean) {const result = savePromptToSnapshot(next, p); next = result.snapshot; saved.push(result.saved);}
  return {snapshot: next, saved};
}
export function addPromptToProject(project, raw) {
  const p = normalizePromptCard(raw);
  if (p.prompt.length > 5000) throw Error('当前画布节点最多 5000 字符；原文可完整复制，不会自动截断');
  if (project.nodes.length > 1998 || project.edges.length > 3999) throw Error('当前画布节点或连线已接近上限');
  const view = project.viewport;
  const x = (150 - view.x) / view.zoom;
  let y = (180 - view.y) / view.zoom;
  while (project.nodes.some(n => n.x < x + 590 && n.x + 248 > x && n.y < y + 235 && n.y + 235 > y)) y += 270;
  const source = {id: uid(), kind: 'prompt', title: p.title.slice(0,60), text: p.prompt, x, y, parameters: {}};
  const generator = {id: uid(), kind: p.kind, title: p.kind === 'video' ? '视频生成' : '图像生成', text: '', x: x + 330, y, parameters: {...p.parameters}};
  // The preview is NOT silently used as a paid generation reference.
  const result = {...project, nodes: [...project.nodes, source, generator], edges: [...project.edges, {id: uid(), from: source.id, to: generator.id}]};
  orderGraph(result); return result;
}
