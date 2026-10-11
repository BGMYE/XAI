import type { ChangeSet, Job, Snapshot } from "./types";
export const orders: {
  profiles(a: { name: string }, b: { name: string }): number;
  projects(a: { updatedAt: string }, b: { updatedAt: string }): number;
  assets(a: { createdAt: string }, b: { createdAt: string }): number;
  jobs(a: { createdAt: string }, b: { createdAt: string }): number;
  promptCards(a: { updatedAt: string }, b: { updatedAt: string }): number;
};
export function withProgress(jobs: Job[], progress: Record<string, number> | undefined): Job[];
export function applyChanges(snapshot: Snapshot, changes: ChangeSet): Snapshot;
export function setJobProgress(snapshot: Snapshot, id: string, percent: number): Snapshot;
