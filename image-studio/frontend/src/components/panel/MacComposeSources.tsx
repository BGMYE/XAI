import { ImagePlus, Trash2 } from "lucide-react";
import type { BatchProcessConfig, EditSourceMode, SourceImage } from "../../types/domain";
import { useBlobURL } from "../../lib/images";
import { BatchProcessSection } from "./BatchProcessSection";

export function MacComposeSources({
  batchProcess,
  chooseBatchInputDir,
  chooseBatchInputFiles,
  chooseBatchOutputDir,
  compareSourceOnCanvas,
  clearSources,
  currentImageSavedPath,
  editSourceMode,
  refreshBatchInputDir,
  setField,
  selectSourceImage,
  viewSourceOnCanvas,
  sources,
}: {
  batchProcess: BatchProcessConfig;
  chooseBatchInputDir: () => void;
  chooseBatchInputFiles: () => void;
  chooseBatchOutputDir: () => void;
  compareSourceOnCanvas: (index: number) => void;
  clearSources: () => void;
  currentImageSavedPath?: string | null;
  editSourceMode: EditSourceMode;
  refreshBatchInputDir: () => void;
  setField: (key: string, value: any) => void;
  selectSourceImage: () => void;
  viewSourceOnCanvas: (index: number) => void;
  sources: SourceImage[];
}) {
  return (
    <div>
      <BatchProcessSection
        currentImageSavedPath={currentImageSavedPath}
        editSourceMode={editSourceMode}
        batchProcess={batchProcess}
        setEditSourceMode={(next) => setField("editSourceMode", next)}
        setBatchProcess={(next) => setField("batchProcess", next)}
        onChooseInputDir={chooseBatchInputDir}
        onChooseInputFiles={chooseBatchInputFiles}
        onChooseOutputDir={chooseBatchOutputDir}
        onRefreshInputDir={refreshBatchInputDir}
      />
      {editSourceMode === "manual" ? (
        <div className="mt-3 flex flex-col gap-1.5">
        <div className="rounded-[14px] border border-black/[0.06] bg-[var(--surface)] px-3 py-2 text-[11px] text-zinc-500 dark:border-white/[0.04] dark:text-zinc-400">
          {sources.length > 0
            ? "已添加显式参考图，可继续追加、替换或拖入更多图片。"
            : currentImageSavedPath
              ? "当前画板图会作为隐式源图参与本次编辑。"
              : "先添加一张参考图，或从历史里挑一张结果继续编辑。"}
        </div>
        {sources.length > 0 ? (
          <div className="flex gap-2 overflow-x-auto pb-0.5">
            {sources.map((source, index) => (
              <MacSourceChip
                key={source.path}
                source={source}
                index={index}
                active={currentImageSavedPath === source.path}
                onPreview={() => viewSourceOnCanvas(index)}
              />
            ))}
          </div>
        ) : null}
        <div className="flex gap-1.5">
          <button
            onClick={selectSourceImage}
            className="platform-action-btn flex-1 inline-flex items-center justify-center gap-1 rounded-full border border-black/[0.08] px-3 py-2 text-xs text-zinc-700 transition-colors hover:border-[color:var(--accent)]/35 hover:text-[var(--accent)] dark:border-white/[0.08] dark:text-zinc-300"
          >
            <ImagePlus className="w-3.5 h-3.5" /> 添加图片
          </button>
          {sources.length > 0 ? (
            <button
              onClick={() => compareSourceOnCanvas(0)}
              className="platform-action-btn inline-flex items-center gap-1 rounded-full border border-black/[0.08] px-3 py-2 text-xs text-zinc-700 transition-colors hover:border-[color:var(--accent)]/35 hover:text-[var(--accent)] dark:border-white/[0.08] dark:text-zinc-300"
            >
              对比主参考
            </button>
          ) : null}
          {sources.length > 0 ? (
            <button
              onClick={clearSources}
              className="platform-action-btn inline-flex items-center gap-1 rounded-full border border-black/[0.08] px-3 py-2 text-xs text-zinc-500 transition-colors hover:border-red-400/40 hover:text-red-400 dark:border-white/[0.08]"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          ) : null}
        </div>
        </div>
      ) : null}
    </div>
  );
}

function MacSourceChip({
  source,
  index,
  active,
  onPreview,
}: {
  source: SourceImage;
  index: number;
  active: boolean;
  onPreview: () => void;
}) {
  const objectURL = useBlobURL(source.imageBlob ?? null, source.imageB64 ?? null);
  const previewURL = source.previewUrl || objectURL;
  const fallback = source.name.split(".").pop()?.toUpperCase() ?? "IMG";
  return (
    <button
      type="button"
      onClick={onPreview}
      title={`${index + 1}. ${source.name}\n${source.path}\n点击在画布查看`}
      className={`group flex min-w-0 items-center gap-2 rounded-[14px] border px-2.5 py-2 text-left transition-all ${active ? "border-[color:var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)] shadow-[0_0_0_1px_var(--accent)]" : "border-black/[0.06] bg-[var(--surface)] text-zinc-700 hover:border-[color:var(--accent)]/35 hover:text-[var(--accent)] dark:border-white/[0.06] dark:text-zinc-300"}`}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[10px] border border-black/[0.06] bg-white/70 dark:border-white/[0.08] dark:bg-white/[0.04]">
        {previewURL ? (
          <img src={previewURL} alt={source.name} loading="lazy" decoding="async" className="h-full w-full object-cover" />
        ) : (
          <span className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400">{fallback}</span>
        )}
      </div>
      <span className="min-w-0">
        <span className="block truncate text-[11px] font-medium">{index + 1}. {source.name}</span>
        <span className={`block truncate text-[10px] ${active ? "text-[var(--accent)]/80" : "text-zinc-400 dark:text-zinc-500"}`}>
          {active ? "当前画布" : "点按查看大图"}
        </span>
      </span>
    </button>
  );
}
