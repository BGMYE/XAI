import {
  Clipboard,
  FileText,
  FolderOpen,
  ImagePlus,
  Info,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Split,
  Trash2,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { usePlatform } from "../../platform/context";

export interface MenuItem {
  label: string;
  icon?: string | ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
}

function FluentMenuIcon({ item }: { item: MenuItem }) {
  const iconClass = "h-3.5 w-3.5";
  const label = item.label.toLowerCase();

  if (item.danger || label.includes("删除") || label.includes("清空")) return <Trash2 className={iconClass} />;
  if (label.includes("详情")) return <Info className={iconClass} />;
  if (label.includes("复制 prompt")) return <Clipboard className={iconClass} />;
  if (label.includes("路径")) return <FolderOpen className={iconClass} />;
  if (label.includes("raw")) return <FileText className={iconClass} />;
  if (label.includes("参数(不生成)") || label.includes("应用参数")) return <SlidersHorizontal className={iconClass} />;
  if (label.includes("重新生成")) return <RotateCcw className={iconClass} />;
  if (label.includes("源图")) return <ImagePlus className={iconClass} />;
  if (label.includes("对比")) return <Split className={iconClass} />;
  if (label.includes("另存为")) return <Save className={iconClass} />;
  if (label.includes("关闭") || label.includes("取消")) return <X className={iconClass} />;

  if (typeof item.icon !== "string") return <>{item.icon}</>;
  return <Info className={iconClass} />;
}

function LegacyMenuIcon({ icon }: { icon?: MenuItem["icon"] }) {
  if (!icon) return null;
  if (typeof icon !== "string") return <>{icon}</>;
  return <>{icon}</>;
}

export function ContextMenu({
  x, y, items, onClose,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}) {
  const { usesFluentUI, usesAppleUI } = usePlatform();
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const w = 236;
  const ah = 36;
  const h = items.length * ah + 8;
  const left = Math.max(8, Math.min(x, window.innerWidth - w - 8));
  const top = Math.max(8, Math.min(y, window.innerHeight - h - 8));

  const menu = (
    <div
      ref={ref}
      style={{ position: "fixed", left, top, width: w }}
      onContextMenu={(e) => e.preventDefault()}
      className={`context-menu z-[9200] overflow-hidden border border-black/[0.08] bg-white/95 py-1 shadow-[0_24px_60px_rgb(15_23_42_/_0.16)] backdrop-blur-2xl dark:border-white/[0.08] dark:bg-zinc-900/95 ${usesAppleUI ? "liquid-glass-panel" : ""} ${usesFluentUI ? "rounded-[12px]" : "rounded-[18px]"}`}
    >
      {items.map((it, i) => (
        <div key={i}>
          {it.separatorBefore && <div className="context-menu-separator h-px my-1 bg-black/5 dark:bg-white/5" />}
          <button
            onClick={() => { if (!it.disabled) { it.onClick(); onClose(); } }}
            disabled={it.disabled}
            className={`context-menu-item w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              it.danger
                ? "danger text-red-500 hover:bg-red-500/10"
                : "text-zinc-700 dark:text-zinc-300 hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
            }`}
          >
            <span className="context-menu-icon w-4 text-center">
              {usesFluentUI ? <FluentMenuIcon item={it} /> : <LegacyMenuIcon icon={it.icon} />}
            </span>
            <span className="context-menu-label min-w-0">{it.label}</span>
          </button>
        </div>
      ))}
    </div>
  );

  if (typeof document === "undefined") return menu;
  return createPortal(menu, document.body);
}
