import {
  Clipboard,
  FileText,
  FolderOpen,
  ImagePlus,
  Info,
  RotateCcw,
  SlidersHorizontal,
  Split,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import type { MenuItem } from "../../../components/common/ContextMenu";
import { HistoryModeBadge } from "../../../components/history/HistoryModeBadge";
import { qualityLabel, sizeLabel } from "../../../components/history/historyLabels";
import { historyPreviewSrc, useBlobURL } from "../../../lib/images";
import type { HistoryItem } from "../../../types/domain";
import { vibrateForPlatform } from "../bridge";

function IconForAction({ label }: { label: string }) {
  if (label.includes("详情")) return <Info />;
  if (label.includes("复制 prompt")) return <Clipboard />;
  if (label.includes("路径")) return <FolderOpen />;
  if (label.includes("raw")) return <FileText />;
  if (label.includes("应用参数")) return <SlidersHorizontal />;
  if (label.includes("重新生成")) return <RotateCcw />;
  if (label.includes("源图")) return <ImagePlus />;
  if (label.includes("对比")) return <Split />;
  if (label.includes("删除")) return <Trash2 />;
  return <Info />;
}

export function AndroidHistoryActionSheet({
  item,
  items,
  onClose,
}: {
  item: HistoryItem;
  items: MenuItem[];
  onClose: () => void;
}) {
  const previewURL = useBlobURL(item.previewBlob ?? item.imageBlob ?? null, item.imageB64 ?? null);
  const imageSrc = historyPreviewSrc(item, previewURL);
  const primaryItems = useMemo(() => items.filter((action) => !action.danger), [items]);
  const dangerItems = useMemo(() => items.filter((action) => action.danger), [items]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.body.classList.add("android-history-sheet-open");
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.classList.remove("android-history-sheet-open");
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  function runAction(action: MenuItem) {
    if (action.disabled) return;
    vibrateForPlatform(action.danger ? 18 : 8);
    action.onClick();
    onClose();
  }

  const sheet = (
    <div className="android-history-action-layer" role="presentation">
      <button type="button" className="android-history-action-backdrop" aria-label="关闭" onClick={onClose} />
      <section
        className="android-history-action-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="历史结果操作"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="android-history-sheet-grabber" />
        <div className="android-history-sheet-head">
          <div className="android-history-sheet-preview">
            <img src={imageSrc} alt={item.prompt} loading="eager" decoding="async" />
            <HistoryModeBadge mode={item.mode} className="android-history-sheet-mode" />
          </div>
          <div className="android-history-sheet-copy">
            <span>历史结果</span>
            <strong>{item.prompt || "(无 prompt)"}</strong>
            <small>{sizeLabel(item.size)} · {qualityLabel(item.quality)} · {new Date(item.createdAt).toLocaleDateString()}</small>
          </div>
          <button type="button" className="android-history-sheet-close" onClick={onClose} aria-label="关闭">
            <X />
          </button>
        </div>

        <div className="android-history-sheet-actions">
          {primaryItems.map((action, index) => (
            <button
              key={`${action.label}-${index}`}
              type="button"
              className={action.separatorBefore ? "separator" : ""}
              disabled={action.disabled}
              onClick={() => runAction(action)}
            >
              <span className="android-history-sheet-action-icon"><IconForAction label={action.label} /></span>
              <span>{action.label}</span>
            </button>
          ))}
        </div>

        {dangerItems.length > 0 ? (
          <div className="android-history-sheet-actions android-history-sheet-danger">
            {dangerItems.map((action, index) => (
              <button
                key={`${action.label}-${index}`}
                type="button"
                disabled={action.disabled}
                onClick={() => runAction(action)}
              >
                <span className="android-history-sheet-action-icon"><IconForAction label={action.label} /></span>
                <span>{action.label}</span>
              </button>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );

  if (typeof document === "undefined") return sheet;
  return createPortal(sheet, document.body);
}
