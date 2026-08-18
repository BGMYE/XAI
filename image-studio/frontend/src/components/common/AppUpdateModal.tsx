import { BellRing, Download, X } from "lucide-react";
import { Modal } from "./Modal";
import { OpenExternalURL } from "../../platform/runtime/host";
import { useStudioStore } from "../../state/studioStore";
import { usePlatform } from "../../platform/context";
import { openExternalURLForPlatform } from "../../platform/android/bridge";
import { scheduleCompatibilityExport } from "../../lib/compatState";

export function AppUpdateModal() {
  const update = useStudioStore((state) => state.appUpdate);
  const open = useStudioStore((state) => state.appUpdateModalOpen);
  const dismiss = useStudioStore((state) => state.dismissAppUpdateModal);
  const ignore = useStudioStore((state) => state.ignoreAppUpdate);
  const pushToast = useStudioStore((state) => state.pushToast);
  const { usesFluentUI } = usePlatform();

  if (!open || !update) return null;

  const summary = update.body?.trim()
    ? update.body.trim().slice(0, 140)
    : "GitHub Releases 已发布新版本。";

  return (
    <Modal open={open} onClose={dismiss} title="发现新版本" width={460}>
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3 rounded-[18px] border border-[var(--accent)]/15 bg-[var(--accent-soft)]/60 px-4 py-3">
          <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center bg-[var(--accent)] text-white ${usesFluentUI ? "rounded-[10px]" : "rounded-2xl"}`}>
            <BellRing className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              v{update.latestVersion} 已发布
            </div>
            <div className="mt-1 text-[12px] leading-6 text-zinc-600 dark:text-zinc-300">
              当前版本 v{update.currentVersion}
              {update.releaseName ? ` · ${update.releaseName}` : ""}
            </div>
          </div>
        </div>

        <div className="rounded-[18px] border border-black/[0.06] bg-black/[0.02] px-4 py-3 text-[13px] leading-6 text-zinc-700 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-zinc-200">
          {summary}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              openExternalURLForPlatform(update.releaseURL, OpenExternalURL)
                .catch(() => pushToast("无法打开发布页", "error"));
            }}
            className={`liquid-primary-button inline-flex flex-1 items-center justify-center gap-1.5 bg-[var(--accent)] px-3 py-2.5 text-sm font-medium text-white hover:bg-[var(--accent-2)] ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
          >
            <Download className="h-4 w-4" /> 立即查看更新
          </button>
          <button
            type="button"
            onClick={dismiss}
            className={`inline-flex items-center justify-center gap-1.5 border border-black/[0.08] px-3 py-2.5 text-sm text-zinc-700 hover:bg-black/[0.04] dark:border-white/[0.08] dark:text-zinc-200 dark:hover:bg-white/[0.06] ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
          >
            <X className="h-4 w-4" /> 稍后再说
          </button>
        </div>

        <button
          type="button"
          onClick={() => {
            ignore(update.releaseTag);
            scheduleCompatibilityExport(useStudioStore.getState());
            pushToast(`后续不再提醒 ${update.releaseTag} 版本更新`, "success");
          }}
          className="self-start text-[12px] text-zinc-500 underline-offset-4 hover:text-zinc-700 hover:underline dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          不再提示这个版本
        </button>
      </div>
    </Modal>
  );
}
