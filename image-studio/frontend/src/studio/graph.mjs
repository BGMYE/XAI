// Pure geometry and graph operations, shared by the UI and node:test.
export const uid = () => globalThis.crypto.randomUUID().replaceAll('-', '');
export const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
export function zoomAt(view, point, zoom) {
  const next = clamp(zoom, .1, 4);
  return {x: point.x - (point.x - view.x) * next / view.zoom, y: point.y - (point.y - view.y) * next / view.zoom, zoom: next};
}
export function fitNodes(nodes, width, height) {
  if (!nodes.length) return {x: 70, y: 80, zoom: 1};
  const minX = Math.min(...nodes.map(n => n.x)), minY = Math.min(...nodes.map(n => n.y));
  const maxX = Math.max(...nodes.map(n => n.x + 248)), maxY = Math.max(...nodes.map(n => n.y + 235));
  const zoom = clamp(Math.min((width - 100) / Math.max(maxX - minX, 1), (height - 100) / Math.max(maxY - minY, 1)), .1, 1.25);
  return {x: (width - (maxX - minX) * zoom) / 2 - minX * zoom, y: (height - (maxY - minY) * zoom) / 2 - minY * zoom, zoom};
}
export function orderGraph(project) {
  if (!Array.isArray(project.nodes) || !Array.isArray(project.edges) || project.nodes.length > 2000 || project.edges.length > 4000) throw Error('画布大小无效');
  const v = project.viewport;
  if (!v || ![v.x, v.y, v.zoom].every(Number.isFinite) || v.zoom < .1 || v.zoom > 4) throw Error('视口无效');
  const nodes = new Map(), degree = new Map(), children = new Map();
  for (const n of project.nodes) {
    if (!/^[a-zA-Z0-9][\w-]{0,159}$/.test(n.id) || nodes.has(n.id)) throw Error('节点 ID 无效或重复');
    if (!['prompt', 'image', 'video', 'asset', 'note'].includes(n.kind)) throw Error('未知节点类型');
    if (![n.x, n.y].every(x => Number.isFinite(x) && Math.abs(x) <= 1e7)) throw Error('坐标无效');
    if (typeof n.title !== 'string' || n.title.length > 100 || typeof (n.text ?? '') !== 'string' || (n.text ?? '').length > 5000) throw Error('节点文字过长');
    nodes.set(n.id, n); degree.set(n.id, 0); children.set(n.id, []);
  }
  const ids = new Set(), pairs = new Set();
  for (const e of project.edges) {
    const pair = `${e.from}:${e.to}`;
    if (!/^[a-zA-Z0-9][\w-]{0,159}$/.test(e.id) || ids.has(e.id) || pairs.has(pair) || !nodes.has(e.from) || !nodes.has(e.to) || e.from === e.to) throw Error('连线无效、重复或悬空');
    if (!['image', 'video', 'asset'].includes(nodes.get(e.to).kind)) throw Error('目标需要是生成节点或结果节点');
    ids.add(e.id); pairs.add(pair); degree.set(e.to, degree.get(e.to) + 1); children.get(e.from).push(e.to);
  }
  const queue = [...degree].filter(([, d]) => !d).map(([id]) => id), result = [];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]; result.push(id);
    for (const to of children.get(id)) { degree.set(to, degree.get(to) - 1); if (!degree.get(to)) queue.push(to); }
  }
  if (result.length !== nodes.size) throw Error('不能创建循环工作流');
  return result;
}
export function connect(project, from, to) {
  const next = {...project, edges: [...project.edges, {id: uid(), from, to}]};
  orderGraph(next); return next;
}
export function removeNodes(project, ids) {
  const deleted = new Set(ids);
  return {...project, nodes: project.nodes.filter(n => !deleted.has(n.id)), edges: project.edges.filter(e => !deleted.has(e.from) && !deleted.has(e.to))};
}
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// Three-way merge: preserve backend-added results; never silently overwrite
// concurrent edits to the same field. A conflict leaves the user's draft intact.
export function mergeProject(base, local, remote) {
  const field = (b, l, r, label) => {
    if (equal(l, b)) return r;
    if (equal(r, b) || equal(l, r)) return l;
    throw Error(`画布保存冲突：${label}。请导出当前草稿，再重新载入。`);
  };
  const collection = (key) => {
    const bm = new Map(base[key].map(x => [x.id, x])), lm = new Map(local[key].map(x => [x.id, x])), rm = new Map(remote[key].map(x => [x.id, x]));
    return [...new Set([...rm.keys(), ...lm.keys(), ...bm.keys()])].flatMap(id => {
      const b = bm.get(id), l = lm.get(id), r = rm.get(id);
      if (!b || !l || !r) { const v = field(b, l, r, id); return v ? [v] : []; }
      const v = {};
      for (const name of new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(r)])) v[name] = field(b[name], l[name], r[name], `${id}.${name}`);
      return [v];
    });
  };
  const nodes = collection('nodes'), present = new Set(nodes.map(n => n.id));
  const merged = {...remote, name: field(base.name, local.name, remote.name, '名称'), viewport: field(base.viewport, local.viewport, remote.viewport, '视口'), nodes, edges: collection('edges').filter(e => present.has(e.from) && present.has(e.to))};
  orderGraph(merged); return merged;
}
export function exportTemplate(project) {
  return JSON.stringify({schemaVersion: 1, name: project.name, viewport: project.viewport, nodes: project.nodes.map(({id, kind, x, y, title, text, parameters}) => ({id, kind, x, y, title, text, parameters})), edges: project.edges}, null, 2);
}
export function importTemplate(text) {
  if (text.length > 2 * 1024 * 1024) throw Error('模板最大 2 MB');
  const input = JSON.parse(text);
  if (input.schemaVersion !== 1 || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 60 || !Array.isArray(input.nodes)) throw Error('不支持的工作流模板');
  // Allowlist data; no secrets, remote URLs, unknown properties or media IDs.
  const nodes = input.nodes.map(n => ({id: n.id, kind: n.kind, x: n.x, y: n.y, title: n.title, text: n.text ?? '', parameters: {size: typeof n.parameters?.size === 'string' ? n.parameters.size : undefined, seconds: Number.isInteger(n.parameters?.seconds) ? n.parameters.seconds : undefined, aspectRatio: typeof n.parameters?.aspectRatio === 'string' ? n.parameters.aspectRatio : undefined, resolution: typeof n.parameters?.resolution === 'string' ? n.parameters.resolution : undefined}}));
  const project = {id: uid(), name: input.name, revision: 0, updatedAt: '', viewport: input.viewport, nodes, edges: (input.edges ?? []).map(e => ({id: e.id, from: e.from, to: e.to}))};
  orderGraph(project); return project;
}
export function newProject(name = '未命名画布') {
  return {id: uid(), name, revision: 0, updatedAt: '', viewport: {x: 70, y: 80, zoom: 1}, nodes: [], edges: []};
}
