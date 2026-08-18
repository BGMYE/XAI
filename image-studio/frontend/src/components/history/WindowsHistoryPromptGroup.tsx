import { Images } from "lucide-react";
import type React from "react";
import type { HistoryItem } from "../../types/domain";
import { HistoryPromptThumbnailStack } from "./HistoryPromptThumbnailStack";
import type { HistoryPromptGroup } from "./historyPromptGroups";
import { historyPromptGroupContains, historyPromptGroupLabel } from "./historyPromptGroups";
import { qualityLabel, sizeLabel } from "./historyLabels";

export function WindowsHistoryPromptGroup({
  compareItemId,
  currentItemId,
  group,
  onOpenMenu,
  onOpenGroup,
  onSelect,
  onToggleCompare,
}: {
  compareItemId: string | null;
  currentItemId: string | null;
  group: HistoryPromptGroup;
  onOpenMenu: (item: HistoryItem, x: number, y: number) => void;
  onOpenGroup: () => void;
  onSelect: (item: HistoryItem) => void | Promise<void>;
  onToggleCompare: (item: HistoryItem | null) => void;
}) {
  const latest = group.representative;
  const isCurrentGroup = historyPromptGroupContains(group, currentItemId);
  const isCompareGroup = historyPromptGroupContains(group, compareItemId);
  const label = historyPromptGroupLabel(group);

  function handleSummaryClick(event: React.MouseEvent) {
    if (event.button === 2 || event.ctrlKey) return;
    if (event.shiftKey) {
      onToggleCompare(isCompareGroup ? null : latest);
      return;
    }
    void onSelect(latest);
  }

  function openGroup(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    onOpenGroup();
  }

  function openLatestMenu(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    onOpenMenu(latest, event.clientX, event.clientY);
  }

  return (
    <section className={`windows-history-prompt-group ${isCurrentGroup ? "active" : ""} ${isCompareGroup ? "compare" : ""}`}>
      <button
        type="button"
        className="windows-history-group-summary"
        title={label}
        onClick={handleSummaryClick}
        onContextMenu={openLatestMenu}
      >
        <span className="windows-history-group-pile-button" onClick={openGroup} title="展开同提示词结果">
          <HistoryPromptThumbnailStack items={group.items} className="windows-history-group-pile" />
        </span>
        <span className="windows-history-group-copy">
          <strong>{label}</strong>
          <small>{group.items.length} 张 · {sizeLabel(latest.size)} · {qualityLabel(latest.quality)}</small>
        </span>
      </button>
      <button
        type="button"
        className="windows-history-group-expand"
        title="展开同提示词结果"
        onClick={openGroup}
      >
        <Images className="h-3.5 w-3.5" />
      </button>
    </section>
  );
}
