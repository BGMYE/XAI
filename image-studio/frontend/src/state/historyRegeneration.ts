import type { HistoryItem, SourceImage } from "../types/domain";

export async function restoreHistorySources(
  item: HistoryItem,
  history: HistoryItem[],
  readSource: (path: string) => Promise<SourceImage>,
  materialize: (item: HistoryItem) => Promise<HistoryItem>,
): Promise<SourceImage[]> {
  if (item.mode !== "edit") return [];
  const references = item.sourcePaths?.filter((path) => path.trim()) ?? [];
  if (!references.length && item.parentId?.trim()) references.push(item.parentId);
  if (!references.length) throw new Error("这条编辑历史没有保存原参考图，无法重新生成；请重新添加参考图后生成");

  const sources: SourceImage[] = [];
  for (const reference of references) {
    const parent = history.find((entry) => entry.id === reference || entry.savedPath === reference);
    try {
      if (parent?.id === reference) {
        const restored = await materialize(parent);
        if (!restored.savedPath) throw new Error("missing source path");
        sources.push(await readSource(restored.savedPath));
      } else {
        try {
          sources.push(await readSource(reference));
        } catch (error) {
          if (!parent) throw error;
          const restored = await materialize(parent);
          if (!restored.savedPath) throw error;
          sources.push(await readSource(restored.savedPath));
        }
      }
    } catch {
      const name = reference.split(/[\\/]/).pop() || "原参考图";
      throw new Error(`原参考图「${name}」已丢失或无法读取，已停止重新生成；请重新添加参考图后生成`);
    }
  }
  return sources;
}
