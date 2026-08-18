import { Images, Layers3 } from "lucide-react";
import type React from "react";
import type { HistoryItem } from "../../../types/domain";
import { HistoryMetaBadges } from "../../../components/history/HistoryMetaBadges";
import { HistoryPromptThumbnailStack } from "../../../components/history/HistoryPromptThumbnailStack";
import type { HistoryPromptGroup } from "../../../components/history/historyPromptGroups";
import {
  historyPromptGroupContains,
  historyPromptGroupLabel,
} from "../../../components/history/historyPromptGroups";
import { qualityLabel, sizeLabel } from "../../../components/history/historyLabels";
import { vibrateForPlatform } from "../bridge";

export function AndroidHistoryPromptGroup({
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
    vibrateForPlatform(8);
    onOpenGroup();
  }

  function openLatestMenu(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    vibrateForPlatform(16);
    onOpenMenu(latest, event.clientX, event.clientY);
  }

  return (
    <section className={`android-history-prompt-group ${isCurrentGroup ? "active" : ""} ${isCompareGroup ? "compare" : ""}`}>
      <button
        type="button"
        className="android-history-group-summary"
        title={label}
        onClick={handleSummaryClick}
        onContextMenu={openLatestMenu}
      >
        <span className="android-history-group-pile-button" onClick={openGroup} title="展开同提示词结果">
          <HistoryPromptThumbnailStack items={group.items} className="android-history-group-pile" />
        </span>
        <span className="android-history-group-copy">
          <span className="android-history-group-kicker">
            <Layers3 className="h-3.5 w-3.5" />
            同提示词
          </span>
          <strong>{label}</strong>
          <HistoryMetaBadges
            items={[`${group.items.length} 张`, sizeLabel(latest.size), qualityLabel(latest.quality)]}
            compact
            className="android-history-tile-meta"
          />
        </span>
      </button>
      <button
        type="button"
        className="android-history-group-expand"
        title="展开同提示词结果"
        onClick={openGroup}
      >
        <Images className="h-4 w-4" />
      </button>
    </section>
  );
}
