import type React from "react";
import { ChevronDown, ChevronRight, Clock3, Ellipsis, Layers3 } from "lucide-react";
import { historyPreviewSrc, useBlobURL } from "../../lib/images";
import type { HistoryItem } from "../../types/domain";
import { HistoryPromptThumbnailStack } from "./HistoryPromptThumbnailStack";
import { HistoryModeBadge } from "./HistoryModeBadge";
import { historyPromptGroupContains, historyPromptGroupLabel, type HistoryPromptGroup } from "./historyPromptGroups";
import { qualityLabel, sizeLabel } from "./historyLabels";

export function TimelinePromptStackGroup({
  compareItemId,
  currentItemId,
  expanded,
  group,
  onOpenMenu,
  onReuse,
  onSelect,
  onToggleCompare,
  onToggleExpanded,
  usesFluentUI,
}: {
  compareItemId: string | null;
  currentItemId: string | null;
  expanded: boolean;
  group: HistoryPromptGroup;
  onOpenMenu: (item: HistoryItem, x: number, y: number) => void;
  onReuse: (item: HistoryItem) => void;
  onSelect: (item: HistoryItem) => void;
  onToggleCompare: (item: HistoryItem | null) => void;
  onToggleExpanded: () => void;
  usesFluentUI: boolean;
}) {
  const latest = group.representative;
  const isCurrentGroup = historyPromptGroupContains(group, currentItemId);
  const isCompareGroup = historyPromptGroupContains(group, compareItemId);
  const label = historyPromptGroupLabel(group);
  const timeLabel = new Date(latest.createdAt).toLocaleTimeString();

  function openLatestMenu(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    onOpenMenu(latest, event.clientX, event.clientY);
  }

  return (
    <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3">
      <div className="flex flex-col items-center gap-2 pt-1">
        <div className="h-2.5 w-2.5 rounded-full bg-[var(--accent)] shadow-[0_0_8px_rgb(0_122_255_/_0.55)]" />
        <div className="h-full w-px bg-black/[0.08] dark:bg-white/[0.08]" />
      </div>
      <div
        className={`timeline-prompt-stack-card ${usesFluentUI ? "fluent" : ""} ${expanded ? "expanded" : ""} ${isCurrentGroup ? "active" : ""} ${isCompareGroup ? "compare" : ""}`}
        onContextMenu={openLatestMenu}
      >
        <div className="timeline-prompt-stack-head">
          <button
            type="button"
            className="timeline-prompt-stack-main"
            title={label}
            onClick={onToggleExpanded}
            onContextMenu={openLatestMenu}
          >
            <HistoryPromptThumbnailStack items={group.items} />
            <span className="timeline-prompt-stack-copy">
              <span className="timeline-prompt-stack-kicker">
                <Layers3 className="h-3.5 w-3.5" />
                同提示词
                <span>{group.items.length} 张</span>
              </span>
              <strong>{label}</strong>
              <span className="timeline-prompt-stack-meta">
                <Clock3 className="h-3.5 w-3.5" />
                {timeLabel}
                <span className="timeline-prompt-stack-badges">
                  <span>{sizeLabel(latest.size)}</span>
                  <span>{qualityLabel(latest.quality)}</span>
                </span>
              </span>
            </span>
          </button>
          <div className="timeline-prompt-stack-actions">
            <button
              type="button"
              className="timeline-prompt-stack-action"
              onClick={(event) => {
                event.stopPropagation();
                onSelect(latest);
              }}
            >
              查看最新
            </button>
            <button
              type="button"
              className="timeline-prompt-stack-action icon"
              aria-expanded={expanded}
              onClick={(event) => {
                event.stopPropagation();
                onToggleExpanded();
              }}
              title={expanded ? "收起缩略图" : "展开缩略图"}
            >
              {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              className="timeline-prompt-stack-action icon"
              onClick={openLatestMenu}
              onContextMenu={openLatestMenu}
              title="更多"
            >
              <Ellipsis className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        {expanded ? (
          <div className="timeline-prompt-thumb-grid">
            {group.items.map((item, index) => (
              <TimelinePromptThumbnail
                key={item.id}
                item={item}
                index={index}
                isCurrent={currentItemId === item.id}
                isCompare={compareItemId === item.id}
                onSelect={onSelect}
                onToggleCompare={onToggleCompare}
                onReuse={onReuse}
                onOpenMenu={(x, y) => onOpenMenu(item, x, y)}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function TimelinePromptThumbnail({
  index,
  isCompare,
  isCurrent,
  item,
  onOpenMenu,
  onReuse,
  onSelect,
  onToggleCompare,
}: {
  index: number;
  isCompare: boolean;
  isCurrent: boolean;
  item: HistoryItem;
  onOpenMenu: (x: number, y: number) => void;
  onReuse: (item: HistoryItem) => void;
  onSelect: (item: HistoryItem) => void;
  onToggleCompare: (item: HistoryItem | null) => void;
}) {
  const previewURL = useBlobURL(item.previewBlob ?? item.imageBlob ?? null, item.imageB64 ?? null);
  const imageSrc = historyPreviewSrc(item, previewURL);
  const displayIndex = typeof item.batchIndex === "number" ? item.batchIndex + 1 : index + 1;

  function openMenu(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    onOpenMenu(event.clientX, event.clientY);
  }

  function handleSelect(event: React.MouseEvent) {
    if (event.button === 2 || event.ctrlKey) return;
    if (event.shiftKey) {
      onToggleCompare(isCompare ? null : item);
      return;
    }
    onSelect(item);
  }

  return (
    <button
      type="button"
      className={`timeline-prompt-thumb ${isCurrent ? "active" : ""} ${isCompare ? "compare" : ""}`}
      title={item.prompt}
      onClick={handleSelect}
      onDoubleClick={() => onReuse(item)}
      onContextMenu={openMenu}
    >
      <img src={imageSrc} alt={item.prompt} loading="eager" decoding="async" />
      <HistoryModeBadge mode={item.mode} className="timeline-prompt-thumb-mode" />
      <span className="timeline-prompt-thumb-index">#{displayIndex}</span>
      {isCompare ? <span className="timeline-prompt-thumb-compare">B</span> : null}
      <span
        className="timeline-prompt-thumb-menu"
        onClick={openMenu}
        onContextMenu={openMenu}
        title="更多"
      >
        <Ellipsis className="h-3.5 w-3.5" />
      </span>
    </button>
  );
}
