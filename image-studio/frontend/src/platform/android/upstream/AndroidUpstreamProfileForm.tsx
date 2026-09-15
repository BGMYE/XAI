import { Check, Eye, EyeOff, Minus, Plug, Plus, RefreshCw, Save } from "lucide-react";
import type { ReactNode } from "react";
import type { UpstreamProfile } from "../../../types/domain";
import {
  ANDROID_API_MODE_OPTIONS,
  ANDROID_REASONING_EFFORT_OPTIONS,
  ANDROID_REQUEST_POLICY_OPTIONS,
} from "./useAndroidUpstreamConfig";
import {
  formatUpstreamModelLabel,
  preferredModelsForAPIMode,
  type UpstreamModelCatalog,
  type UpstreamModelDescriptor,
} from "../../../lib/upstreamModels";

export function AndroidUpstreamProfileForm({
  activeProfileId,
  baseURLError,
  canSave,
  draft,
  draftKey,
  isTestingKey,
  loadingModels,
  modelCatalog,
  modelCatalogError,
  onChangeDraftKey,
  onLoadModels,
  onPatchDraft,
  onSave,
  onSaveAndSetActive,
  onSaveAndTest,
  onSetActive,
  savedKeyLoaded,
  saving,
  showKey,
  onToggleShowKey,
}: {
  activeProfileId: string;
  baseURLError: string | null;
  canSave: boolean;
  draft: UpstreamProfile;
  draftKey: string;
  isTestingKey: boolean;
  loadingModels: boolean;
  modelCatalog: UpstreamModelCatalog | null;
  modelCatalogError: string | null;
  onChangeDraftKey: (value: string) => void;
  onLoadModels: () => void | Promise<void>;
  onPatchDraft: (patch: Partial<UpstreamProfile>) => void;
  onSave: () => void | Promise<void>;
  onSaveAndSetActive: () => void | Promise<void>;
  onSaveAndTest: () => void | Promise<void>;
  onSetActive: () => void | Promise<void>;
  savedKeyLoaded: boolean;
  saving: boolean;
  showKey: boolean;
  onToggleShowKey: () => void;
}) {
  const isActive = draft.id === activeProfileId;
  const busy = saving || isTestingKey;
  const preferredModels = modelCatalog ? preferredModelsForAPIMode(modelCatalog, draft.apiMode) : null;

  return (
    <section className="android-upstream-form" aria-label="编辑上游配置">
      <div className="android-upstream-section-head">
        <span>记下这处源头</span>
        {isActive ? <strong>生图已启用</strong> : <button type="button" onClick={onSetActive}>交给它生图</button>}
      </div>

      <AndroidField label="为上游命名" required>
        <input
          type="text"
          value={draft.name}
          onChange={(event) => onPatchDraft({ name: event.target.value })}
          className="focus-ring android-upstream-input"
          spellCheck={false}
        />
      </AndroidField>

      <AndroidField label="接口形态 · API">
        <div className="android-upstream-option-grid two">
          {ANDROID_API_MODE_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={draft.apiMode === option.id ? "active" : ""}
              onClick={() => onPatchDraft({ apiMode: option.id })}
            >
              <strong>{option.title}</strong>
              <small>{option.meta}</small>
            </button>
          ))}
        </div>
      </AndroidField>

      <AndroidField label="请求约定 · 参数策略">
        <div className="android-upstream-option-grid two">
          {ANDROID_REQUEST_POLICY_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={draft.requestPolicy === option.id ? "active" : ""}
              onClick={() => onPatchDraft({ requestPolicy: option.id })}
            >
              <strong>{option.title}</strong>
              <small>{option.meta}</small>
            </button>
          ))}
        </div>
      </AndroidField>

      <AndroidField label="请求去处 · BASE_URL" required hint="写下站点根地址，应用会接好当前 API 的请求路径。">
        <input
          type="text"
          value={draft.baseURL}
          onChange={(event) => onPatchDraft({ baseURL: event.target.value })}
          placeholder="https://your-relay.example.com"
          className="focus-ring android-upstream-input font-mono-token"
          spellCheck={false}
        />
        {baseURLError ? <p className="android-upstream-error">{baseURLError}</p> : null}
      </AndroidField>

      <AndroidField label="连接边界 · 安全" hint="仅适用于可信网络。启用后，API Key、提示词与图片可能被窃听或篡改。">
        <button
          type="button"
          role="switch"
          aria-checked={draft.allowInsecureConnection === true}
          className={`android-upstream-compat-toggle ${draft.allowInsecureConnection ? "active" : ""}`}
          onClick={() => onPatchDraft({ allowInsecureConnection: !(draft.allowInsecureConnection === true) })}
        >
          <span>
            <strong>允许不安全连接（有风险）</strong>
            <small>启用后允许远程 HTTP，并跳过 HTTPS / WSS 证书错误。</small>
          </span>
          <em>{draft.allowInsecureConnection ? "已启用" : "已停用"}</em>
        </button>
      </AndroidField>

      <AndroidField label="API Key" required hint="API Key 由系统凭据存储保管，不会留在 localStorage。">
        <div className="android-upstream-secret">
          <input
            type={showKey ? "text" : "password"}
            value={draftKey}
            onChange={(event) => onChangeDraftKey(event.target.value)}
            placeholder={savedKeyLoaded ? "sk-..." : "正在取回…"}
            autoComplete="off"
            className="focus-ring android-upstream-input font-mono-token"
            spellCheck={false}
          />
          <button type="button" onClick={onToggleShowKey} title={showKey ? "遮住 API Key" : "查看 API Key"}>
            {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </AndroidField>

      <AndroidField
        label="模型目录 · 上游提供"
        hint="由宿主向 /v1/models 取回模型目录，减少 WebView 跨域差异带来的阻碍。"
      >
        <button type="button" className="android-upstream-load-models" onClick={() => void onLoadModels()} disabled={loadingModels}>
          <RefreshCw className={`h-4 w-4 ${loadingModels ? "animate-spin" : ""}`} />
          <span>{loadingModels ? "正在取回…" : "取回上游模型目录"}</span>
        </button>
        {modelCatalog ? <p className="android-upstream-hint">已收录 {modelCatalog.all.length} 个模型。</p> : null}
        {modelCatalogError ? <p className="android-upstream-error">{modelCatalogError}</p> : null}
      </AndroidField>

      {draft.apiMode === "responses" ? (
        <>
          <AndroidField label="Responses · 传输方式" hint="此处选择 Responses API 的传输方式，与 Realtime API 无关。">
            <div className="android-upstream-option-grid two">
              {[
                { id: "sse", title: "HTTP SSE", meta: "初始选择，兼容性更稳妥" },
                { id: "websocket", title: "WebSocket", meta: "需上游为此开启支持" },
              ].map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={(draft.responsesTransport ?? "sse") === option.id ? "active" : ""}
                  onClick={() => onPatchDraft({ responsesTransport: option.id as UpstreamProfile["responsesTransport"] })}
                >
                  <strong>{option.title}</strong>
                  <small>{option.meta}</small>
                </button>
              ))}
            </div>
          </AndroidField>

          <AndroidField label="文字所托 · 文本模型 ID">
            <input
              type="text"
              value={draft.textModelID}
              onChange={(event) => onPatchDraft({ textModelID: event.target.value })}
              placeholder="留白则使用 gpt-5.5"
              className="focus-ring android-upstream-input font-mono-token"
              spellCheck={false}
            />
            {preferredModels && preferredModels.text.length > 0 ? (
              <AndroidModelSuggestions
                models={preferredModels.text}
                selectedID={draft.textModelID}
                onSelect={(id) => onPatchDraft({ textModelID: id })}
              />
            ) : null}
          </AndroidField>

          <AndroidField label="思考深浅 · 推理强度" hint="初始为 xhigh。部分模型或中转在低强度下可能无法完成工具调用。">
            <div className="android-upstream-option-grid two">
              {ANDROID_REASONING_EFFORT_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={draft.reasoningEffort === option.id ? "active" : ""}
                  onClick={() => onPatchDraft({ reasoningEffort: option.id })}
                >
                  <strong>{option.title}</strong>
                  <small>{option.meta}</small>
                </button>
              ))}
            </div>
          </AndroidField>
        </>
      ) : null}

      <AndroidField label="画面所托 · 图像模型 ID">
        <input
          type="text"
          value={draft.imageModelID}
          onChange={(event) => onPatchDraft({ imageModelID: event.target.value })}
          placeholder="留白则使用 gpt-image-2"
          className="focus-ring android-upstream-input font-mono-token"
          spellCheck={false}
        />
        {preferredModels && preferredModels.image.length > 0 ? (
          <AndroidModelSuggestions
            models={preferredModels.image}
            selectedID={draft.imageModelID}
            onSelect={(id) => onPatchDraft({ imageModelID: id })}
          />
        ) : null}
      </AndroidField>

      <AndroidField label="流动画面 · 视频模型 ID" hint="视频需要明确的模型 ID，没有默认值，也不会借用文本或图像模型；请按上游要求填写。">
        <input
          type="text"
          value={draft.videoModelID}
          onChange={(event) => onPatchDraft({ videoModelID: event.target.value })}
          placeholder="请明确填写，如 sora-2"
          className="focus-ring android-upstream-input font-mono-token"
          spellCheck={false}
        />
        {modelCatalog && modelCatalog.video.length > 0 ? (
          <AndroidModelSuggestions
            models={modelCatalog.video}
            selectedID={draft.videoModelID}
            onSelect={(id) => onPatchDraft({ videoModelID: id })}
          />
        ) : null}
      </AndroidField>

      <AndroidField label="同行任务 · 并发上限" hint="0 表示不设上限；填写正整数后，这处上游跨标签页同时运行的任务数将不超过此值。">
        <div className="android-upstream-stepper">
          <button
            type="button"
            onClick={() => onPatchDraft({ concurrencyLimit: Math.max(0, draft.concurrencyLimit - 1) })}
            title="减少并发上限"
          >
            <Minus className="h-4 w-4" />
          </button>
          <input
            type="number"
            value={draft.concurrencyLimit || ""}
            min={0}
            step={1}
            placeholder="不设上限"
            onChange={(event) => onPatchDraft({ concurrencyLimit: Math.max(0, Math.floor(Number(event.target.value) || 0)) })}
            className="focus-ring android-upstream-input font-mono-token"
          />
          <button
            type="button"
            onClick={() => onPatchDraft({ concurrencyLimit: Math.max(0, draft.concurrencyLimit) + 1 })}
            title="增加并发上限"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </AndroidField>

      {draft.apiMode === "images" ? (
        <AndroidField
          label="中转适配 · Images API"
          hint="默认停用，沿用 OpenAI 标准 Images API；标准参数无法成图时，再尝试这一适配。"
        >
          <button
            type="button"
            className={`android-upstream-compat-toggle ${draft.imagesNewAPICompat ? "active" : ""}`}
            onClick={() => onPatchDraft({ imagesNewAPICompat: !(draft.imagesNewAPICompat === true) })}
          >
            <span>
              <strong>NewAPI 生成受阻时，可尝试兼容模式</strong>
              <small>启用后固定使用 b64_json，并停用 stream / partial_images。</small>
            </span>
            <em>{draft.imagesNewAPICompat ? "已启用" : "已停用"}</em>
          </button>
        </AndroidField>
      ) : null}

      <div className="android-upstream-actions">
        <button type="button" onClick={() => void onSave()} disabled={!canSave || busy}>
          <Save className="h-4 w-4" />
          {saving ? "正在保存…" : "保存这份配置"}
        </button>
        <button type="button" onClick={() => void onSaveAndSetActive()} disabled={!canSave || busy}>
          <Check className="h-4 w-4" />
          保存并用于生图
        </button>
        <button type="button" className="primary" onClick={() => void onSaveAndTest()} disabled={!canSave || busy}>
          <Plug className={`h-4 w-4 ${isTestingKey ? "animate-spin" : ""}`} />
          {isTestingKey ? "正在探测…" : "保存后探测连接"}
        </button>
      </div>

      {!canSave ? <p className="android-upstream-save-hint">请补齐名称、BASE_URL 与 API Key，再保存这处创作源头。</p> : null}
    </section>
  );
}

function AndroidField({
  children,
  hint,
  label,
  required,
}: {
  children: ReactNode;
  hint?: string;
  label: string;
  required?: boolean;
}) {
  return (
    <div className="android-upstream-field">
      <span className="android-upstream-label">
        {label}
        {required ? <em>*</em> : null}
      </span>
      {children}
      {hint ? <span className="android-upstream-hint">{hint}</span> : null}
    </div>
  );
}

function AndroidModelSuggestions({
  models,
  selectedID,
  onSelect,
}: {
  models: UpstreamModelDescriptor[];
  selectedID: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="android-upstream-model-suggestions">
      {models.slice(0, 10).map((model) => {
        const active = model.id === selectedID.trim();
        return (
          <button
            key={model.id}
            type="button"
            className={active ? "active" : ""}
            onClick={() => onSelect(model.id)}
          >
            <strong>{formatUpstreamModelLabel(model)}</strong>
          </button>
        );
      })}
    </div>
  );
}
