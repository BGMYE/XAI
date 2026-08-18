import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { useStudioStore } from "../../state/studioStore";
import type { Toast } from "../../types/domain";
import { usePlatform } from "../../platform/context";

export function ToastContainer() {
  const toasts = useStudioStore((s) => s.toasts);
  const dismiss = useStudioStore((s) => s.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-14 right-4 z-[9050] flex flex-col gap-2 max-w-sm">
      {toasts.map((t) => (
        <ToastItem key={t.id} t={t} onClose={() => dismiss(t.id)} />
      ))}
    </div>
  );
}

function toneClasses(kind: Toast["kind"]): string {
  switch (kind) {
    case "success":
      return "border-[color:var(--accent)]/18 bg-white/92 text-zinc-700 dark:bg-zinc-900/92 dark:text-zinc-200";
    case "error":
      return "border-red-500/22 bg-white/92 text-red-700 dark:bg-zinc-900/92 dark:text-red-300";
    case "warn":
      return "border-amber-500/24 bg-white/92 text-amber-800 dark:bg-zinc-900/92 dark:text-amber-300";
    default:
      return "border-[color:var(--accent)]/18 bg-white/92 text-zinc-700 dark:bg-zinc-900/92 dark:text-zinc-200";
  }
}

function ToneIcon({ kind }: { kind: Toast["kind"] }) {
  const c = "w-4 h-4 shrink-0";
  switch (kind) {
    case "success": return <CheckCircle2 className={c} />;
    case "error":   return <XCircle className={c} />;
    case "warn":    return <AlertTriangle className={c} />;
    default:        return <Info className={c} />;
  }
}

function ToastItem({ t, onClose }: { t: Toast; onClose: () => void }) {
  const { usesFluentUI, usesAppleUI } = usePlatform();
  return (
    <div
      className={`flex items-center gap-2 border px-3 py-2 backdrop-blur-2xl shadow-[var(--shadow-card-hover)] animate-[toast-in_180ms_ease-out] ${toneClasses(t.kind)} ${usesAppleUI ? "liquid-glass-panel" : ""} ${usesFluentUI ? "rounded-[10px]" : "rounded-[18px]"}`}
      style={{ animation: "toast-in 180ms ease-out" }}
    >
      <ToneIcon kind={t.kind} />
      <span
        onClick={onClose}
        className="flex-1 text-xs leading-snug break-words cursor-pointer"
      >
        {t.text}
      </span>
      {t.action && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            t.action!.onClick();
            onClose();
          }}
          className={`whitespace-nowrap bg-black/[0.04] px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-black/[0.08] dark:bg-white/[0.06] dark:hover:bg-white/[0.1] ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
        >
          {t.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={onClose}
        className="opacity-60 hover:opacity-100"
      >
        <X className="w-3 h-3" />
      </button>
      <style>{`@keyframes toast-in { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }`}</style>
    </div>
  );
}
