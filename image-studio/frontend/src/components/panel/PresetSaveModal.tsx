import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { ArrowRight, CopyPlus, Save } from "lucide-react";
import { usePlatform } from "../../platform/context";
import { Modal } from "../common/Modal";

type SaveTarget = "current" | "new";

export function PresetSaveModal({
  open,
  mode,
  currentPreset,
  onClose,
  onOverwritePreset,
  onSaveAsNewPreset,
  suggestedName,
}: {
  open: boolean;
  mode: "save-current" | "new";
  currentPreset: { id: string; name: string } | null;
  onClose: () => void;
  onOverwritePreset: (id: string) => boolean;
  onSaveAsNewPreset: (name: string) => string | null;
  suggestedName: string;
}) {
  const { usesFluentUI } = usePlatform();
  const [target, setTarget] = useState<SaveTarget>("new");
  const [name, setName] = useState(suggestedName);

  useEffect(() => {
    if (!open) return;
    setTarget(mode === "save-current" && currentPreset ? "current" : "new");
    setName(suggestedName);
  }, [open, mode, currentPreset, suggestedName]);

  const canOverwriteCurrent = mode === "save-current" && !!currentPreset;
  const trimmedName = name.trim();

  function handleSubmit() {
    if (target === "current" && currentPreset) {
      if (onOverwritePreset(currentPreset.id)) onClose();
      return;
    }
    if (!trimmedName) return;
    if (onSaveAsNewPreset(trimmedName)) onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={mode === "new" ? "新建预设" : "保存当前预设"}
      width={560}
    >
      <div className="flex flex-col gap-4">
        <p className="text-[13px] leading-6 text-zinc-500 dark:text-zinc-300">
          {mode === "new"
            ? "把当前参数另存成一个新的预设，方便后续直接切换。"
            : "选择覆盖当前预设，或把这组参数另存成一个新预设。"}
        </p>

        {mode === "save-current" ? (
          <div className="grid gap-2">
            <SaveTargetCard
              active={target === "current"}
              disabled={!canOverwriteCurrent}
              icon={<Save className="h-4 w-4" />}
              title={currentPreset ? `保存到当前预设「${currentPreset.name}」` : "当前没有可覆盖的预设"}
              description={currentPreset ? "保留名称，直接用当前参数覆盖这条预设。" : "先选中一个预设，或改为保存到新预设。"}
              onClick={() => canOverwriteCurrent && setTarget("current")}
            />
            <SaveTargetCard
              active={target === "new"}
              icon={<CopyPlus className="h-4 w-4" />}
              title="保存到新的预设"
              description="保留现有预设，同时新增一条可单独维护的新预设。"
              onClick={() => setTarget("new")}
            />
          </div>
        ) : null}

        {(mode === "new" || target === "new") ? (
          <label className="flex flex-col gap-2">
            <span className="text-[12px] font-medium text-zinc-700 dark:text-zinc-200">预设名称</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={suggestedName}
              className={`focus-ring border border-black/[0.08] bg-[var(--surface)] px-3 py-2.5 text-[14px] text-zinc-900 dark:border-white/[0.08] dark:text-zinc-100 ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}
            />
            <span className="text-[11px] leading-5 text-zinc-500 dark:text-zinc-400">
              默认名称会按 `配置1 / 配置2 / 配置3` 自动递增。
            </span>
          </label>
        ) : null}

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className={`border border-black/[0.08] px-4 py-2 text-[12px] font-medium text-zinc-600 transition-colors hover:border-black/[0.14] hover:text-zinc-900 dark:border-white/[0.08] dark:text-zinc-300 dark:hover:text-zinc-100 ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={target === "new" && !trimmedName}
            className={`inline-flex items-center gap-1.5 bg-[var(--accent)] px-4 py-2 text-[12px] font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
          >
            <ArrowRight className="h-3.5 w-3.5" />
            {target === "current" ? "覆盖当前预设" : "保存到新预设"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function SaveTargetCard({
  active,
  description,
  disabled = false,
  icon,
  onClick,
  title,
}: {
  active: boolean;
  description: string;
  disabled?: boolean;
  icon: ReactNode;
  onClick: () => void;
  title: string;
}) {
  const { usesFluentUI } = usePlatform();

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex items-start gap-3 border px-3 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
        active
          ? "border-[color:var(--accent)]/35 bg-[var(--accent-soft)]"
          : "border-black/[0.08] hover:border-[color:var(--accent)]/25 dark:border-white/[0.08]"
      } ${usesFluentUI ? "rounded-[10px]" : "rounded-[16px]"}`}
    >
      <span className={`mt-0.5 shrink-0 ${active ? "text-[var(--accent)]" : "text-zinc-500 dark:text-zinc-400"}`}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-zinc-900 dark:text-zinc-100">{title}</span>
        <span className="mt-1 block text-[11px] leading-5 text-zinc-500 dark:text-zinc-400">{description}</span>
      </span>
    </button>
  );
}
