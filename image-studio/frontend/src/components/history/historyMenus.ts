import type { HistoryItem } from "../../types/domain";
import type { MenuItem } from "../common/ContextMenu";

type SharedHistoryMenuActions = {
  currentImageId?: string | null;
  onOpenDetail: () => void;
  onCopyPrompt: () => void;
  onCopySavedPath: () => void;
  onOpenRaw: () => void;
  onApplyParams: () => void;
  onRegenerate: () => void;
  onReuseAsSource: () => void;
  onToggleCompare: () => void;
  onDelete: () => void;
  isCompare?: boolean;
};

export function buildSharedHistoryMenu(
  item: HistoryItem,
  actions: SharedHistoryMenuActions,
): MenuItem[] {
  return [
    { label: "详情", icon: "ℹ", onClick: actions.onOpenDetail },
    {
      label: "复制 prompt",
      icon: "📋",
      separatorBefore: true,
      onClick: actions.onCopyPrompt,
    },
    {
      label: "复制本地路径",
      icon: "📁",
      disabled: !item.savedPath,
      onClick: actions.onCopySavedPath,
    },
    {
      label: "查看 raw 响应",
      icon: "📄",
      disabled: !item.rawPath,
      onClick: actions.onOpenRaw,
    },
    {
      separatorBefore: true,
      label: "应用参数(不生成)",
      icon: "📥",
      onClick: actions.onApplyParams,
    },
    {
      label: "以此参数重新生成",
      icon: "↻",
      onClick: actions.onRegenerate,
    },
    {
      separatorBefore: true,
      label: "设为源图",
      icon: "→",
      disabled: !(item.savedPath || item.imageB64 || item.fullUrl || item.imageId),
      onClick: actions.onReuseAsSource,
    },
    {
      label: actions.isCompare ? "取消对比" : "用作对比图 (B)",
      icon: "⇄",
      disabled: actions.currentImageId === item.id,
      onClick: actions.onToggleCompare,
    },
    {
      label: "删除",
      icon: "✕",
      danger: true,
      separatorBefore: true,
      onClick: actions.onDelete,
    },
  ];
}
