import { useEffect, useState } from "react";
import { FolderOpen } from "lucide-react";
import { useStudioStore } from "../../state/studioStore";
import type { LoopGenerationConfig } from "../../types/domain";
import { usePlatform } from "../../platform/context";
import { ChooseOutputDir, GetOutputDir, getHostCapabilities } from "../../platform/runtime/host";
import { Modal } from "../common/Modal";
import {
  MAX_LOOP_GENERATION_CONCURRENCY,
  MAX_LOOP_GENERATION_COUNT,
} from "../../state/workspaceRuntime";

function summaryText(value: LoopGenerationConfig): string {
  if (!value.enabled) return "关闭";
  const parts = [
    `${value.totalCount} 张`,
    `并发 ${value.concurrency}`,
    value.livePreview ? "实时预览开" : "实时预览关",
  ];
  if (value.autoSave) {
    const dirLabel = value.autoSaveDir.split(/[\\/]/).filter(Boolean).pop() || "待选路径";
    parts.push(`自动另存为 · ${dirLabel}`);
  }
  return parts.join(" · ");
}

function ToggleSwitch({
  checked,
  onChange,
  roundedClassName,
  ariaLabel,
  showStateLabel = true,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  roundedClassName: string;
  ariaLabel: string;
  showStateLabel?: boolean;
}) {
  const stateLabel = checked ? "已开启" : "已关闭";

  return (
    <div className="inline-flex items-center gap-2.5">
      {showStateLabel ? (
        <span
          className={`inline-flex min-h-[26px] min-w-[58px] items-center justify-center border px-2.5 text-[11px] font-semibold tracking-[0.04em] transition-colors ${
            checked
              ? "border-[color:var(--accent)]/20 bg-[var(--accent-soft)] text-[var(--accent)] shadow-[0_0_0_1px_rgb(0_122_255_/_0.08)]"
              : "border-black/[0.08] bg-black/[0.04] text-zinc-500 dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-zinc-300"
          } ${roundedClassName}`}
        >
          {stateLabel}
        </span>
      ) : null}
      <button
        type="button"
        role="switch"
        aria-label={ariaLabel}
        aria-checked={checked}
        onClick={(event) => {
          event.stopPropagation();
          onChange(!checked);
        }}
        className={`relative inline-flex h-7 w-[52px] shrink-0 items-center border shadow-[inset_0_1px_2px_rgb(255_255_255_/_0.08)] transition-all duration-200 ${
          checked
            ? "border-[color:var(--accent)]/35 bg-[var(--accent)] shadow-[0_10px_24px_-14px_rgb(0_122_255_/_0.9)]"
            : "border-black/[0.12] bg-zinc-300 shadow-[inset_0_1px_3px_rgb(255_255_255_/_0.24)] dark:border-white/[0.1] dark:bg-zinc-700/95"
        } ${roundedClassName}`}
      >
        <span
          className={`inline-block h-5.5 w-5.5 border shadow-[0_2px_8px_rgb(15_23_42_/_0.18)] transition-all duration-200 ${
            checked
              ? "translate-x-[26px] border-white/70 bg-white"
              : "translate-x-0.5 border-black/5 bg-white dark:border-white/10 dark:bg-zinc-100"
          } ${roundedClassName}`}
        />
      </button>
    </div>
  );
}

