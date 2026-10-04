// Old Go nil slices and browser snapshots may contain null/missing arrays.
// Repair those legacy shapes without changing valid object identities. Other
// malformed values must produce a visible load error instead of erasing data.
function collection(value, label) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw Error(`工作室${label}格式异常，请保留原数据并检查备份。`);
  return value;
}

export function normalizeProjectCollections(project) {
  const nodes = collection(project.nodes, "节点集合");
  const edges = collection(project.edges, "连线集合");
  return nodes === project.nodes && edges === project.edges ? project : { ...project, nodes, edges };
}

export function normalizeSnapshotCollections(snapshot) {
  let normalized = snapshot;
  for (const name of ["profiles", "projects", "assets", "jobs", "promptCards"]) {
    let items = collection(snapshot[name], "数据集合");
    if (name === "projects") {
      const mapped = items.map(normalizeProjectCollections);
      if (mapped.some((p, index) => p !== items[index])) items = mapped;
    }
    if (items !== snapshot[name]) {
      if (normalized === snapshot) normalized = { ...snapshot };
      normalized[name] = items;
    }
  }
  return normalized;
}

export function normalizeChangeSetCollections(changes) {
  return normalizeSnapshotCollections(changes);
}
