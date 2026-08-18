import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import {
  OUTPUT_FORMAT_OPTIONS,
  SIZE_OPTIONS,
  type Preset,
  type QualityValue,
  type SizeValue,
} from "../../types/domain";
import { Modal } from "../common/Modal";
import { usePlatform } from "../../platform/context";
import { STYLE_CHIPS } from "./panelOptions";

const QUALITY_OPTIONS: Array<{ value: QualityValue; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
  { value: "standard", label: "标准" },
  { value: "hd", label: "HD" },
];

const BATCH_COUNT_OPTIONS = [1, 2, 4, 6, 8, 9] as const;

type PresetDraft = {
  name: string;
  size: SizeValue;
  quality: QualityValue;
  outputFormat: Preset["outputFormat"];
  batchCount: number;
  styleTag: string;
};

export function PresetManagerModal({
  open,
  presets,
  selectedPresetId,
  onClose,
  onDeletePreset,
  onUpdatePreset,
}: {
  open: boolean;
  presets: Preset[];
  selectedPresetId: string | null;
  onClose: () => void;
  onDeletePreset: (id: string) => void;
  onUpdatePreset: (id: string, patch: Partial<Omit<Preset, "id">>) => boolean;
}) {
  const [drafts, setDrafts] = useState<Record<string, PresetDraft>>({});

  useEffect(() => {
    if (!open) return;
    const nextDrafts: Record<string, PresetDraft> = {};
    for (const preset of presets) {
      nextDrafts[preset.id] = {
        name: preset.name,
        size: preset.size,
        quality: preset.quality,
        outputFormat: preset.outputFormat ?? "png",
        batchCount: preset.batchCount,
        styleTag: preset.styleTag ?? "",
      };
    }
    setDrafts(nextDrafts);
  }, [open, presets]);

  const sizeOptions = useMemo(() => {
    const entries = [...SIZE_OPTIONS];
    for (const preset of presets) {
      if (entries.some((item) => item.value === preset.size)) continue;
      entries.push({ value: preset.size, label: preset.size === "auto" ? "自动 auto" : preset.size });
    }
    return entries;
  }, [presets]);

  function updateDraft(id: string, patch: Partial<PresetDraft>) {
    setDrafts((current) => ({
      ...current,
      [id]: {
        ...current[id],
        ...patch,
      },
    }));
  }

  function saveDraft(id: string) {
    const draft = drafts[id];
    if (!draft) return;
    onUpdatePreset(id, {
      name: draft.name,
      size: draft.size,
      quality: draft.quality,
      outputFormat: draft.outputFormat ?? "png",
      batchCount: draft.batchCount,
      styleTag: draft.styleTag,
    });
  }

  function deleteDraft(id: string) {
    const preset = presets.find((item) => item.id === id);
    if (!preset) return;
    if (!confirm(`确定删除预设「${preset.name}」吗?`)) return;
    onDeletePreset(id);
    setDrafts((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="预设管理"
      width={760}
      bodyClassName="max-h-[70vh]"
    >
      <div className="flex flex-col gap-4">
        <p className="text-[13px] leading-6 text-zinc-500 dark:text-zinc-300">
          这里可以修改预设名称和常用参数。未展示的高级参数会原样保留。
        </p>

        {presets.length === 0 ? (
          <div className="rounded-[16px] border border-dashed border-black/[0.12] px-4 py-5 text-[13px] text-zinc-500 dark:border-white/[0.1] dark:text-zinc-400">
            还没有任何预设，先从当前参数新建一条。
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {presets.map((preset) => {
              const draft = drafts[preset.id];
              if (!draft) return null;
              return (
                <PresetManagerCard
                  key={preset.id}
                  draft={draft}
                  isSelected={selectedPresetId === preset.id}
                  onChange={(patch) => updateDraft(preset.id, patch)}
                  onDelete={() => deleteDraft(preset.id)}
                  onSave={() => saveDraft(preset.id)}
                  sizeOptions={sizeOptions}
                />
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}

function PresetManagerCard({
  draft,
  isSelected,
  onChange,
  onDelete,
  onSave,
  sizeOptions,
}: {
  draft: PresetDraft;
  isSelected: boolean;
  onChange: (patch: Partial<PresetDraft>) => void;
  onDelete: () => void;
  onSave: () => void;
  sizeOptions: Array<{ value: SizeValue; label: string }>;
}) {
  const { usesFluentUI } = usePlatform();

  return (
    <section className={`border border-black/[0.08] bg-[var(--surface)] px-4 py-4 dark:border-white/[0.08] ${usesFluentUI ? "rounded-[12px]" : "rounded-[18px]"}`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-zinc-900 dark:text-zinc-100">{draft.name || "未命名预设"}</div>
          <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
            {isSelected ? "当前选中的预设" : "可单独编辑并保存"}
          </div>
        </div>
        <button
          type="button"
          onClick={onDelete}
          className={`inline-flex items-center gap-1.5 border border-red-400/25 px-3 py-2 text-[12px] text-red-500 transition-colors hover:bg-red-500/10 ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
          删除
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <PresetField label="预设名称">
          <input
            value={draft.name}
            onChange={(e) => onChange({ name: e.target.value })}
            className={`focus-ring w-full border border-black/[0.08] bg-white/70 px-3 py-2 text-[13px] text-zinc-900 dark:border-white/[0.08] dark:bg-black/10 dark:text-zinc-100 ${usesFluentUI ? "rounded-[8px]" : "rounded-[12px]"}`}
          />
        </PresetField>

        <PresetField label="尺寸">
          <select
            value={draft.size}
            onChange={(e) => onChange({ size: e.target.value as SizeValue })}
            className={`focus-ring w-full border border-black/[0.08] bg-white/70 px-3 py-2 text-[13px] text-zinc-900 dark:border-white/[0.08] dark:bg-black/10 dark:text-zinc-100 ${usesFluentUI ? "rounded-[8px]" : "rounded-[12px]"}`}
          >
            {sizeOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </PresetField>

        <PresetField label="质量">
          <select
            value={draft.quality}
            onChange={(e) => onChange({ quality: e.target.value as QualityValue })}
            className={`focus-ring w-full border border-black/[0.08] bg-white/70 px-3 py-2 text-[13px] text-zinc-900 dark:border-white/[0.08] dark:bg-black/10 dark:text-zinc-100 ${usesFluentUI ? "rounded-[8px]" : "rounded-[12px]"}`}
          >
            {QUALITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </PresetField>

        <PresetField label="输出格式">
          <select
            value={draft.outputFormat ?? "png"}
            onChange={(e) => onChange({ outputFormat: e.target.value as Preset["outputFormat"] })}
            className={`focus-ring w-full border border-black/[0.08] bg-white/70 px-3 py-2 text-[13px] text-zinc-900 dark:border-white/[0.08] dark:bg-black/10 dark:text-zinc-100 ${usesFluentUI ? "rounded-[8px]" : "rounded-[12px]"}`}
          >
            {OUTPUT_FORMAT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </PresetField>

        <PresetField label="风格">
          <select
            value={draft.styleTag}
            onChange={(e) => onChange({ styleTag: e.target.value })}
            className={`focus-ring w-full border border-black/[0.08] bg-white/70 px-3 py-2 text-[13px] text-zinc-900 dark:border-white/[0.08] dark:bg-black/10 dark:text-zinc-100 ${usesFluentUI ? "rounded-[8px]" : "rounded-[12px]"}`}
          >
            <option value="">默认风格</option>
            {STYLE_CHIPS.map((style) => (
              <option key={style.id} value={style.id}>{style.label}</option>
            ))}
          </select>
        </PresetField>

        <PresetField label="出图张数">
          <select
            value={draft.batchCount}
            onChange={(e) => onChange({ batchCount: Number(e.target.value) })}
            className={`focus-ring w-full border border-black/[0.08] bg-white/70 px-3 py-2 text-[13px] text-zinc-900 dark:border-white/[0.08] dark:bg-black/10 dark:text-zinc-100 ${usesFluentUI ? "rounded-[8px]" : "rounded-[12px]"}`}
          >
            {BATCH_COUNT_OPTIONS.map((count) => (
              <option key={count} value={count}>{count} 张</option>
            ))}
          </select>
        </PresetField>
      </div>

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={onSave}
          className={`bg-[var(--accent)] px-4 py-2 text-[12px] font-medium text-white transition-opacity hover:opacity-90 ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
        >
          保存修改
        </button>
      </div>
    </section>
  );
}

function PresetField({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-300">{label}</span>
      {children}
    </label>
  );
}
