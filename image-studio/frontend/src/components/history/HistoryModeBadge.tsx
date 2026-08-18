import { usePlatform } from "../../platform/context";
import type { Mode } from "../../types/domain";

export function HistoryModeBadge({
  mode,
  className = "",
}: {
  mode: Mode;
  className?: string;
}) {
  const { usesFluentUI } = usePlatform();
  return (
    <span
      className={`bg-black/46 px-1.5 py-0.5 text-[10px] text-white backdrop-blur-sm ${usesFluentUI ? "rounded-[6px]" : "rounded-full"} ${className}`.trim()}
    >
      {mode === "edit" ? "图生图" : "文生图"}
    </span>
  );
}
