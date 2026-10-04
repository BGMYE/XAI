// Test-only Wails host with the desktop change feed and runtime events:
// memory-backed metadata, never an upstream API.
import React from "react";
import { createRoot } from "react-dom/client";
import { useStudio } from "../../src/studio/useStudio";
import type { ChangeSet, Job, Project, Snapshot } from "../../src/studio/types";

type Change = { revision: number; kind: "project" | "job"; id: string };
const backend = {
  epoch: "first-run",
  revision: 1,
  projects: new Map<string, Project>(),
  jobs: new Map<string, Job>(),
  log: [] as Change[],
  calls: { snapshot: 0, changes: 0 },
};
const listeners = new Map<string, Set<(data: unknown) => void>>();
const record = (kind: Change["kind"], id: string) => {
  backend.revision++;
  backend.log.push({ revision: backend.revision, kind, id });
};
const snapshot = (): Snapshot => ({
  epoch: backend.epoch,
  revision: backend.revision,
  profiles: [],
  projects: structuredClone([...backend.projects.values()]),
  assets: [],
  jobs: structuredClone([...backend.jobs.values()]),
  promptCards: [],
});
Object.assign(window, {
  __sync: {
    backend,
    emit(name: string, data?: unknown) {
      for (const listener of listeners.get(name) ?? []) listener(data);
    },
    // A background change, as a finished job would make it.
    addJob(job: Job) {
      backend.jobs.set(job.id, job);
      record("job", job.id);
    },
    touchProject(id: string, name: string) {
      const p = backend.projects.get(id)!;
      backend.projects.set(id, { ...p, name, revision: p.revision + 1 });
      record("project", id);
    },
    trashProject(id: string) {
      const p = backend.projects.get(id)!;
      backend.projects.set(id, { ...p, deletedAt: new Date().toISOString(), revision: p.revision + 1 });
      record("project", id);
    },
    deleteJob(id: string) {
      backend.jobs.delete(id);
      record("job", id);
    },
    restart() {
      backend.epoch = "second-run";
      backend.log = [];
    },
  },
  runtime: {
    EventsOnMultiple(name: string, callback: (data: unknown) => void) {
      const set = listeners.get(name) ?? new Set();
      listeners.set(name, set);
      set.add(callback);
      return () => set.delete(callback);
    },
  },
  go: {
    backend: {
      StudioV2: {
        async GetSnapshot() {
          backend.calls.snapshot++;
          return snapshot();
        },
        async GetChanges(epoch: string, since: number): Promise<ChangeSet> {
          backend.calls.changes++;
          const base = { epoch: backend.epoch, revision: backend.revision, progress: {} };
          if (epoch !== backend.epoch) {
            return {
              ...base,
              ...snapshot(),
              full: true,
              removed: { profiles: [], promptCards: [] },
            } as ChangeSet;
          }
          const fresh = backend.log.filter((c) => c.revision > since);
          const ids = (kind: Change["kind"]) => [
            ...new Set(fresh.filter((c) => c.kind === kind).map((c) => c.id)),
          ];
          return {
            ...base,
            full: false,
            profiles: [],
            projects: structuredClone(ids("project").map((id) => backend.projects.get(id)!)),
            assets: [],
            jobs: structuredClone(
              ids("job")
                .filter((id) => backend.jobs.has(id))
                .map((id) => backend.jobs.get(id)!),
            ),
            promptCards: [],
            removed: {
              profiles: [],
              promptCards: [],
              jobs: ids("job").filter((id) => !backend.jobs.has(id)),
            },
          };
        },
        async SaveProject(project: Project) {
          const old = backend.projects.get(project.id);
          if ((old?.revision ?? 0) !== project.revision) throw Error("revision conflict");
          const saved = {
            ...structuredClone(project),
            revision: project.revision + 1,
            updatedAt: new Date().toISOString(),
          };
          backend.projects.set(saved.id, saved);
          record("project", saved.id);
          return structuredClone(saved);
        },
      },
    },
  },
});
function Harness() {
  const studio = useStudio();
  Object.assign(window, { __studio: studio });
  return <div>Change feed test</div>;
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Harness />
  </React.StrictMode>,
);
