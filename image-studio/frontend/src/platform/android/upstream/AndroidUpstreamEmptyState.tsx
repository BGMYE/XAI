import { Boxes, ClipboardPaste, Plus, RadioTower } from "lucide-react";
import type { APIMode } from "../../../types/domain";
import { ANDROID_API_MODE_OPTIONS } from "./useAndroidUpstreamConfig";

export function AndroidUpstreamEmptyState({
  onCreate,
  onQuickImport,
}: {
  onCreate: (apiMode: APIMode) => void | Promise<void>;
  onQuickImport: () => void | Promise<void>;
}) {
  return (
    <section className="android-upstream-empty">
      <div className="android-upstream-empty-icon">
        <RadioTower className="h-5 w-5" />
      </div>
      <div className="android-upstream-empty-copy">
        <h4>先为创作找到一处源头</h4>
        <p>从一条可用配置开始。生图与 AI 辅助可各择上游；图片反推与提示词润色交由 Responses API。</p>
      </div>
      <div className="android-upstream-create-grid">
        <button type="button" onClick={() => void onQuickImport()} className="android-upstream-quick-import-card">
          <span className="android-upstream-create-icon">
            <ClipboardPaste className="h-4 w-4" />
          </span>
          <span>
            <strong>从 JSON 带入配置</strong>
            <small>可读入本应用备份、`newapi_channel_conn` 或 OpenCode `provider` 模板。</small>
          </span>
          <Plus className="h-4 w-4" />
        </button>
        {ANDROID_API_MODE_OPTIONS.map((option) => (
          <button key={option.id} type="button" onClick={() => onCreate(option.id)}>
            <span className="android-upstream-create-icon">
              {option.id === "responses" ? <RadioTower className="h-4 w-4" /> : <Boxes className="h-4 w-4" />}
            </span>
            <span>
              <strong>{option.title}</strong>
              <small>{option.meta}</small>
            </span>
            <Plus className="h-4 w-4" />
          </button>
        ))}
      </div>
    </section>
  );
}
