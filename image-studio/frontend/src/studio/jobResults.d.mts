import type { Job } from "./types";
export function resultAssetIDs(job: Pick<Job, "resultAssetId" | "resultAssetIds" | "resultImages">): string[];
export function buildAssetPromptIndex(jobs: Job[]): Map<string, string>;
export function reusableGenerationSettings(request: import("./types").Generation): {
  parameters: import("./types").Parameters;
  image: import("./types").ImageParameters;
};
