import { Clock3, Ellipsis } from "lucide-react";
import { historyPreviewSrc, useBlobURL } from "../../lib/images";
import { usePlatform } from "../../platform/context";
import type { HistoryItem } from "../../types/domain";
import { HistoryMetaBadges } from "./HistoryMetaBadges";
import { HistoryModeBadge } from "./HistoryModeBadge";
import { qualityLabel, sizeLabel } from "./historyLabels";

export function TimelineHistoryItem({
  item,
  isCurrent,
  isCompare,
  onSelect,
  onDelete,
  onReuse,
  onToggleCompare,
  onOpenMenu,
}: {
  item: HistoryItem;
  isCurrent: boolean;
  isCompare: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onReuse: () => void;
  onToggleCompare: () => void;
  onOpenMenu: (x: number, y: number) => void;
}) {
  const { isMac, usesFluentUI } = usePlatform();
  const previewURL = useBlobURL(item.previewBlob ?? item.imageBlob ?? null, item.imageB64 ?? null);
  const imageSrc = historyPreviewSrc(item, previewURL);
  const timeLabel = new Date(item.createdAt).toLocaleTimeString();

  return (
    <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3">
      <div className="flex flex-col items-center gap-2 pt-1">
        <div className="h-2.5 w-2.5 rounded-full bg-[var(--accent)] shadow-[0_0_8px_rgb(0_122_255_/_0.55)]" />
        <div className="h-full w-px bg-black/[0.08] dark:bg-white/[0.08]" />
      </div>
      <div
        onContextMenu={(e) => {
          e.preventDefault();
          onOpenMenu(e.clientX, e.clientY);
        }}
        className={`platform-card border border-black/[0.05] bg-white/70 p-3 shadow-[var(--shadow-card)] dark:border-white/[0.06] dark:bg-white/[0.03] ${usesFluentUI ? "rounded-[12px]" : "rounded-[18px]"} ${
          isCurrent ? "ring-1 ring-[color:var(--accent)]/40" : ""
        }`}
      >
        <div className="grid grid-cols-[152px_minmax(0,1fr)] gap-3">
          <button
            type="button"
            onClick={onSelect}
            className={`relative aspect-[4/3] overflow-hidden border border-black/[0.06] dark:border-white/[0.06] ${usesFluentUI ? "rounded-[10px]" : "rounded-[16px]"}`}
          >
            <img
              src={imageSrc}
              alt={item.prompt}
              className="h-full w-full object-cover"
            />
            <HistoryModeBadge mode={item.mode} className="absolute left-2 top-2" />
          </button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
              <Clock3 className="h-3.5 w-3.5" />
              <span>{timeLabel}</span>
              <HistoryMetaBadges items={[sizeLabel(item.size), qualityLabel(item.quality)]} />
            </div>
            <div className="mt-2 line-clamp-2 text-[13px] font-medium leading-6 text-zinc-800 dark:text-zinc-100">
              {item.prompt || "(无 prompt)"}
            </div>
            {item.revisedPrompt ? (
              <div className="mt-2 rounded-[14px] border border-black/[0.06] bg-black/[0.025] px-3 py-2 text-[11px] leading-5 text-zinc-500 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-zinc-300">
                <span className="mr-1 font-semibold text-zinc-600 dark:text-zinc-200">优化后</span>
                <span className="line-clamp-2 align-middle">{item.revisedPrompt}</span>
              </div>
            ) : null}
            <div className="mt-2 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenMenu(e.clientX, e.clientY);
                }}
                className={`inline-flex min-h-[30px] items-center justify-center gap-1 px-2.5 text-[11px] font-medium text-zinc-500 transition-colors hover:text-[var(--accent)] ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
              >
                <Ellipsis className="h-3.5 w-3.5" />
                更多
              </button>
              <span className="text-[10px] text-zinc-400/90 dark:text-zinc-500">双击设为源图</span>
            </div>
            <div className={`${isMac ? "mt-3 flex flex-wrap items-center gap-2" : "mt-3 flex flex-wrap gap-2"}`}>
              <button onClick={onSelect} className={`platform-pill inline-flex min-h-[34px] min-w-[78px] items-center justify-center px-3 py-1.5 text-[11px] font-medium text-zinc-600 hover:text-[var(--accent)] ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}>查看</button>
              <button onClick={onReuse} className={`platform-pill inline-flex min-h-[34px] min-w-[96px] items-center justify-center px-3 py-1.5 text-[11px] font-medium text-zinc-600 hover:text-[var(--accent)] ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}>设为源图</button>
              <button onClick={onToggleCompare} className={`platform-pill inline-flex min-h-[30px] min-w-[68px] items-center justify-center px-2.5 text-[11px] font-medium ${isCompare ? "text-[var(--accent)]" : "text-zinc-500 hover:text-[var(--accent)]"} ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}>对比</button>
              <button onClick={onDelete} className={`platform-pill inline-flex min-h-[30px] min-w-[68px] items-center justify-center px-2.5 text-[11px] font-medium text-zinc-500 hover:text-red-400 ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}>删除</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