export function LoopGenerationSection({
  value,
  onChange,
}: {
  value: LoopGenerationConfig;
  onChange: (next: LoopGenerationConfig) => void;
}) {
  const pushToast = useStudioStore((state) => state.pushToast);
  const { isAndroidPhone, isMac, usesFluentUI } = usePlatform();
  const hostCapabilities = getHostCapabilities();
  const [open, setOpen] = useState(false);
  const [currentOutputDir, setCurrentOutputDir] = useState("");
  const roundedClassName = usesFluentUI ? "rounded-[10px]" : "rounded-full";

  useEffect(() => {
    if (!open) return;
    GetOutputDir().then((dir) => {
      setCurrentOutputDir(dir);
    }).catch(() => undefined);
  }, [open]);

  function patchConfig(patch: Partial<LoopGenerationConfig>) {
    onChange({ ...value, ...patch });
  }

  async function chooseDirectory() {
    try {
      const chosen = await ChooseOutputDir();
      if (!chosen) return;
      patchConfig({ autoSave: true, autoSaveDir: chosen });
      pushToast(`已选择自动另存为目录:${chosen}`, "success");
    } catch (error: any) {
      pushToast(`选择目录失败:${error?.message ?? error}`, "error", 6000);
    }
  }

  const cardClassName = usesFluentUI
    ? "platform-card rounded-[12px] border border-black/[0.05] bg-white/70 px-4 py-3.5 dark:border-white/[0.06] dark:bg-white/[0.03]"
    : isMac
      ? "platform-card rounded-[22px] border border-black/[0.05] bg-white/70 px-4.5 py-4 dark:border-white/[0.06] dark:bg-white/[0.03]"
      : "platform-card rounded-[18px] border border-black/[0.05] bg-white/70 px-4 py-3.5 dark:border-white/[0.06] dark:bg-white/[0.03]";

  return (
    <>
      <section className={cardClassName}>
        <div
          role="button"
          tabIndex={0}
          onClick={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setOpen(true);
            }
          }}
          className="flex w-full items-center justify-between gap-3 text-left"
        >
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-[0.12em] text-zinc-400 dark:text-zinc-500">循环出图</div>
            <div className="mt-1.5 min-w-0 truncate text-[13px] leading-6 text-zinc-600 dark:text-zinc-300">
              {summaryText(value)}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span
              className={`inline-flex min-h-[28px] items-center border px-2.5 text-[11px] font-semibold tracking-[0.04em] ${
                value.enabled
                  ? "border-[color:var(--accent)]/20 bg-[var(--accent-soft)] text-[var(--accent)] shadow-[0_0_0_1px_rgb(0_122_255_/_0.08)]"
                  : "border-black/[0.08] bg-black/[0.04] text-zinc-500 dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-zinc-300"
              } ${roundedClassName}`}
            >
              {value.enabled ? "开启中" : "已关闭"}
            </span>
            <ToggleSwitch
              checked={value.enabled}
              onChange={(next) => {
                patchConfig({ enabled: next });
                if (next) setOpen(true);
              }}
              roundedClassName={roundedClassName}
              ariaLabel="切换循环出图"
              showStateLabel={false}
            />
          </div>
        </div>
      </section>

      <Modal open={open} onClose={() => setOpen(false)} title="循环出图" width={isAndroidPhone ? 420 : 720}>
        <div className="space-y-4">
          <section className={`border border-black/[0.06] bg-[var(--surface)] px-4 py-3.5 dark:border-white/[0.06] ${usesFluentUI ? "rounded-[12px]" : "rounded-[18px]"}`}>
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-[14px] font-semibold text-zinc-900 dark:text-zinc-100">启用循环出图</div>
                <p className="mt-1 text-[12px] leading-6 text-zinc-500 dark:text-zinc-400">
                  开启后会按这里的总张数和并发持续补位生成；常规“出图张数”只在普通模式下生效。
                </p>
              </div>
              <ToggleSwitch
                checked={value.enabled}
                onChange={(next) => patchConfig({ enabled: next })}
                roundedClassName={roundedClassName}
                ariaLabel="启用循环出图"
              />
            </div>
          </section>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-2">
              <span className="block text-[13px] font-medium text-zinc-900 dark:text-zinc-100">需要的张数</span>
              <input
                type="number"
                min={1}
                max={MAX_LOOP_GENERATION_COUNT}
                value={value.totalCount}
                onChange={(event) => patchConfig({ totalCount: Number(event.target.value) || 1 })}
                className={`focus-ring w-full border border-black/[0.08] bg-[var(--surface)] px-3 py-2.5 text-[13px] text-zinc-900 dark:border-white/[0.08] dark:text-zinc-100 ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}
              />
              <p className="text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                1 到 {MAX_LOOP_GENERATION_COUNT} 张，按完成情况自动继续补位。
              </p>
            </label>

            <label className="space-y-2">
              <span className="block text-[13px] font-medium text-zinc-900 dark:text-zinc-100">并发配置</span>
              <input
                type="number"
                min={1}
                max={MAX_LOOP_GENERATION_CONCURRENCY}
                value={value.concurrency}
                onChange={(event) => patchConfig({ concurrency: Number(event.target.value) || 1 })}
                className={`focus-ring w-full border border-black/[0.08] bg-[var(--surface)] px-3 py-2.5 text-[13px] text-zinc-900 dark:border-white/[0.08] dark:text-zinc-100 ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}
              />
              <p className="text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                默认 2，并发越高占用越大，也会受到上游并发限制约束。
              </p>
            </label>
          </div>

          <section className={`border border-black/[0.06] bg-[var(--surface)] px-4 py-3.5 dark:border-white/[0.06] ${usesFluentUI ? "rounded-[12px]" : "rounded-[18px]"}`}>
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-[14px] font-semibold text-zinc-900 dark:text-zinc-100">自动另存为</div>
                <p className="mt-1 text-[12px] leading-6 text-zinc-500 dark:text-zinc-400">
                  每张图生成成功后会额外复制到下面的目录，不影响默认输出目录。
                </p>
              </div>
              <ToggleSwitch
                checked={value.autoSave}
                onChange={(next) => patchConfig({
                  autoSave: next,
                  autoSaveDir: next && !value.autoSaveDir.trim() ? currentOutputDir : value.autoSaveDir,
                })}
                roundedClassName={roundedClassName}
                ariaLabel="切换自动另存为"
              />
            </div>

            <div className={`mt-3 space-y-2 ${value.autoSave ? "" : "opacity-55"}`}>
              <input
                value={value.autoSaveDir}
                onChange={(event) => patchConfig({ autoSaveDir: event.target.value })}
                disabled={!value.autoSave}
                placeholder={currentOutputDir || "请输入或选择自动另存为目录"}
                className={`focus-ring w-full border px-3 py-2.5 text-[13px] text-zinc-900 disabled:cursor-not-allowed disabled:bg-black/[0.03] disabled:text-zinc-400 dark:border-white/[0.08] dark:text-zinc-100 dark:disabled:bg-white/[0.04] ${value.autoSave && !value.autoSaveDir.trim() ? "border-red-400/45" : "border-black/[0.08]"} ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}
              />
              <div className="flex flex-wrap gap-2">
                {hostCapabilities.nativeOutputDirectoryPicker ? (
                  <button
                    type="button"
                    disabled={!value.autoSave}
                    onClick={chooseDirectory}
                    className={`inline-flex min-h-[36px] items-center gap-1.5 border border-black/[0.08] px-3 text-[12px] font-medium text-zinc-700 transition-colors hover:border-[color:var(--accent)]/35 hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:text-zinc-300 ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
                  >
                    <FolderOpen className="h-3.5 w-3.5" /> 选择路径
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={!value.autoSave || !currentOutputDir}
                  onClick={() => patchConfig({ autoSaveDir: currentOutputDir })}
                  className={`inline-flex min-h-[36px] items-center gap-1.5 border border-black/[0.08] px-3 text-[12px] font-medium text-zinc-700 transition-colors hover:border-[color:var(--accent)]/35 hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:text-zinc-300 ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
                >
                  使用当前输出目录
                </button>
              </div>
              {!hostCapabilities.nativeOutputDirectoryPicker ? (
                <p className="text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                  当前平台没有原生目录选择器，可以直接输入路径，或沿用当前输出目录。
                </p>
              ) : null}
            </div>
          </section>

          <section className={`border border-black/[0.06] bg-[var(--surface)] px-4 py-3.5 dark:border-white/[0.06] ${usesFluentUI ? "rounded-[12px]" : "rounded-[18px]"}`}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[14px] font-semibold text-zinc-900 dark:text-zinc-100">实时预览</div>
                <p className="mt-1 text-[12px] leading-6 text-zinc-500 dark:text-zinc-400">
                  如果关闭后将不在画布上显示绘图预览，可以大幅度降低内存占用。
                </p>
              </div>
              <ToggleSwitch
                checked={value.livePreview}
                onChange={(next) => patchConfig({ livePreview: next })}
                roundedClassName={roundedClassName}
                ariaLabel="切换实时预览"
              />
            </div>
          </section>
        </div>
      </Modal>
    </>
  );
}
