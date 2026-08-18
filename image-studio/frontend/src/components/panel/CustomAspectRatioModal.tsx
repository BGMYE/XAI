import { useMemo, useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import { MAX_CUSTOM_ASPECT_RATIOS } from "../../lib/customAspectRatios.ts";
import { useStudioStore } from "../../state/studioStore";
import { Modal } from "../common/Modal";

export function CustomAspectRatioModal() {
  const open = useStudioStore((state) => state.customAspectRatioModalOpen);
  const customAspectRatios = useStudioStore((state) => state.customAspectRatios);
  const addCustomAspectRatio = useStudioStore((state) => state.addCustomAspectRatio);
  const deleteCustomAspectRatio = useStudioStore((state) => state.deleteCustomAspectRatio);
  const close = useStudioStore((state) => state.closeCustomAspectRatioModal);
  const [widthInput, setWidthInput] = useState("");
  const [heightInput, setHeightInput] = useState("");

  const ratioHint = useMemo(() => {
    const width = Number(widthInput);
    const height = Number(heightInput);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return "";
    return `${Math.floor(width)}:${Math.floor(height)}`;
  }, [heightInput, widthInput]);

  const handleAdd = (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    const width = Number(widthInput);
    const height = Number(heightInput);
    if (addCustomAspectRatio(width, height)) {
      setWidthInput("");
      setHeightInput("");
    }
  };

  return (
    <Modal open={open} onClose={close} title="自定义比例" width={680}>
      <div className="flex flex-col gap-4">
        <div className="rounded-[18px] border border-black/[0.06] bg-[var(--surface)] px-4 py-3 text-[12px] leading-6 text-zinc-600 dark:border-white/[0.08] dark:text-zinc-300">
          新增后的比例会直接出现在参数按钮区，并按当前 1K / 2K / 4K 档位自动换算成像素尺寸。
        </div>

        <form onSubmit={handleAdd} className="rounded-[20px] border border-black/[0.06] bg-[var(--surface)] p-4 dark:border-white/[0.08]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-100">新增比例</div>
              <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                使用正整数录入宽高，例如 4:5、21:9、7:3。
              </div>
            </div>
            <div className="rounded-full bg-black/[0.04] px-2.5 py-1 text-[11px] text-zinc-500 dark:bg-white/[0.06] dark:text-zinc-300">
              {customAspectRatios.length} / {MAX_CUSTOM_ASPECT_RATIOS}
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto_1fr_auto]">
            <label className="flex flex-col gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
              宽
              <input
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={widthInput}
                onChange={(event) => setWidthInput(event.currentTarget.value)}
                placeholder="例如 21"
                className="focus-ring rounded-[14px] border border-black/[0.08] bg-white/80 px-3 py-2 text-[14px] text-zinc-900 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-zinc-100"
              />
            </label>
            <div className="flex items-end justify-center pb-2 text-[18px] font-semibold text-zinc-400">:</div>
            <label className="flex flex-col gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
              高
              <input
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={heightInput}
                onChange={(event) => setHeightInput(event.currentTarget.value)}
                placeholder="例如 9"
                className="focus-ring rounded-[14px] border border-black/[0.08] bg-white/80 px-3 py-2 text-[14px] text-zinc-900 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-zinc-100"
              />
            </label>
            <button
              type="submit"
              className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-[14px] bg-[var(--accent)] px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
            >
              <Plus className="h-4 w-4" />
              添加
            </button>
          </div>

          {ratioHint ? (
            <div className="mt-3 text-[11px] text-zinc-500 dark:text-zinc-400">
              当前将保存为 <span className="font-semibold text-zinc-800 dark:text-zinc-100">{ratioHint}</span>
            </div>
          ) : null}
        </form>

        <div className="rounded-[20px] border border-black/[0.06] bg-[var(--surface)] p-4 dark:border-white/[0.08]">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-100">已保存的自定义比例</div>
            <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
              保存后会立即出现在比例按钮区
            </div>
          </div>

          {customAspectRatios.length === 0 ? (
            <div className="mt-4 rounded-[16px] border border-dashed border-black/[0.08] px-4 py-6 text-center text-[12px] text-zinc-500 dark:border-white/[0.08] dark:text-zinc-400">
              还没有自定义比例，先在上面添加一个。
            </div>
          ) : (
            <div className="mt-4 grid gap-2">
              {customAspectRatios.map((ratio) => {
                const shape = previewShape(ratio.width, ratio.height);
                return (
                  <div
                    key={ratio.id}
                    className="flex items-center justify-between gap-3 rounded-[16px] border border-black/[0.06] bg-white/70 px-3.5 py-3 dark:border-white/[0.08] dark:bg-white/[0.03]"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-11 w-12 items-center justify-center rounded-[12px] bg-[var(--accent-soft)]">
                        <span
                          className="block rounded-sm border-2 border-[var(--accent)]"
                          style={{ width: shape.width, height: shape.height }}
                        />
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-semibold text-zinc-900 dark:text-zinc-100">{ratio.label}</div>
                        <div className="text-[11px] text-zinc-500 dark:text-zinc-400">归一化比例 {ratio.id}</div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => deleteCustomAspectRatio(ratio.id)}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-[12px] border border-black/[0.08] text-zinc-500 transition-colors hover:border-red-400/40 hover:bg-red-500/10 hover:text-red-500 dark:border-white/[0.08]"
                      title={`删除 ${ratio.label}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function previewShape(width: number, height: number): { width: number; height: number } {
  const maxWidth = 26;
  const maxHeight = 26;
  const scale = Math.min(maxWidth / Math.max(1, width), maxHeight / Math.max(1, height));
  return {
    width: Math.max(10, Math.round(width * scale)),
    height: Math.max(10, Math.round(height * scale)),
  };
}
