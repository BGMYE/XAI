/** Preserve legacy first-result IDs while surfacing every returned final asset. */
export function resultAssetIDs(job) {
  return [...new Set([job.dlss5?.resultAssetId, job.resultAssetId, ...(job.resultAssetIds ?? []), ...(job.resultImages ?? []).map((image) => image.assetId)].filter(Boolean))];
}

export function buildAssetPromptIndex(jobs) {
  const prompts = new Map();
  for (const job of jobs) {
    for (const id of resultAssetIDs(job)) {
      prompts.set(id, `${prompts.get(id) ?? ""}\n${job.request.prompt.toLowerCase()}`);
    }
  }
  return prompts;
}

/** Move legacy image settings into the fields edited by the current form. */
export function reusableGenerationSettings(request) {
  if (request.kind !== "image") return { parameters: { ...request.parameters }, image: { ...request.image } };
  const { quality, outputFormat, inputFidelity, ...parameters } = request.parameters;
  return {
    parameters,
    image: {
      ...request.image,
      quality: request.image?.quality || quality || undefined,
      outputFormat: request.image?.outputFormat || outputFormat || undefined,
      inputFidelity: request.image?.inputFidelity || inputFidelity || undefined,
    },
  };
}
