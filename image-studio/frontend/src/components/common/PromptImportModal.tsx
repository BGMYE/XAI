import { ExternalLink, Languages } from "lucide-react";
import { Modal } from "./Modal";
import type { PromptImportPayloadLike } from "../../platform/runtime/hostTypes";

function promptPreview(text?: { zh?: string; en?: string } | null) {
  return {
    zh: text?.zh?.trim() || "",
    en: text?.en?.trim() || "",
  };
}

function PreviewBlock({
  title,
  text,
}: {
  title: string;
  text?: { zh?: string; en?: string } | null;
}) {
  const preview = promptPreview(text);
  return (
    <div className="rounded-[16px] border border-black/[0.06] bg-black/[0.02] p-3.5 dark:border-white/[0.08] dark:bg-white/[0.03]">
      <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400">
        <Languages className="h-3.5 w-3.5" />
        <span>{title}</span>
      </div>
      <div className="grid gap-2">
        <div>
          <div className="mb-1 text-[11px] text-zinc-400 dark:text-zinc-500">中文</div>
          <div className="rounded-[12px] border border-black/[0.05] bg-white/80 px-3 py-2 text-[13px] leading-6 text-zinc-800 dark:border-white/[0.06] dark:bg-zinc-950/40 dark:text-zinc-100">
            {preview.zh || <span className="opacity-50">(空)</span>}
          </div>
        </div>
        <div>
          <div className="mb-1 text-[11px] text-zinc-400 dark:text-zinc-500">English</div>
          <div className="rounded-[12px] border border-black/[0.05] bg-white/80 px-3 py-2 text-[13px] leading-6 text-zinc-800 dark:border-white/[0.06] dark:bg-zinc-950/40 dark:text-zinc-100">
            {preview.en || <span className="opacity-50">(空)</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

export function PromptImportModal({
  open,
  payload,
  resolvedSize,
  onClose,
  onConfirm,
}: {
  open: boolean;
  payload: PromptImportPayloadLike | null;
  resolvedSize: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const aspectRatio = payload?.aspect_ratio?.trim() || "auto";

  return (
    <Modal open={open} onClose={onClose} title="从 Image-Prompts 导入提示词" width={720}>
      <div className="flex flex-col gap-4">
        <div className="rounded-[18px] border border-[color:var(--accent)]/18 bg-[var(--accent-soft)] px-4 py-3 text-[13px] leading-6 text-zinc-700 dark:text-zinc-200">
          <div className="flex items-center gap-2 font-medium text-[var(--accent)]">
            <ExternalLink className="h-4 w-4" />
            <span>来源站点: prompts.sorry.ink</span>
          </div>
          <p className="mt-2 mb-0 text-[12px] leading-6 text-zinc-600 dark:text-zinc-300">
            确认后将覆盖当前表单中的提示词、反向提示词与尺寸，不会改动参考图、模式、批处理或上游配置。
          </p>
        </div>

        <PreviewBlock title="正向提示词" text={payload?.prompt} />
        <PreviewBlock title="反向提示词" text={payload?.negative_prompt} />

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-[16px] border border-black/[0.06] bg-black/[0.02] p-3.5 dark:border-white/[0.08] dark:bg-white/[0.03]">
            <div className="mb-1 text-[11px] uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400">站点比例</div>
            <div className="text-[14px] font-semibold text-zinc-900 dark:text-zinc-100">{aspectRatio}</div>
          </div>
          <div className="rounded-[16px] border border-black/[0.06] bg-black/[0.02] p-3.5 dark:border-white/[0.08] dark:bg-white/[0.03]">
            <div className="mb-1 text-[11px] uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400">应用后尺寸</div>
            <div className="text-[14px] font-semibold text-zinc-900 dark:text-zinc-100">{resolvedSize || "auto"}</div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-black/[0.08] px-4 py-2 text-[13px] text-zinc-700 transition-colors hover:bg-black/[0.04] dark:border-white/[0.08] dark:text-zinc-200 dark:hover:bg-white/[0.06]"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-full bg-[var(--accent)] px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-[var(--accent-2)]"
          >
            导入到表单
          </button>
        </div>
      </div>
    </Modal>
  );
}
