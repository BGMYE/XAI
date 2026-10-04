// Pure snapshot synchronization, shared by the UI and node:test. Collections
// are kept in the orders Engine.Snapshot uses in the Go backend.
const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
const newest = (key) => (a, b) => (a[key] > b[key] ? -1 : a[key] < b[key] ? 1 : 0);
export const orders = {
  profiles: byName,
  projects: newest("updatedAt"),
  assets: newest("createdAt"),
  jobs: newest("createdAt"),
  promptCards: newest("updatedAt"),
};

const noCards = Object.freeze([]);

// Replaces changed entities and drops removed ones. An unchanged collection
// keeps its identity, so memoized views over it do not recompute.
function merge(list, changed, removed, order) {
  if (!changed?.length && !removed?.length) return list;
  const byID = new Map(list.map((item) => [item.id, item]));
  for (const id of removed ?? []) byID.delete(id);
  for (const item of changed ?? []) byID.set(item.id, item);
  return [...byID.values()].sort(order);
}

/** Overlays volatile progress on running jobs, copying only what changes. */
export function withProgress(jobs, progress) {
  let out = jobs;
  for (const [id, percent] of Object.entries(progress ?? {})) {
    const i = out.findIndex((job) => job.id === id);
    if (i < 0 || out[i].state !== "running" || out[i].progress === percent) continue;
    if (out === jobs) out = jobs.slice();
    out[i] = { ...out[i], progress: percent };
  }
  return out;
}

/** Applies a change set; returns the same snapshot when nothing changed. */
export function applyChanges(snapshot, changes) {
  if (changes.full) {
    return {
      epoch: changes.epoch,
      revision: changes.revision,
      profiles: changes.profiles,
      projects: changes.projects,
      assets: changes.assets,
      jobs: withProgress(changes.jobs, changes.progress),
      promptCards: changes.promptCards,
    };
  }
  const next = {
    ...snapshot,
    epoch: changes.epoch,
    revision: changes.revision,
    profiles: merge(snapshot.profiles, changes.profiles, changes.removed?.profiles, orders.profiles),
    projects: merge(snapshot.projects, changes.projects, [], orders.projects),
    assets: merge(snapshot.assets, changes.assets, [], orders.assets),
    jobs: withProgress(merge(snapshot.jobs, changes.jobs, [], orders.jobs), changes.progress),
    promptCards: merge(
      snapshot.promptCards ?? noCards,
      changes.promptCards,
      changes.removed?.promptCards,
      orders.promptCards,
    ),
  };
  const same =
    next.epoch === snapshot.epoch &&
    next.revision === snapshot.revision &&
    ["profiles", "projects", "assets", "jobs"].every((key) => next[key] === snapshot[key]) &&
    next.promptCards === (snapshot.promptCards ?? noCards);
  return same ? snapshot : next;
}

/** Records reported progress for one job; returns the same snapshot when nothing changed. */
export function setJobProgress(snapshot, id, percent) {
  const jobs = withProgress(snapshot.jobs, { [id]: percent });
  return jobs === snapshot.jobs ? snapshot : { ...snapshot, jobs };
}
