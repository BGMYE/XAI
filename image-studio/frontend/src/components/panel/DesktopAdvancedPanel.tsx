import { SlidersHorizontal } from "lucide-react";
import type {
  BackgroundValue,
  ImageStyleValue,
  InputFidelityValue,
  ModerationValue,
  OutputFormatValue,
} from "../../types/domain";
import { usePlatform } from "../../platform/context";
import { FloatingAdvancedPanel } from "./FloatingAdvancedPanel";

export function DesktopAdvancedPanel({
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
  const { usesFluentUI } = usePlatform();

  return (
    <>
      <section>
        <button
          onClick={() => setAdvancedOpen((value) => !value)}
          type="button"
          className={`platform-card flex w-full items-start justify-between gap-3 border border-black/[0.05] bg-white/70 px-4 py-3.5 text-left text-zinc-600 transition-colors hover:text-zinc-900 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-zinc-300 dark:hover:text-zinc-100 ${usesFluentUI ? "rounded-[10px]" : "rounded-[16px]"}`}
        >
          <div className="flex min-w-0 items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] bg-[var(--accent-soft)] text-[var(--accent)]">
              <SlidersHorizontal className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em]">高级参数</div>
              <div className="mt-1 text-[12px] leading-5 text-zinc-500 dark:text-zinc-400">
                长条工具窗，支持拖动与分组折叠
              </div>
              <div className="mt-1.5 min-w-0 truncate text-[12px] text-zinc-500 dark:text-zinc-400">
                {advancedSummary}
              </div>
            </div>
          </div>
          <span className="shrink-0 pl-2 text-[11px] opacity-70">
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
        variant="desktop"
      />
    </>
  );
}
