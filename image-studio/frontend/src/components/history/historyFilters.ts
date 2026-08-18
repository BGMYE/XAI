import type { HistoryItem } from "../../types/domain";

export type RelativeHistoryDateFilter = "all" | "today" | "week";
export type TimelineHistoryDateFilter = RelativeHistoryDateFilter | "pick";

export function matchesHistorySearch(
  item: Pick<HistoryItem, "prompt" | "revisedPrompt">,
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const hay = `${item.prompt ?? ""} ${item.revisedPrompt ?? ""}`.toLowerCase();
  return hay.includes(needle);
}

export function isHistoryInDateFilter(
  createdAt: number,
  filter: TimelineHistoryDateFilter,
  pickedDate = "",
): boolean {
  if (filter === "all") return true;
  const now = Date.now();
  if (filter === "today") {
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    return createdAt >= startOfDay.getTime();
  }
  if (filter === "week") {
    return now - createdAt < 7 * 24 * 3600 * 1000;
  }
  if (!pickedDate) return true;
  const target = new Date(`${pickedDate}T00:00:00`);
  const start = target.getTime();
  const end = start + 24 * 3600 * 1000;
  return createdAt >= start && createdAt < end;
}

export function historyDayKey(createdAt: number): string {
  const d = new Date(createdAt);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
