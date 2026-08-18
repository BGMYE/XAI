import { EllipsisVertical } from "lucide-react";
import type React from "react";
import { useEffect, useRef } from "react";
import { HistoryMetaBadges } from "../../../components/history/HistoryMetaBadges";
import { HistoryModeBadge } from "../../../components/history/HistoryModeBadge";
import { qualityLabel, sizeLabel } from "../../../components/history/historyLabels";
import { historyPreviewSrc, useBlobURL } from "../../../lib/images";
import type { HistoryItem } from "../../../types/domain";
import { vibrateForPlatform } from "../bridge";

type AndroidHistoryTileVariant = "grid" | "feature";

const LONG_PRESS_MS = 430;
const LONG_PRESS_MOVE_PX = 12;
const SUPPRESS_CLICK_MS = 700;

export function AndroidHistoryTile({
  item,
  isCurrent,
  isCompare,
  onSelect,
  onToggleCompare,
  onOpenMenu,
  variant = "grid",
}: {
  item: HistoryItem;
  isCurrent: boolean;
  isCompare: boolean;
  onSelect: (h: HistoryItem) => void | Promise<void>;
  onToggleCompare: (h: HistoryItem | null) => void;
  onOpenMenu: (x: number, y: number) => void;
  variant?: AndroidHistoryTileVariant;
}) {
  const previewURL = useBlobURL(item.previewBlob ?? item.imageBlob ?? null, item.imageB64 ?? null);
  const longPressTimerRef = useRef<number | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const suppressClickUntilRef = useRef(0);
  const imageSrc = historyPreviewSrc(item, previewURL);

  function clearLongPress() {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  useEffect(() => clearLongPress, []);

  function openMenu(x: number, y: number) {
    suppressClickUntilRef.current = Date.now() + SUPPRESS_CLICK_MS;
    vibrateForPlatform(16);
    onOpenMenu(x, y);
  }

  function openMenuFromEvent(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    openMenu(e.clientX, e.clientY);
  }

  function handleSelect(e: React.MouseEvent | React.KeyboardEvent) {
    if (Date.now() < suppressClickUntilRef.current) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if ("button" in e && (e.button === 2 || e.ctrlKey)) return;
    if (e.shiftKey) {
      onToggleCompare(isCompare ? null : item);
      return;
    }
    void onSelect(item);
  }

  function handleMouseDown(e: React.MouseEvent) {
    if (e.button === 2 || e.ctrlKey) openMenuFromEvent(e);
  }

  function handleTouchStart(e: React.TouchEvent) {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    clearLongPress();
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null;
      openMenu(touch.clientX, touch.clientY);
    }, LONG_PRESS_MS);
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (!touchStartRef.current || e.touches.length !== 1) return;
    const touch = e.touches[0];
    const dx = Math.abs(touch.clientX - touchStartRef.current.x);
    const dy = Math.abs(touch.clientY - touchStartRef.current.y);
    if (dx > LONG_PRESS_MOVE_PX || dy > LONG_PRESS_MOVE_PX) clearLongPress();
  }

  function handleTouchEnd() {
    clearLongPress();
    touchStartRef.current = null;
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") handleSelect(e);
  }

  const rootHandlers = {
    onClick: handleSelect,
    onContextMenu: openMenuFromEvent,
    onKeyDown: handleKeyDown,
    onMouseDown: handleMouseDown,
    onTouchCancel: handleTouchEnd,
    onTouchEnd: handleTouchEnd,
    onTouchMove: handleTouchMove,
    onTouchStart: handleTouchStart,
  };

  if (variant === "feature") {
    return (
      <div
        {...rootHandlers}
        role="button"
        tabIndex={0}
        title={item.prompt}
        className={`android-history-feature-tile ${isCurrent ? "active" : ""} ${isCompare ? "compare" : ""}`}
      >
        <img src={imageSrc} alt={item.prompt} loading="eager" decoding="async" />
        <div className="android-history-image-shade" />
        <HistoryModeBadge mode={item.mode} className="android-history-tile-mode" />
        {isCompare ? <span className="android-history-compare-badge">B</span> : null}
        <button
          type="button"
          className="android-history-tile-menu"
          onClick={openMenuFromEvent}
          onContextMenu={openMenuFromEvent}
          title="更多"
        >
          <EllipsisVertical className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div
      {...rootHandlers}
      role="button"
      tabIndex={0}
      title={item.prompt}
      className={`android-history-tile ${isCurrent ? "active" : ""} ${isCompare ? "compare" : ""}`}
    >
      <div className="android-history-tile-image">
        <img src={imageSrc} alt={item.prompt} loading="eager" decoding="async" />
        <div className="android-history-image-shade" />
        <HistoryModeBadge mode={item.mode} className="android-history-tile-mode" />
        {isCompare ? <span className="android-history-compare-badge">B</span> : null}
        <button
          type="button"
          className="android-history-tile-menu"
          onClick={openMenuFromEvent}
          onContextMenu={openMenuFromEvent}
          title="更多"
        >
          <EllipsisVertical className="h-4 w-4" />
        </button>
      </div>
      <div className="android-history-tile-body">
        <p>{item.prompt || "(无 prompt)"}</p>
        <HistoryMetaBadges
          items={[sizeLabel(item.size), qualityLabel(item.quality)]}
          compact
          className="android-history-tile-meta"
        />
      </div>
    </div>
  );
}
