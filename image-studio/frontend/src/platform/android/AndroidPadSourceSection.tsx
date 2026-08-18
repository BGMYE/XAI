import { CheckCircle2, ImagePlus, Trash2, X } from "lucide-react";
import type { HistoryItem, SourceImage } from "../../types/domain";
import { useBlobURL } from "../../lib/images";
import { vibrateForPlatform } from "./bridge";

export function AndroidPadSourceSection({
  onCompareSource,
  clearSources,
  currentImage,
  editSourceLabel,
  onSelectSource,
  onViewSource,
  removeSource,
  sources,
}: {
  onCompareSource: (index: number) => void;
  clearSources: () => void;
  currentImage: HistoryItem | null;
  editSourceLabel: string;
  onSelectSource: () => void;
  onViewSource: (index: number) => void;
  removeSource: (index: number) => void;
  sources: SourceImage[];
}) {
  const sourceState = sources.length > 0
    ? `${sources.length} 张`
    : currentImage?.savedPath
      ? "当前画板"
      : "未添加";
  const sourceMode = sources.length > 0 ? "显式参考" : currentImage?.savedPath ? "隐式源图" : "待选择";
  const sourceHint = sources.length > 0
    ? "可继续替换或补充"
    : currentImage?.savedPath
      ? "将使用当前画板"
      : "从相册或历史选择";

  return (
    <section className="platform-card android-source-summary-card android-pad-source-card">
      <div className="android-source-summary-head">
        <div className="android-source-summary-copy">
          <div className="android-phone-kicker">源图片 / 参考图</div>
          <div className="android-source-summary-title">{editSourceLabel}</div>
          <div className="android-source-summary-grid">
            <span>
              <span>参考图</span>
              <strong>{sourceState}</strong>
            </span>
            <span>
              <span>使用方式</span>
              <strong>{sourceMode}</strong>
            </span>
            <span className="wide">
              <span>状态</span>
              <strong>{sourceHint}</strong>
            </span>
          </div>
        </div>
        <CheckCircle2 className="android-source-summary-icon" />
      </div>
      {sources.length > 0 ? (
        <div className="android-source-list">
          {sources.map((source, index) => (
            <div key={source.path} className="android-source-list-item" data-active={currentImage?.savedPath === source.path ? "true" : "false"}>
              <AndroidPadSourceSummaryButton
                active={currentImage?.savedPath === source.path}
                index={index}
                source={source}
                onPreview={() => { vibrateForPlatform(8); onViewSource(index); }}
              />
              <button
                type="button"
                onClick={() => { vibrateForPlatform(5); removeSource(index); }}
                title="移除"
                className="android-source-remove-button"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="android-source-actions">
        <button
          type="button"
          onClick={onSelectSource}
          className="platform-action-btn android-source-primary-action"
        >
          <ImagePlus className="h-3.5 w-3.5" /> 从相册添加
        </button>
        {sources.length > 0 ? (
          <button
            type="button"
            onClick={() => { vibrateForPlatform(5); onCompareSource(0); }}
            className="platform-action-btn android-source-primary-action"
          >
            对比主参考
          </button>
        ) : null}
        {sources.length > 0 ? (
          <button
            type="button"
            onClick={() => { vibrateForPlatform(5); clearSources(); }}
            className="platform-action-btn android-source-clear-action"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
    </section>
  );
}

function AndroidPadSourceSummaryButton({
  active,
  index,
  source,
  onPreview,
}: {
  active: boolean;
  index: number;
  source: SourceImage;
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
      className="android-source-preview-button"
      data-active={active ? "true" : "false"}
    >
      <span className="android-source-preview-thumb">
        {previewURL ? (
          <img src={previewURL} alt={source.name} loading="lazy" decoding="async" />
        ) : (
          <span className="android-source-preview-fallback">{fallback}</span>
        )}
      </span>
      <span className="android-source-preview-copy">
        <span title={source.path}>{index + 1}. {source.name}</span>
        <small>{active ? "当前画布" : "点按查看大图"}</small>
      </span>
    </button>
  );
}
