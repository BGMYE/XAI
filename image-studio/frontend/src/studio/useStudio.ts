import {useCallback, useEffect, useRef, useState} from 'react';
import {client} from './client';
import {mergeProject, newProject, orderGraph} from './graph.mjs';
import {emptySnapshot, type Project, type Snapshot} from './types';
type Draft = {base: Project; local: Project};
const same = (a: Project, b: Project) => JSON.stringify(a) === JSON.stringify(b);
export function useStudio() {
  const [snapshot, setSnapshot] = useState<Snapshot>(emptySnapshot);
  const [activeID, setActiveID] = useState('');
  const [version, bump] = useState(0);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const drafts = useRef(new Map<string, Draft>());
  const pending = useRef(new Map<string, Promise<void>>());
  const conflicts = useRef(new Set<string>());
  const failedSaves = useRef(new Set<string>());
  const fetching = useRef(false);
  const alive = useRef(true);
  const report = useCallback((e: unknown) => { if (alive.current) setError(String(e instanceof Error ? e.message : e)); }, []);
  const accept = useCallback((s: Snapshot) => {
    for (const remote of s.projects) {
      const d = drafts.current.get(remote.id);
      if (!d) drafts.current.set(remote.id, {base: remote, local: remote});
      else if (!pending.current.has(remote.id) && !conflicts.current.has(remote.id) && remote.revision > d.base.revision) {
        try { d.local = mergeProject(d.base, d.local, remote); d.base = remote; }
        catch (e) { conflicts.current.add(remote.id); report(e); }
      }
    }
    if (alive.current) { setSnapshot(s); setReady(true); setActiveID(id => id || s.projects[0]?.id || ''); bump(n => n + 1); }
  }, [report]);
  const refresh = useCallback(async () => {
    if (fetching.current) return;
    fetching.current = true;
    try { accept(await client.snapshot()); } catch (e) { report(e); }
    finally { fetching.current = false; }
  }, [accept, report]);
  useEffect(() => {
    alive.current = true; void refresh();
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 2500);
    const unload = (e: BeforeUnloadEvent) => { if ([...drafts.current.values()].some(d => !same(d.base, d.local))) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', unload);
    return () => { alive.current = false; clearInterval(timer); window.removeEventListener('beforeunload', unload); };
  }, [refresh]);
  const flush = useCallback((id: string): Promise<void> => {
    if (pending.current.has(id)) return pending.current.get(id)!;
    const task = (async () => {
      if (conflicts.current.has(id)) throw Error('当前画布存在冲突，请先导出草稿并重新载入。');
      if (alive.current) setSaving(true);
      let retries = 0;
      for (;;) {
        const d = drafts.current.get(id);
        if (!d || same(d.base, d.local)) return;
        const sent = structuredClone(d.local);
        try {
          const saved = await client.saveProject(sent);
          // Edits made while saving remain dirty and are saved next.
          d.local = mergeProject(sent, d.local, saved); d.base = saved;
          retries = 0;
        } catch (e) {
          if (String(e).includes('revision conflict') && retries++ < 3) {
            const s = await client.snapshot(), remote = s.projects.find(p => p.id === id);
            if (!remote) throw e;
            try { d.local = mergeProject(d.base, d.local, remote); d.base = remote; }
            catch (conflict) { conflicts.current.add(id); throw conflict; }
          } else throw e;
        }
      }
    })();
    pending.current.set(id, task);
    void task.catch(e => {failedSaves.current.add(id); report(e);}).finally(() => {
      pending.current.delete(id);
      if (alive.current) { setSaving(pending.current.size > 0); bump(n => n + 1); }
    });
    return task;
  }, [report]);
  useEffect(() => {
    const timer = setTimeout(() => {
      for (const [id,d] of drafts.current) if (!same(d.base,d.local) && !conflicts.current.has(id) && !pending.current.has(id) && !failedSaves.current.has(id)) void flush(id).catch(() => undefined);
    }, 700);
    return () => clearTimeout(timer);
  }, [version, flush]);
  const edit = useCallback((p: Project) => {
    try { orderGraph(p); const d = drafts.current.get(p.id); if (d) { d.local = {...p, revision: d.base.revision}; failedSaves.current.delete(p.id); bump(n => n + 1); } }
    catch (e) { report(e); }
  }, [report]);
  const create = useCallback(async (input?: Project) => {
    const p = await client.saveProject(input ?? newProject());
    drafts.current.set(p.id, {base: p, local: p}); setActiveID(p.id); bump(n => n + 1); await refresh(); return p;
  }, [refresh]);
  const reload = useCallback(async (id: string) => {
    if (pending.current.has(id)) await pending.current.get(id)?.catch(() => undefined);
    const s = await client.snapshot(), p = s.projects.find(x => x.id === id);
    if (p) { drafts.current.set(id,{base:p,local:p}); conflicts.current.delete(id); failedSaves.current.delete(id); accept(s); setError(''); }
  }, [accept]);
  const project = drafts.current.get(activeID)?.local;
  return {getProject: (id: string) => drafts.current.get(id)?.local, snapshot, project, activeID, setActiveID, edit, create, flush, reload, refresh, ready, saving, error, setError, report, conflicted: conflicts.current.has(activeID)};
}
