import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { client } from "./client";
import { DraftSaveContext } from "./DraftSaveContext";
import { mergeProject, newProject, orderGraph } from "./graph.mjs";
import { applyChanges, setJobProgress } from "./sync.mjs";
import { emptySnapshot, type Project, type Snapshot } from "./types";
type Draft = { base: Project; local: Project };
const same = (a: Project, b: Project) => a === b || JSON.stringify(a) === JSON.stringify(b);
// With backend notifications, polling only covers a missed event.
const pollWithEvents = 30_000,
  pollWithoutEvents = 2500;
export function useStudio() {
  const registerSaver = useContext(DraftSaveContext);
  const [snapshot, setSnapshot] = useState<Snapshot>(emptySnapshot);
  const current = useRef<Snapshot>(snapshot);
  const [activeID, setActiveID] = useState("");
  const [version, bump] = useState(0);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const drafts = useRef(new Map<string, Draft>());
  const pending = useRef(new Map<string, Promise<void>>());
  const conflicts = useRef(new Set<string>());
  const failedSaves = useRef(new Set<string>());
  const inflight = useRef<Promise<void> | null>(null),
    again = useRef(false);
  const alive = useRef(true);
  const report = useCallback((e: unknown) => {
    if (alive.current) setError(String(e instanceof Error ? e.message : e));
  }, []);
  // Save responses and the change feed can arrive in either order. Keep the
  // same three-way merge rules when applying a remote version after a save.
  const mergeRemote = useCallback((remote: Project | undefined) => {
    if (!remote || remote.deletedAt || conflicts.current.has(remote.id)) return;
    const draft = drafts.current.get(remote.id);
    if (!draft || remote.revision <= draft.base.revision) return;
    try {
      draft.local = mergeProject(draft.base, draft.local, remote);
      draft.base = remote;
    } catch (e) {
      conflicts.current.add(remote.id);
      throw e;
    }
  }, []);
  // Merges remote projects into drafts; `changed` limits the work to projects
  // a delta reports.
  const accept = useCallback(
    (s: Snapshot, changed: Project[] = s.projects) => {
      const previous = current.current;
      current.current = s;
      for (const id of drafts.current.keys()) {
        const remote = s.projects.find((p) => p.id === id);
        // A newly saved draft may not have appeared in a lagging snapshot yet.
        // Only a tombstone or removal of a previously observed project deletes it.
        if (!remote?.deletedAt && (remote || !previous.projects.some((p) => p.id === id))) continue;
        drafts.current.delete(id);
        conflicts.current.delete(id);
        failedSaves.current.delete(id);
      }
      for (const remote of changed) {
        if (remote.deletedAt) continue;
        const d = drafts.current.get(remote.id);
        if (!d) drafts.current.set(remote.id, { base: remote, local: remote });
        else if (!pending.current.has(remote.id)) {
          try {
            mergeRemote(remote);
          } catch (e) {
            report(e);
          }
        }
      }
      if (alive.current) {
        setSnapshot(s);
        setReady(true);
        setActiveID((id) => (drafts.current.has(id) ? id : s.projects.find((p) => !p.deletedAt)?.id || ""));
        bump((n) => n + 1);
      }
    },
    [mergeRemote, report],
  );
  // Brings the snapshot up to date: a delta when the backend supports it, the
  // whole snapshot otherwise. Calls during a refresh join it and run one more
  // round, so a caller's own change is always included when its await returns.
  const refresh = useCallback((): Promise<void> => {
    if (inflight.current) {
      again.current = true;
      return inflight.current;
    }
    const run = (async () => {
      try {
        do {
          again.current = false;
          const base = current.current;
          const changes = base.epoch ? await client.changes(base.epoch, base.revision ?? 0) : null;
          if (changes) {
            const next = applyChanges(current.current, changes);
            if (next !== current.current) accept(next, changes.full ? next.projects : changes.projects);
          } else accept(await client.snapshot());
        } while (again.current && alive.current);
      } catch (e) {
        report(e);
      } finally {
        inflight.current = null;
      }
    })();
    inflight.current = run;
    return run;
  }, [accept, report]);
  useEffect(() => {
    alive.current = true;
    void refresh();
    const live = client.subscribe({
      changed: () => void refresh(),
      progress: (id, percent) => {
        const next = setJobProgress(current.current, id, percent);
        if (next === current.current) return;
        current.current = next;
        if (alive.current) setSnapshot(next);
      },
    });
    const timer = window.setInterval(
      () => {
        if (!document.hidden) void refresh();
      },
      live ? pollWithEvents : pollWithoutEvents,
    );
    const visible = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener("visibilitychange", visible);
    const unload = (e: BeforeUnloadEvent) => {
      if ([...drafts.current.values()].some((d) => !same(d.base, d.local))) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => {
      alive.current = false;
      live?.();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("beforeunload", unload);
    };
  }, [refresh]);
  const flush = useCallback(
    (id: string): Promise<void> => {
      if (pending.current.has(id)) return pending.current.get(id)!;
      // Defer the body until `pending` contains its promise, including a clean
      // or missing draft that finishes without reaching a backend await.
      const task = Promise.resolve().then(async () => {
        let failure: unknown;
        try {
          if (conflicts.current.has(id)) throw Error("当前画布存在冲突，请先导出草稿并重新载入。");
          if (alive.current) setSaving(true);
          let retries = 0;
          for (;;) {
            const d = drafts.current.get(id);
            if (!d || same(d.base, d.local)) break;
            const sent = structuredClone(d.local);
            try {
              const saved = await client.saveProject(sent);
              // A deletion or explicit replacement while awaiting must win.
              if (drafts.current.get(id) !== d) break;
              try {
                // Preserve edits made while this request was in flight. Only
                // this acknowledged response may advance the sent baseline.
                d.local = mergeProject(sent, d.local, saved);
                d.base = saved;
              } catch (conflict) {
                conflicts.current.add(id);
                throw conflict;
              }
              // A newer feed revision may already be consumed while pending.
              // Apply it before deciding the draft is clean or saving again.
              mergeRemote(current.current.projects.find((p) => p.id === id));
              retries = 0;
            } catch (e) {
              if (String(e).includes("revision conflict") && retries++ < 3) {
                const s = await client.snapshot();
                if (drafts.current.get(id) !== d) break;
                const remote = s.projects.find((p) => p.id === id);
                if (!remote || remote.deletedAt) throw e;
                mergeRemote(remote);
              } else throw e;
            }
          }
        } catch (e) {
          failure = e;
        } finally {
          pending.current.delete(id);
          // Also reconcile skipped changes after a failed write. Keep the
          // failure gate so this does not start an automatic retry loop.
          try {
            mergeRemote(current.current.projects.find((p) => p.id === id));
          } catch (e) {
            failure ??= e;
          }
          if (failure !== undefined) {
            failedSaves.current.add(id);
            report(failure);
          } else failedSaves.current.delete(id);
          if (alive.current) {
            setSaving(pending.current.size > 0);
            bump((n) => n + 1);
          }
        }
        // Callers await reconciliation too; a conflict must block navigation.
        if (failure !== undefined) throw failure;
      });
      pending.current.set(id, task);
      void task.catch(() => undefined);
      return task;
    },
    [mergeRemote, report],
  );
  useEffect(() => {
    const timer = setTimeout(() => {
      for (const [id, d] of drafts.current)
        if (
          !same(d.base, d.local) &&
          !conflicts.current.has(id) &&
          !pending.current.has(id) &&
          !failedSaves.current.has(id)
        )
          void flush(id).catch(() => undefined);
    }, 700);
    return () => clearTimeout(timer);
  }, [version, flush]);
  // Enumerate drafts rather than the last snapshot, which may lag a new canvas.
  // Rejections reach the navigation handler so a failed save cannot unmount it.
  const flushAll = useCallback(async () => {
    for (const id of drafts.current.keys()) await flush(id);
  }, [flush]);
  useEffect(() => registerSaver(flushAll), [registerSaver, flushAll]);
  const edit = useCallback(
    (p: Project) => {
      try {
        orderGraph(p);
        const d = drafts.current.get(p.id);
        if (d) {
          d.local = { ...p, revision: d.base.revision };
          failedSaves.current.delete(p.id);
          bump((n) => n + 1);
        }
      } catch (e) {
        report(e);
      }
    },
    [report],
  );
  const create = useCallback(
    async (input?: Project) => {
      const p = await client.saveProject(input ?? newProject());
      drafts.current.set(p.id, { base: p, local: p });
      setActiveID(p.id);
      bump((n) => n + 1);
      await refresh();
      return p;
    },
    [refresh],
  );
  const reload = useCallback(
    async (id: string) => {
      if (pending.current.has(id)) await pending.current.get(id)?.catch(() => undefined);
      const s = await client.snapshot(),
        p = s.projects.find((x) => x.id === id);
      if (p) {
        drafts.current.set(id, { base: p, local: p });
        conflicts.current.delete(id);
        failedSaves.current.delete(id);
        accept(s);
        setError("");
      }
    },
    [accept],
  );
  const project = drafts.current.get(activeID)?.local;
  return {
    getProject: (id: string) => drafts.current.get(id)?.local,
    snapshot,
    project,
    activeID,
    setActiveID,
    edit,
    create,
    flush,
    flushAll,
    reload,
    refresh,
    ready,
    saving,
    error,
    setError,
    report,
    conflicted: conflicts.current.has(activeID),
  };
}
