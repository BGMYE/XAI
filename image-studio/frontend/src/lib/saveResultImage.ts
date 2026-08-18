import type { HistoryItem } from "../types/domain";
import { SaveImageAs, SaveImagePathAs, SaveImagePathToDir, SaveImageToDir } from "../platform/runtime/host";
import { saveImageForPlatform } from "../platform/android/bridge";
import { suggestedImageName } from "./imageFileNames.ts";

export async function saveHistoryItemAs(item: HistoryItem): Promise<string> {
  const suggested = suggestedImageName(item);
  if (item.savedPath) return SaveImagePathAs(item.savedPath, suggested);
  if (item.imageB64) return saveImageForPlatform(item.imageB64, suggested, SaveImageAs);
  throw new Error("当前图片没有可保存内容");
}

export async function saveHistoryItemToDirectory(item: HistoryItem, directory: string): Promise<string> {
  const suggested = suggestedImageName(item);
  if (item.savedPath) return SaveImagePathToDir(item.savedPath, directory, suggested);
  if (item.imageB64) return SaveImageToDir(item.imageB64, directory, suggested);
  throw new Error("当前图片没有可保存内容");
}

export async function saveHistoryItemToDirectoryAs(item: HistoryItem, directory: string, suggestedName: string): Promise<string> {
  if (item.savedPath) return SaveImagePathToDir(item.savedPath, directory, suggestedName);
  if (item.imageB64) return SaveImageToDir(item.imageB64, directory, suggestedName);
  throw new Error("当前图片没有可保存内容");
}

export async function saveHistoryItemsToDirectory(items: HistoryItem[], directory: string): Promise<string[]> {
  const saved: string[] = [];
  for (const item of items) {
    saved.push(await saveHistoryItemToDirectory(item, directory));
  }
  return saved;
}
