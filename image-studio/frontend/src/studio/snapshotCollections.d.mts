import type { ChangeSet, Project, Snapshot } from "./types";
export function normalizeProjectCollections(project: Project): Project;
export function normalizeSnapshotCollections(snapshot: Snapshot): Snapshot;
export function normalizeChangeSetCollections(changes: ChangeSet): ChangeSet;
