import { usePlatform } from "../../platform/context";

export function Section({
  label, trailing, children,
}: {
  label: React.ReactNode;
  trailing?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { isAndroidPhone, usesFluentUI } = usePlatform();
  return (
    <section className={`platform-card border border-black/[0.05] bg-white/70 shadow-[var(--shadow-card)] dark:border-white/[0.06] dark:bg-white/[0.03] ${isAndroidPhone ? "p-3" : "p-4"} ${usesFluentUI ? "rounded-[12px]" : "rounded-[20px]"}`}>
      <div className={`flex items-center justify-between ${isAndroidPhone ? "mb-1" : "mb-1.5"}`}>
        <label className="text-[11px] uppercase tracking-[0.12em] text-zinc-400 dark:text-zinc-500">{label}</label>
        {trailing}
      </div>
      {children}
    </section>
  );
}

export function Seg({ children }: { children: React.ReactNode }) {
  const { usesFluentUI } = usePlatform();
  return (
    <div className={`platform-seg flex flex-wrap gap-1 bg-black/[0.04] p-0.5 ring-1 ring-black/[0.05] dark:bg-white/[0.06] dark:ring-white/[0.06] ${usesFluentUI ? "rounded-[10px]" : "rounded-[18px]"}`}>
      {children}
    </div>
  );
}

export function SegItem({ active, onClick, children }: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const { usesFluentUI } = usePlatform();
  return (
    <button
      type="button"
      onClick={onClick}
      className={`platform-chip flex-1 px-3 py-1.5 text-[12px] font-medium leading-none transition-colors ${
        active
          ? "active bg-white text-zinc-900 shadow-sm dark:bg-zinc-900 dark:text-zinc-100"
          : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200"
      } ${usesFluentUI ? "rounded-[8px]" : "min-h-[34px] rounded-full"}`}
    >
      {children}
    </button>
  );
}
