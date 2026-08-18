import { usePlatform } from "../../platform/context";

type ToolBtnProps = {
  active?: boolean;
  className?: string;
  disabled?: boolean;
  labelClassName?: string;
  onClick?: () => void;
  title?: string;
  label?: string;
  children: React.ReactNode;
};

export function pillRadius(usesFluentUI: boolean): string {
  return usesFluentUI ? "rounded-[8px]" : "rounded-full";
}

export function colorDotRadius(usesFluentUI: boolean): string {
  return usesFluentUI ? "rounded-[6px]" : "rounded-full";
}

export function ToolBtn({ active, className, disabled, labelClassName, onClick, title, label, children }: ToolBtnProps) {
  const { isMac, usesFluentUI, usesAndroidUI } = usePlatform();
  const macWidthClass = !label
    ? "min-w-[74px]"
    : label.length >= 4
      ? "min-w-[148px]"
      : label.length >= 3
        ? "min-w-[116px]"
        : label.length >= 2
          ? "min-w-[96px]"
          : "min-w-[84px]";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`platform-icon-btn flex shrink-0 items-center justify-center transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${
        active
          ? "border border-[color:var(--accent)]/20 bg-[var(--accent-soft)] text-[var(--accent)]"
          : "text-zinc-600 hover:bg-black/[0.04] hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/[0.06] dark:hover:text-zinc-100"
      } ${usesAndroidUI ? "h-12 w-12 rounded-[16px]" : isMac ? `${macWidthClass} min-h-[36px] rounded-[14px] px-3.5 py-1.5 text-[11px]` : usesFluentUI ? "h-8 w-8 rounded-[8px]" : "h-8 w-8 rounded-full"} ${className ?? ""}`.trim()}
    >
      <span className={`inline-flex items-center ${isMac && label ? "gap-1.5 whitespace-nowrap" : ""}`}>
        {children}
        {isMac && label ? <span className={`leading-none tracking-[0.01em] ${labelClassName ?? ""}`.trim()}>{label}</span> : null}
      </span>
    </button>
  );
}

type ToolbarTextButtonProps = {
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  onClick?: () => void;
  selected?: boolean;
  title?: string;
  tone?: "neutral" | "danger" | "accent";
};

export function ToolbarTextButton({
  children,
  className,
  disabled,
  onClick,
  selected,
  title,
  tone = "neutral",
}: ToolbarTextButtonProps) {
  const { isMac, usesFluentUI } = usePlatform();
  const toneClass = selected
    ? "bg-[var(--accent-soft)] text-[var(--accent)]"
    : tone === "danger"
      ? "text-zinc-500 hover:bg-red-400/10 hover:text-red-400 dark:text-zinc-400"
      : tone === "accent"
        ? "border border-[color:var(--accent)]/20 bg-[var(--accent-soft)] text-[var(--accent)] hover:opacity-90"
        : "text-zinc-600 hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] dark:text-zinc-400";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex shrink-0 items-center justify-center gap-1 rounded-[14px] px-3 py-1.5 text-[11px] font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${toneClass} ${
        isMac ? "min-h-[34px]" : usesFluentUI ? "min-h-[30px] rounded-[8px]" : "min-h-[30px] rounded-full"
      } ${className ?? ""}`.trim()}
    >
      {children}
    </button>
  );
}

type ToolbarPrimaryButtonProps = {
  children: React.ReactNode;
  onClick?: () => void;
  title?: string;
};

export function ToolbarPrimaryButton({ children, onClick, title }: ToolbarPrimaryButtonProps) {
  const { isMac, usesFluentUI } = usePlatform();
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`liquid-primary-button inline-flex shrink-0 items-center justify-center gap-1.5 bg-[var(--accent)] font-medium text-white whitespace-nowrap transition-colors hover:bg-[var(--accent-2)] ${
        isMac ? "min-h-[34px] min-w-[110px] rounded-[14px] px-4 py-2 text-[11px]" : usesFluentUI ? "rounded-[8px] px-3 py-1.5 text-[11px]" : "rounded-full px-3 py-1.5 text-[11px]"
      }`}
    >
      {children}
    </button>
  );
}

export function ToolbarNote({ children }: { children: React.ReactNode }) {
  return <span className="toolbar-note">{children}</span>;
}

export function ToolbarGroup({
  className,
  caption,
  children,
}: {
  className?: string;
  caption?: string;
  children: React.ReactNode;
}) {
  const { isMac } = usePlatform();
  const withCaption = isMac && !!caption;
  return (
    <div className={`toolbar-group ${withCaption ? "toolbar-group-with-caption" : ""} ${className ?? ""}`.trim()}>
      {withCaption ? <div className="toolbar-group-caption">{caption}</div> : null}
      <div className="toolbar-group-body">{children}</div>
    </div>
  );
}

export function Sep() {
  return <span className="mx-0.5 h-4 w-px bg-black/10 dark:bg-white/10" />;
}
