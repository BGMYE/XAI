import {
  DEFAULT_AUTO_RETRY_COUNT,
  MAX_AUTO_RETRY_COUNT,
} from "../../../../../../shared/kernel/requestModel.js";
import {
  Bell,
  ChevronRight,
  Database,
  Download,
  Folder,
  Github,
  Info,
  KeyRound,
  MessageSquare,
  Monitor,
  Moon,
  Network,
  PlugZap,
  Save,
  Shield,
  SlidersHorizontal,
  Sun,
  Trash2,
  Upload,
} from "lucide-react";
import type { CompletionSoundConfig, KernelRuntimeMode, ProxyMode, ThemeMode, UpstreamProfile } from "../../../types/domain";
import { androidSaveHint } from "../bridge";

export type AndroidSettingsSurface = "phone" | "pad";

export type AndroidSettingsPanelProps = {
  activeProfile: UpstreamProfile | undefined;
  activeProfileId: string;
  apiMode: "responses" | "images";
  clearAPIKey: () => void;
  clearHistory: () => void;
  completionSound: CompletionSoundConfig;
  exportHistory: () => void;
  fontScale: number;
  historyCount: number;
  importHistory: () => void;
  isTestingKey: boolean;
  autoRetryEnabled: boolean;
  autoRetryCount: number;
  protectStreamPreview: boolean;
  kernelRuntimeMode: KernelRuntimeMode;
  onOpenAbout: () => void;
  onOpenFeedback: () => void;
  onOpenRepo: () => void;
  onOpenUpstream: () => void;
  onPreviewCompletionSound: () => void;
  onResetCompletionSound: () => void;
  onSelectCompletionSound: () => void;
  onSetActiveProfile: (id: string) => void;
  onSetCompletionSoundEnabled: (value: boolean) => void;
  onSetCompletionSoundMode: (value: CompletionSoundConfig["mode"]) => void;
  onSetFontScale: (value: number) => void;
  onSetKernelRuntimeMode: (value: KernelRuntimeMode) => void;
  onSetAutoRetryEnabled: (value: boolean) => void;
  onSetAutoRetryCount: (value: number) => void;
  onSetProtectStreamPreview: (value: boolean) => void;
  onSetCleanupPreviewCacheOnExit: (value: boolean) => void;
  onSetProxyConfig: (mode: ProxyMode, url?: string) => void;
  onSetSavePromptSuppressed: (value: boolean) => void;
  onSetTheme: (value: ThemeMode) => void;
  openOutputLocation: () => void;
  outputLabel: string;
  profiles: UpstreamProfile[];
  proxyMode: ProxyMode;
  proxyURL: string;
  pruneHistory: (days: number) => void;
  cleanupPreviewCacheOnExit: boolean;
  savePromptSuppressed: boolean;
  surface: AndroidSettingsSurface;
  testAPIKey: () => void;
  theme: ThemeMode;
  upstreamReady: boolean;
};

const fontSizes = [
  { label: "小巧", value: 0.85 },
  { label: "适中", value: 1 },
  { label: "舒展", value: 1.15 },
] as const;

function themeLabel(theme: ThemeMode) {
  if (theme === "dark") return "夜色 · 深色";
  if (theme === "light") return "晨光 · 浅色";
  return "随系统光色";
}

function runtimeLabel(mode: KernelRuntimeMode) {
  if (mode === "local") return "本机运行";
  if (mode === "remote") return "远端运行";
  return "自动择路";
}

function proxyLabel(mode: ProxyMode) {
  if (mode === "none") return "直接连接";
  if (mode === "custom") return "自行指定";
  return "沿用系统";
}

