import { SlidersHorizontal } from "lucide-react";
import type {
  BackgroundValue,
  ImageStyleValue,
  InputFidelityValue,
  ModerationValue,
  OutputFormatValue,
} from "../../types/domain";
import { FloatingAdvancedPanel } from "./FloatingAdvancedPanel";

export function MacAdvancedPanel({
  advancedOpen,
  advancedSummary,
  background,
  imageStyle,
  inputFidelity,
  moderation,
  negativePrompt,
  outputCompression,
  outputFormat,
  partialImages,
  seed,
  userIdentifier,
  setAdvancedOpen,
  setField,
}: {
  advancedOpen: boolean;
  advancedSummary: string;
  background: BackgroundValue;
  imageStyle: ImageStyleValue;
  inputFidelity: InputFidelityValue;
  moderation: ModerationValue;
  negativePrompt: string;
  outputCompression: number;
  outputFormat: OutputFormatValue;
  partialImages: number;
  seed: number;
  userIdentifier: string;
  setAdvancedOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setField: (key: string, value: any) => void;
}) {
  return (
    <>
      <section className="platform-card rounded-[22px] border border-black/[0.05] bg-white/70 p-4.5 shadow-[var(--shadow-card)] dark:border-white/[0.06] dark:bg-white/[0.03]">
        <button
          onClick={() => setAdvancedOpen((value) => !value)}
          type="button"
          className="flex w-full min-w-0 items-start justify-between gap-3 text-left"
        >
          <div className="flex min-w-0 items-start gap-3">
            <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-[var(--accent-soft)] text-[var(--accent)]">
              <SlidersHorizontal className="h-4.5 w-4.5" />
            </div>
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-[0.12em] text-zinc-400 dark:text-zinc-500">高级参数</div>
              <div className="mt-1.5 text-[12px] leading-5 text-zinc-500 dark:text-zinc-400">
                长条工具窗，支持拖动、分组折叠和跨工作区联动
              </div>
              <div className="mt-1.5 min-w-0 truncate text-[13px] font-normal leading-6 text-zinc-600 dark:text-zinc-300">
                {advancedSummary}
              </div>
            </div>
          </div>
          <span className="shrink-0 pl-3 text-[12px] text-zinc-500 dark:text-zinc-400">
            {advancedOpen ? "已打开" : "打开"}
          </span>
        </button>
      </section>

      <FloatingAdvancedPanel
        open={advancedOpen}
        onClose={() => setAdvancedOpen(false)}
        advancedSummary={advancedSummary}
        background={background}
        imageStyle={imageStyle}
        inputFidelity={inputFidelity}
        moderation={moderation}
        negativePrompt={negativePrompt}
        outputCompression={outputCompression}
        outputFormat={outputFormat}
        partialImages={partialImages}
        seed={seed}
        userIdentifier={userIdentifier}
        setField={setField}
        variant="mac"
      />
    </>
  );
}
