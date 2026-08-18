import { useState } from "react";
import type { HistoryItem, Toast } from "../../types/domain";
import type { MenuItem } from "../common/ContextMenu";
import { buildSharedHistoryMenu } from "./historyMenus";

type HistoryContextMenuArgs = {
  compareItemId?: string | null;
  currentImageId?: string | null;
  onApplyParams: (item: HistoryItem) => void;
  onDelete: (item: HistoryItem) => void;
  onOpenDetail: (item: HistoryItem) => void;
  onRegenerate: (item: HistoryItem) => void;
  onReuseAsSource: (item: HistoryItem) => void;
  onToggleCompare: (item: HistoryItem) => void;
  pushToast: (message: string, kind?: Toast["kind"]) => void;
};

type HistoryMenuState = {
  item: HistoryItem;
  x: number;
  y: number;
};

export function useHistoryContextMenu({
  compareItemId,
  currentImageId,
  onApplyParams,
  onDelete,
  onOpenDetail,
  onRegenerate,
  onReuseAsSource,
  onToggleCompare,
  pushToast,
}: HistoryContextMenuArgs) {
  const [menu, setMenu] = useState<HistoryMenuState | null>(null);
  const [rawPath, setRawPath] = useState<string | null>(null);

  function buildMenu(item: HistoryItem): MenuItem[] {
    return buildSharedHistoryMenu(item, {
      currentImageId: currentImageId ?? null,
      isCompare: compareItemId === item.id,
      onOpenDetail: () => onOpenDetail(item),
      onCopyPrompt: () => navigator.clipboard.writeText(item.prompt ?? "").then(
        () => pushToast("已复制 prompt", "success"),
        () => pushToast("复制失败", "error"),
      ),
      onCopySavedPath: () => navigator.clipboard.writeText(item.savedPath ?? "").then(
        () => pushToast("已复制路径", "success"),
        () => pushToast("复制失败", "error"),
      ),
      onOpenRaw: () => setRawPath(item.rawPath ?? null),
      onApplyParams: () => onApplyParams(item),
      onRegenerate: () => onRegenerate(item),
      onReuseAsSource: () => onReuseAsSource(item),
      onToggleCompare: () => onToggleCompare(item),
      onDelete: () => onDelete(item),
    });
  }

  return {
    buildMenu,
    closeMenu: () => setMenu(null),
    closeRaw: () => setRawPath(null),
    menu,
    openMenu: (item: HistoryItem, x: number, y: number) => setMenu({ item, x, y }),
    rawPath,
  };
}