export function AndroidSettingsPanel({
  activeProfile,
  activeProfileId,
  apiMode,
  clearAPIKey,
  clearHistory,
  completionSound,
  exportHistory,
  fontScale,
  historyCount,
  importHistory,
  isTestingKey,
  autoRetryEnabled,
  autoRetryCount,
  protectStreamPreview,
  kernelRuntimeMode,
  onOpenAbout,
  onOpenFeedback,
  onOpenRepo,
  onOpenUpstream,
  onPreviewCompletionSound,
  onResetCompletionSound,
  onSelectCompletionSound,
  onSetActiveProfile,
  onSetCompletionSoundEnabled,
  onSetCompletionSoundMode,
  onSetFontScale,
  onSetKernelRuntimeMode,
  onSetAutoRetryEnabled,
  onSetAutoRetryCount,
  onSetProtectStreamPreview,
  onSetCleanupPreviewCacheOnExit,
  onSetProxyConfig,
  onSetSavePromptSuppressed,
  onSetTheme,
  openOutputLocation,
  outputLabel,
  profiles,
  proxyMode,
  proxyURL,
  pruneHistory,
  cleanupPreviewCacheOnExit,
  savePromptSuppressed,
  surface,
  testAPIKey,
  theme,
  upstreamReady,
}: AndroidSettingsPanelProps) {
  const upstreamModeLabel = apiMode === "responses" ? "Responses API" : "Images API";
  const historyCountLabel = `${historyCount} 条记录`;
  const currentSummary = [
    upstreamReady ? "上游已就绪" : "上游待配置",
    `请求途经：${proxyLabel(proxyMode)}`,
    `界面光色：${themeLabel(theme)}`,
    `文字尺度：${Math.round(fontScale * 100)}%`,
    savePromptSuppressed ? "另存提醒已停用" : "另存提醒已启用",
    cleanupPreviewCacheOnExit ? "离开时清理预览缓存" : "离开时保留预览缓存",
    autoRetryEnabled ? "自动重试已启用" : "自动重试已停用",
    `最多再试 ${autoRetryCount} 次`,
    protectStreamPreview ? "预览保护已启用" : "预览保护已停用",
    completionSound.enabled ? "成图回响已启用" : "成图回响已停用",
    `${historyCount} 条创作历史`,
  ];

  const heroSection = (
    <section className="android-settings-hero">
      <div className="android-settings-hero-orb">
        <SlidersHorizontal className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="android-settings-kicker">Image Studio</div>
        <h2>创作偏好</h2>
        <p>{surface === "pad" ? "左边调好眼前的光色，右边安放运行与历史，让创作从容展开。" : "为随身创作调好节律；内核、光色与旧页，都在此安放。"}</p>
        <div className="android-settings-summary-strip" aria-label="此刻的创作偏好">
          {currentSummary.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      </div>
    </section>
  );

  const runtimeSection = (
    <section className="android-settings-card android-settings-card-runtime">
      <div className="android-settings-section-title">行旅 · 运行与网络</div>
      <div className="android-settings-upstream-card">
        <div className="android-settings-upstream-head">
          <span className="android-settings-row-icon"><PlugZap className="h-4 w-4" /></span>
          <span className="min-w-0 flex-1">
            <span className="android-settings-field-title">创作源头 · 上游</span>
            <span className="android-settings-field-subtitle">
              {activeProfile ? `${activeProfile.name} · ${upstreamModeLabel}` : "尚待添入一处可用上游"}
            </span>
          </span>
          <span className={`android-settings-status-pill ${upstreamReady ? "ready" : "missing"}`}>
            {upstreamReady ? "已就绪" : "待配置"}
          </span>
        </div>
        {profiles.length > 0 ? (
          <select
            value={activeProfileId}
            onChange={(e) => onSetActiveProfile(e.target.value)}
            className="focus-ring android-settings-profile-select"
          >
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name} · {profile.apiMode === "responses" ? "Responses" : "Images"}
              </option>
            ))}
          </select>
        ) : null}
        <div className="android-settings-action-grid android-settings-upstream-actions">
          <button type="button" onClick={onOpenUpstream}>打理上游配置</button>
          <button type="button" onClick={testAPIKey} disabled={!upstreamReady || isTestingKey}>
            {isTestingKey ? "正在探路…" : "探测连接"}
          </button>
        </div>
      </div>

      <div className="android-settings-field android-settings-field-stacked">
        <div>
          <span className="android-settings-field-title">内核 · 创作在哪里运行</span>
          <span className="android-settings-field-subtitle">此刻采用{runtimeLabel(kernelRuntimeMode)}，初始为自动择路。</span>
        </div>
        <div className="android-settings-segmented android-settings-runtime-segmented" role="group" aria-label="内核 · 创作在哪里运行">
          {(["auto", "local", "remote"] as KernelRuntimeMode[]).map((value) => (
            <button
              key={value}
              type="button"
              className={kernelRuntimeMode === value ? "active" : ""}
              onClick={() => onSetKernelRuntimeMode(value)}
            >
              {runtimeLabel(value)}
            </button>
          ))}
        </div>
      </div>

      <div className="android-settings-field android-settings-field-stacked">
        <div>
          <span className="android-settings-field-title">代理 · 请求的途经之地</span>
          <span className="android-settings-field-subtitle">此刻{proxyLabel(proxyMode)}，默认沿用系统的网络安排。</span>
        </div>
        <div className="android-settings-segmented" role="group" aria-label="代理 · 请求的途经之地">
          {([
            ["none", "直连"],
            ["system", "随系统"],
            ["custom", "自行指定"],
          ] as Array<[ProxyMode, string]>).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={proxyMode === value ? "active" : ""}
              onClick={() => onSetProxyConfig(value)}
            >
              {value === "custom" ? <Network className="h-3.5 w-3.5" /> : null}
              {label}
            </button>
          ))}
        </div>
        {proxyMode === "custom" ? (
          <input
            value={proxyURL}
            onChange={(e) => onSetProxyConfig("custom", e.currentTarget.value)}
            className="focus-ring android-settings-profile-select"
            placeholder="http://127.0.0.1:7890"
            type="url"
          />
        ) : null}
      </div>

      <button type="button" className="android-settings-row-action" onClick={openOutputLocation}>
        <span className="android-settings-row-icon"><Folder className="h-4 w-4" /></span>
        <span className="min-w-0 flex-1">
          <span className="android-settings-field-title">作品归处 · 保存位置</span>
          <span className="android-settings-field-subtitle truncate">{outputLabel}</span>
        </span>
        <ChevronRight className="h-4 w-4 text-zinc-400" />
      </button>
      <p className="android-settings-note">{androidSaveHint()}</p>

      <div className="android-settings-field android-settings-field-stacked">
        <div>
          <span className="android-settings-field-title">落定之后 · 另存提醒</span>
          <span className="android-settings-field-subtitle">
            {savePromptSuppressed ? "作品落定后，将不再弹出另存提醒。" : "作品完成时，询问是否另选保存位置。"}
          </span>
        </div>
        <div className="android-settings-segmented" role="group" aria-label="落定之后 · 另存提醒">
          <button
            type="button"
            className={!savePromptSuppressed ? "active" : ""}
            onClick={() => onSetSavePromptSuppressed(false)}
          >
            <Save className="h-3.5 w-3.5" /> 轻声提醒
          </button>
          <button
            type="button"
            className={savePromptSuppressed ? "active" : ""}
            onClick={() => onSetSavePromptSuppressed(true)}
          >
            不再提醒
          </button>
        </div>
      </div>

      <div className="android-settings-field android-settings-field-stacked">
        <div>
          <span className="android-settings-field-title">重试 · 遇到波折再出发</span>
          <span className="android-settings-field-subtitle">
            {autoRetryEnabled ? "遇到 403 / 502 / 503 / 504 / 524 或可重试的网络波动时，会自动再试。" : "自动重试已停用；遇到失败时，只保留首次结果。"}
          </span>
        </div>
        <div className="android-settings-segmented" role="group" aria-label="重试 · 遇到波折再出发">
          <button
            type="button"
            className={autoRetryEnabled ? "active" : ""}
            onClick={() => onSetAutoRetryEnabled(true)}
          >
            启用
          </button>
          <button
            type="button"
            className={!autoRetryEnabled ? "active" : ""}
            onClick={() => onSetAutoRetryEnabled(false)}
          >
            停用
          </button>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <input
            type="range"
            min={1}
            max={MAX_AUTO_RETRY_COUNT}
            step={1}
            value={autoRetryCount}
            onChange={(e) => onSetAutoRetryCount(Number(e.currentTarget.value))}
            className="focus-ring flex-1"
          />
          <span className="android-settings-status-pill ready">{autoRetryCount} 次</span>
        </div>
        <p className="android-settings-note">初始为 {DEFAULT_AUTO_RETRY_COUNT} 次；第一次出发不计入重试。</p>
      </div>

      <div className="android-settings-field android-settings-field-stacked">
        <div>
          <span className="android-settings-field-title">离开时 · 清理预览缓存</span>
          <span className="android-settings-field-subtitle">
            {cleanupPreviewCacheOnExit
              ? "退出时删除可重建的预览图与缩略图缓存；源图、成图和历史仍保留。"
              : "默认停用，留下预览缓存，方便下次更快翻看历史。"}
          </span>
        </div>
        <div className="android-settings-segmented" role="group" aria-label="离开时 · 清理预览缓存">
          <button
            type="button"
            className={!cleanupPreviewCacheOnExit ? "active" : ""}
            onClick={() => onSetCleanupPreviewCacheOnExit(false)}
          >
            停用
          </button>
          <button
            type="button"
            className={cleanupPreviewCacheOnExit ? "active" : ""}
            onClick={() => onSetCleanupPreviewCacheOnExit(true)}
          >
            启用
          </button>
        </div>
      </div>

      <div className="android-settings-field android-settings-field-stacked">
        <div>
          <span className="android-settings-field-title">预览 · 守护完整成图</span>
          <span className="android-settings-field-subtitle">
            {protectStreamPreview ? "高并发或大尺寸创作时，让预览暂歇，优先守住最终图的完整。" : "预览保护已停用，将严格遵循设定的预览帧数。"}
          </span>
        </div>
        <div className="android-settings-segmented" role="group" aria-label="预览 · 守护完整成图">
          <button
            type="button"
            className={protectStreamPreview ? "active" : ""}
            onClick={() => onSetProtectStreamPreview(true)}
          >
            启用
          </button>
          <button
            type="button"
            className={!protectStreamPreview ? "active" : ""}
            onClick={() => onSetProtectStreamPreview(false)}
          >
            停用
          </button>
        </div>
      </div>

      <div className="android-settings-field android-settings-field-stacked">
        <div>
          <span className="android-settings-field-title">成图回响 · 提示音</span>
          <span className="android-settings-field-subtitle">
            {completionSound.enabled
              ? (completionSound.mode === "custom" && completionSound.customName
                ? `此刻的回响：${completionSound.customName}`
                : "此刻的回响：内置提示音")
              : "作品落定时，将保持安静。"}
          </span>
        </div>
        <div className="android-settings-segmented" role="group" aria-label="成图回响 · 声音开关">
          <button
            type="button"
            className={completionSound.enabled ? "active" : ""}
            onClick={() => onSetCompletionSoundEnabled(true)}
          >
            <Bell className="h-3.5 w-3.5" /> 启用
          </button>
          <button
            type="button"
            className={!completionSound.enabled ? "active" : ""}
            onClick={() => onSetCompletionSoundEnabled(false)}
          >
            停用
          </button>
        </div>
        <div className="android-settings-segmented" role="group" aria-label="成图回响 · 声音选择">
          <button
            type="button"
            className={completionSound.mode === "default" ? "active" : ""}
            onClick={() => onSetCompletionSoundMode("default")}
          >
            内置回响
          </button>
          <button
            type="button"
            className={completionSound.mode === "custom" ? "active" : ""}
            onClick={() => {
              if (!completionSound.customDataURL) {
                onSelectCompletionSound();
                return;
              }
              onSetCompletionSoundMode("custom");
            }}
          >
            自选声音
          </button>
        </div>
        <div className="android-settings-action-grid">
          <button type="button" onClick={onPreviewCompletionSound}>听听回响</button>
          <button type="button" onClick={onSelectCompletionSound}>选入音频</button>
          <button type="button" onClick={onResetCompletionSound}>恢复内置音</button>
        </div>
      </div>
    </section>
  );

  const appearanceSection = (
    <section className="android-settings-card android-settings-card-appearance">
      <div className="android-settings-section-title">光影 · 外观与字号</div>
      <div className="android-settings-segmented" role="group" aria-label="界面光色">
        <button type="button" className={theme === "system" ? "active" : ""} onClick={() => onSetTheme("system")}>
          <Monitor className="h-3.5 w-3.5" /> 随系统
        </button>
        <button type="button" className={theme === "light" ? "active" : ""} onClick={() => onSetTheme("light")}>
          <Sun className="h-3.5 w-3.5" /> 晨光 · 浅色
        </button>
        <button type="button" className={theme === "dark" ? "active" : ""} onClick={() => onSetTheme("dark")}>
          <Moon className="h-3.5 w-3.5" /> 夜色 · 深色
        </button>
      </div>
      <div className="android-settings-field">
        <div>
          <span className="android-settings-field-title">文字尺度</span>
          <span className="android-settings-field-subtitle">此刻为 {Math.round(fontScale * 100)}%</span>
        </div>
        <div className="android-settings-size-pills">
          {fontSizes.map(({ label, value }) => (
            <button
              key={value}
              type="button"
              className={Math.abs(fontScale - value) < 0.01 ? "active" : ""}
              onClick={() => onSetFontScale(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );

  const historySection = (
    <section className="android-settings-card android-settings-card-history">
      <div className="android-settings-section-title">旧页 · 创作历史</div>
      <div className="android-settings-history-meter">
        <span><Database className="h-4 w-4" /> 本机保存的旧页</span>
        <strong>{historyCountLabel}</strong>
      </div>
      <div className="android-settings-action-grid">
        <button type="button" onClick={exportHistory}><Upload className="h-4 w-4" /> 备份历史</button>
        <button type="button" onClick={importHistory}><Download className="h-4 w-4" /> 读入历史</button>
        <button type="button" onClick={() => pruneHistory(3)}>删除 3 天前历史</button>
        <button type="button" onClick={() => pruneHistory(7)}>删除 7 天前历史</button>
      </div>
    </section>
  );

  const dangerSection = (
    <section className="android-settings-card android-settings-danger-card">
      <div className="android-settings-section-title">明确清理 · 本地数据</div>
      <button type="button" className="android-settings-row-action danger" onClick={clearAPIKey}>
        <span className="android-settings-row-icon"><KeyRound className="h-4 w-4" /></span>
        <span className="min-w-0 flex-1">
          <span className="android-settings-field-title">清除当前 API Key</span>
          <span className="android-settings-field-subtitle">删除当前上游在本机凭据存储中的 API Key；再次生成前需重新填写。</span>
        </span>
        <Shield className="h-4 w-4 text-red-400" />
      </button>
      <button type="button" className="android-settings-row-action danger" onClick={clearHistory}>
        <span className="android-settings-row-icon"><Trash2 className="h-4 w-4" /></span>
        <span className="min-w-0 flex-1">
          <span className="android-settings-field-title">删除全部历史</span>
          <span className="android-settings-field-subtitle">删除本地数据库中的全部历史记录，且无法撤销。</span>
        </span>
        <ChevronRight className="h-4 w-4 text-red-300" />
      </button>
    </section>
  );

  const supportSection = (
    <section className="android-settings-card android-settings-card-support">
      <div className="android-settings-section-title">来处 · 项目与反馈</div>
      <div className="android-settings-action-grid">
        <button type="button" onClick={onOpenAbout}><Info className="h-4 w-4" /> 认识项目</button>
        <button type="button" onClick={onOpenRepo}><Github className="h-4 w-4" /> 前往 GitHub</button>
        <button type="button" onClick={onOpenFeedback}><MessageSquare className="h-4 w-4" /> 留下反馈</button>
      </div>
    </section>
  );

  if (surface === "pad") {
    return (
      <div className="android-settings-panel android-settings-panel-pad" data-android-settings-surface={surface}>
        <div className="android-settings-pad-column android-settings-pad-column-primary">
          {heroSection}
          {appearanceSection}
        </div>
        <div className="android-settings-pad-column android-settings-pad-column-secondary">
          {runtimeSection}
          <div className="android-settings-pad-secondary-grid">
            {historySection}
            {dangerSection}
          </div>
          {supportSection}
        </div>
      </div>
    );
  }

  return (
    <div className={`android-settings-panel android-settings-panel-${surface}`} data-android-settings-surface={surface}>
      {heroSection}
      {runtimeSection}
      {appearanceSection}
      {historySection}
      {dangerSection}
      {supportSection}
    </div>
  );
}
