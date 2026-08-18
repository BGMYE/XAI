import type { HistoryItem } from "../types/domain";

export type SavePromptRequest =
  | { kind: "single"; item: HistoryItem }
  | { kind: "batch"; items: HistoryItem[]; workspaceId: string };

export function normalizeSavePromptRequest(request: SavePromptRequest): SavePromptRequest | null {
  if (request.kind === "single") {
    return request.item ? request : null;
  }
  if (request.items.length === 0) return null;
  return request;
}
