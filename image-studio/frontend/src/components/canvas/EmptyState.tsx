import { ImageIcon, Upload } from "lucide-react";
import { useStudioStore } from "../../state/studioStore";
import { usePlatform } from "../../platform/context";

// EmptyState 中间的提示卡。背景动效不在这里实现 —— 它是 stage-host 自带的
// 棋盘格 + CSS keyframes 在 _canvas.css 里。这里只负责中央内容。
export function EmptyState() {
  const importImageFile = useStudioStore((s) => s.importImageFile);
  const selectSourceImage = useStudioStore((s) => s.selectSourceImage);
  const mode = useStudioStore((s) => s.mode);
  const { isAndroidPhone, isAndroidPad, usesFluentUI, usesAppleUI } = usePlatform();
  const isAndroid = isAndroidPhone || isAndroidPad;

  function onFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) importImageFile(f);
    e.target.value = "";
  }

  return (
    <div className={`absolute inset-0 flex pointer-events-none ${isAndroidPhone ? "items-start justify-center px-4 pt-6" : "items-center justify-center px-8"}`}>
      <div className={`relative z-10 text-center shadow-[var(--shadow-card-hover)] backdrop-blur-2xl pointer-events-auto dark:border-white/[0.06] dark:bg-white/[0.04] ${usesAppleUI ? "liquid-glass-panel" : ""} ${isAndroidPhone ? "w-full max-w-[300px] border border-black/[0.05] bg-white/66 px-5 py-4 rounded-[18px]" : isAndroidPad ? "max-w-[360px] border border-black/[0.05] bg-white/78 px-8 py-8 rounded-[28px]" : `max-w-sm border border-black/[0.06] bg-white/72 px-7 py-8 ${usesFluentUI ? "rounded-[16px]" : "rounded-[24px]"}`}`}>
        <div className={`inline-flex items-center justify-center border border-[color:var(--accent)]/18 bg-[var(--accent-soft)] ${isAndroidPhone ? "mb-2.5 h-11 w-11 rounded-[14px]" : `mb-4 h-16 w-16 ${usesFluentUI ? "rounded-[14px]" : "rounded-[20px]"}`}`}>
          <ImageIcon className={`${isAndroidPhone ? "h-5 w-5" : "h-7 w-7"} text-[var(--accent)]`} />
        </div>
        <h2 className={`text-zinc-900 dark:text-zinc-100 ${isAndroidPhone ? "mb-1 text-[16px] font-semibold tracking-[0]" : usesFluentUI ? "mb-1 text-[18px] font-semibold tracking-[0]" : "mb-1 text-[20px] font-semibold tracking-[-0.02em]"}`}>还没有图片</h2>
        <p className={`${isAndroidPhone ? "mb-3 text-[12px] leading-6" : "mb-4 text-sm leading-relaxed"} text-zinc-500 dark:text-zinc-400`}>
          {isAndroidPhone
            ? "先到“参数”页写提示词，或直接导入一张图开始编辑。"
            : mode === "edit"
              ? "图生图时可直接拖入一张本地图片，或从历史结果里挑一张继续编辑。"
              : "先在左侧写提示词，再开始生成第一张图。"}
        </p>
        {isAndroidPhone && (
          <div className="mb-3 rounded-[16px] border border-black/[0.05] bg-[var(--surface)]/70 px-4 py-3 text-left dark:border-white/[0.06] dark:bg-white/[0.03]">
            <div className="text-[12px] font-medium text-zinc-700 dark:text-zinc-200">快速起手</div>
            <div className="mt-1 text-[12px] leading-6 text-zinc-500 dark:text-zinc-400">
              先在参数页写好 prompt，再切到画布页看结果；需要重做时直接从历史继续变体。
            </div>
          </div>
        )}
        {isAndroidPad && (
          <div className="mb-4 rounded-[18px] border border-black/[0.05] bg-[var(--surface)]/70 px-4 py-3 text-left dark:border-white/[0.06] dark:bg-white/[0.03]">
            <div className="text-[12px] font-medium text-zinc-700 dark:text-zinc-200">建议起手</div>
            <div className="mt-1 text-[12px] leading-6 text-zinc-500 dark:text-zinc-400">
              先在左栏写好 prompt 与参数，再把画布当作结果筛选与后处理工作区。
            </div>
          </div>
        )}
        {isAndroid ? (
          <button
            type="button"
            onClick={selectSourceImage}
            className={`platform-action-btn inline-flex cursor-pointer items-center gap-1.5 border border-black/[0.08] bg-white/70 text-zinc-700 transition-colors hover:border-[color:var(--accent)]/35 hover:text-[var(--accent)] dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-zinc-300 ${isAndroidPhone ? "px-4 py-2 text-[12px] rounded-full" : "px-5 py-3 text-[13px] rounded-full"}`}
          >
            <Upload className="w-3.5 h-3.5" />
            从相册选择
          </button>
        ) : (
          <label className={`platform-action-btn inline-flex cursor-pointer items-center gap-1.5 border border-black/[0.08] bg-white/70 text-zinc-700 transition-colors hover:border-[color:var(--accent)]/35 hover:text-[var(--accent)] dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-zinc-300 px-4 py-2.5 text-sm ${usesFluentUI ? "rounded-[10px]" : "rounded-full"}`}>
            <Upload className="w-3.5 h-3.5" />
            选择本地图片
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={onFilePick} className="hidden" style={{ display: "none" }} />
          </label>
        )}
      </div>
    </div>
  );
}
