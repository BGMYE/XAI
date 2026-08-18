import { Image as ImageIcon } from "lucide-react";
import { usePlatform } from "../../platform/context";
import { HitokotoStrip } from "./HitokotoStrip";

export function AppHeaderBrand() {
  const { isAndroidPhone, isAndroidPad, usesFluentUI, isMac, isWindows, usesAndroidUI } = usePlatform();

  if (usesAndroidUI) {
    return (
      <>
        <div
          className={`android-header-title text-zinc-900 dark:text-zinc-100 ${
            isAndroidPhone
              ? "text-[10px] font-semibold tracking-[0]"
              : isAndroidPad
                ? "text-[15px] font-semibold tracking-[0]"
                : usesFluentUI
                  ? "font-[600] text-[14px] tracking-[0]"
                  : "text-[13px] font-semibold tracking-[-0.01em]"
          }`}
          style={{ fontFamily: "var(--title-font)" }}
        >
          Image Studio
        </div>
        {!isAndroidPhone ? (
          <div className="android-header-subtitle mt-0.5 flex min-w-0 items-center gap-2 text-[12px] text-zinc-500 dark:text-zinc-400">
            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
            <span className="truncate">{isAndroidPad ? "自适应大屏工作区" : "移动创作工作区"}</span>
          </div>
        ) : null}
      </>
    );
  }

  if (isWindows) {
    return (
      <>
        <div
          className="text-[14px] font-[600] tracking-[0] text-zinc-900 dark:text-zinc-100"
          style={{ fontFamily: "var(--title-font)" }}
        >
          Image Studio
        </div>
        <div className="mt-0 flex min-w-0 items-center text-[10px] text-zinc-500 dark:text-zinc-400">
          <HitokotoStrip />
        </div>
      </>
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-3.5">
      <span className={`inline-flex shrink-0 items-center justify-center border border-white/44 bg-white/70 text-[var(--accent)] shadow-[0_12px_32px_rgb(15_23_42_/_0.12)] dark:border-white/10 dark:bg-white/[0.06] ${usesFluentUI ? "h-8 w-8 rounded-[10px]" : isMac ? "h-10 w-10 rounded-[14px]" : "h-10 w-10 rounded-[13px]"}`}>
        <ImageIcon className="h-4.5 w-4.5" />
      </span>
      <div className="min-w-0 leading-tight">
        <div
          className={`android-header-title text-zinc-900 dark:text-zinc-100 ${
            usesFluentUI
              ? "font-[600] text-[14px] tracking-[0]"
              : isMac
                ? "text-[16px] font-semibold tracking-[-0.01em]"
                : "text-[16px] font-semibold tracking-[-0.02em]"
          }`}
          style={{ fontFamily: "var(--title-font)" }}
        >
          Image Studio
        </div>
        {isMac ? (
          <div className="mt-1 truncate text-[12px] leading-none text-zinc-500 dark:text-zinc-400">
            图像工作区
          </div>
        ) : (
          <div className={`flex min-w-0 items-center text-zinc-500 dark:text-zinc-400 ${usesFluentUI ? "mt-0 text-[10px]" : "mt-0.5 text-[11px]"}`}>
            <HitokotoStrip />
          </div>
        )}
      </div>
    </div>
  );
}
