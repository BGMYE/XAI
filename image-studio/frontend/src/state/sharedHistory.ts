import type { HistoryItem, Mode, SizeValue, QualityValue, OutputFormatValue } from "../types/domain";

type SharedResult = {
  jobId: string;
  assetId: string;
  createdAt: string;
  prompt: string;
  revisedPrompt?: string;
  imageId?: string;
  savedPath: string;
  thumbPath?: string;
  previewUrl: string;
  fullUrl: string;
  mode: string;
  size: string;
  quality: string;
  outputFormat: string;
};
interface HistoryHost {
  GetGenerationHistory(): Promise<SharedResult[]>;
  DeleteGenerationHistory(ids: string[]): Promise<void>;
  ImportClassicHistory(
    items: unknown[],
  ): Promise<Array<{ id: string; jobId: string; assetId: string; error?: string }>>;
}
const host = () =>
  (window as unknown as { go?: { backend?: { Service?: Partial<HistoryHost> } } }).go?.backend?.Service;

// Keep migration, refresh and deletion together through their local cache writes.
let historyOperation: Promise<unknown> = Promise.resolve();
export function withSharedHistoryLock<T>(action: () => Promise<T>): Promise<T> {
  const result = historyOperation.then(action, action);
  historyOperation = result.catch(() => undefined);
  return result;
}

export function mergeSharedHistory(local: HistoryItem[], results: SharedResult[]): HistoryItem[] {
  const byJob = new Map(local.filter((x) => x.sharedJobId).map((x) => [x.sharedJobId, x]));
  const shared = results.map((r) => ({
    ...byJob.get(r.jobId),
    id: byJob.get(r.jobId)?.id ?? r.jobId,
    sharedJobId: r.jobId,
    assetId: r.assetId,
    imageId: r.imageId,
    prompt: r.prompt,
    revisedPrompt: r.revisedPrompt,
    createdAt: Date.parse(r.createdAt) || 0,
    savedPath: r.savedPath,
    thumbPath: r.thumbPath,
    previewUrl: r.previewUrl,
    fullUrl: r.fullUrl,
    previewOnly: true,
    mode: (r.mode === "edit" ? "edit" : "generate") as Mode,
    size: (r.size || "auto") as SizeValue,
    quality: (r.quality || "auto") as QualityValue,
    outputFormat: (r.outputFormat || "png") as OutputFormatValue,
  }));
  return [...shared, ...local.filter((x) => !x.sharedJobId)].sort((a, b) => b.createdAt - a.createdAt);
}

export async function importSharedHistory(
  local: HistoryItem[],
  warn: (message: string) => void = () => undefined,
): Promise<HistoryItem[]> {
  const desktop = host();
  if (!desktop?.ImportClassicHistory) return local;
  const pending = local.filter((x) => !x.sharedJobId && x.savedPath);
  const imported = new Map<string, { jobId: string; assetId: string }>();
  let failures = 0;
  for (let i = 0; i < pending.length; i += 100) {
    const result = await desktop.ImportClassicHistory(
      pending.slice(i, i + 100).map((x) => ({
        id: x.id,
        savedPath: x.savedPath,
        prompt: x.prompt,
        mode: x.mode,
        revisedPrompt: x.revisedPrompt,
        size: x.size,
        quality: x.quality,
        outputFormat: x.outputFormat,
        createdAt: new Date(x.createdAt).toISOString(),
      })),
    );
    for (const item of result) {
      if (!item.error) imported.set(item.id, item);
      else failures++;
    }
  }
  if (failures) warn(`${failures} 条旧历史暂未导入，原文件和本地记录已保留。`);
  return local.map((x) => {
    const item = imported.get(x.id);
    return item ? { ...x, sharedJobId: item.jobId, assetId: item.assetId } : x;
  });
}

export async function readSharedHistory(local: HistoryItem[]): Promise<HistoryItem[]> {
  const desktop = host();
  if (!desktop?.GetGenerationHistory) return local;
  return mergeSharedHistory(local, await desktop.GetGenerationHistory());
}

export async function deleteSharedHistory(items: HistoryItem[]): Promise<void> {
  const ids = [...new Set(items.flatMap((item) => (item.sharedJobId ? [item.sharedJobId] : [])))];
  if (!ids.length) return;
  const desktop = host();
  if (!desktop?.DeleteGenerationHistory) throw Error("共享历史服务不可用，未删除记录");
  await desktop.DeleteGenerationHistory(ids);
}
