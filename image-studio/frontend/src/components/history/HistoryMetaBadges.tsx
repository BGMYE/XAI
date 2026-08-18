export function HistoryMetaBadges({
  items,
  compact = false,
  className = "",
}: {
  items: string[];
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={`flex min-w-0 flex-wrap items-center ${compact ? "gap-1" : "gap-1.5"} ${className}`.trim()}>
      {items.map((item) => (
        <span
          key={item}
          className={`inline-flex items-center border border-black/[0.05] bg-black/[0.025] px-2 py-0.5 text-zinc-500 dark:border-white/[0.05] dark:bg-white/[0.05] dark:text-zinc-300 ${compact ? "rounded-full text-[10px]" : "rounded-full text-[11px]"}`}
        >
          {item}
        </span>
      ))}
    </div>
  );
}
