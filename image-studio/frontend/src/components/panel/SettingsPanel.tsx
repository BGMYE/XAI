import { useEffect, useRef, useState } from "react";
import {
  Bell, Download, Folder, FolderEdit, Github, Info, KeyRound,
  MessageSquare, Monitor, Moon, Network, Plug, RotateCw, Save, Sun, Trash2, Upload,
} from "lucide-react";
import { useStudioStore } from "../../state/studioStore";
import {
  GetOutputDir, OpenOutputDir, OpenExternalURL, ChooseOutputDir, SetOutputDir,
  GetStoredAPIKey,
} from "../../platform/runtime/host";
import * as HostRuntime from "../../platform/runtime/host";
import type { KernelRuntimeMode, ProxyMode, SystemNotificationPermissionState } from "../../types/domain";
import { MAX_AUTO_RETRY_COUNT } from "../../../../../shared/kernel/requestModel.js";
import { Modal } from "../common/Modal";
import { rememberTrustedOutputRoot } from "../../lib/storage";
import { scheduleCompatibilityExport } from "../../lib/compatState";
import { platformOutputRootLabel } from "../../platform";
import { androidTarget, openExternalURLForPlatform, openOutputLocationForPlatform } from "../../platform/android/bridge";
import { AndroidSettingsPanel } from "../../platform/android/settings/AndroidSettingsPanel";
import { usePlatform } from "../../platform/context";
import { AboutImageStudioModal } from "./AboutImageStudioModal";
import {
  SettingsAnchorNav,
  SettingsRow,
  SettingsSection,
  SettingsSegButton,
} from "./settingsPrimitives";
import { importCompletionSoundFile } from "../../lib/completionSound";
import { keyringUserFor } from "../../lib/profiles";
import type { UpstreamProfile } from "../../types/domain";
import { buildUpstreamModelCatalog, type UpstreamModelCatalog } from "../../lib/upstreamModels.ts";
import "../../styles/_xai-typography.css";
import "./settings-navigation.css";

const REPO_URL = "https://github.com/BGMYE/XAI";
const RELEASES_URL = "https://github.com/BGMYE/XAI/releases";
const ISSUES_URL = "https://github.com/BGMYE/XAI/issues";
const LICENSE_URL = "https://www.gnu.org/licenses/agpl-3.0.html";

type DesktopSettingsSectionId =
  | "runtime"
  | "files"
  | "alerts"
  | "appearance"
  | "data"
  | "about";

const DESKTOP_SETTINGS_SECTIONS: ReadonlyArray<{
  id: DesktopSettingsSectionId;
  title: string;
}> = [
  {
    id: "runtime",
    title: "行旅 · 运行与网络",
  },
  {
    id: "files",
    title: "归处 · 输出与缓存",
  },
  {
    id: "alerts",
    title: "回响 · 通知与提示",
  },
  {
    id: "appearance",
    title: "光影 · 外观与字号",
  },
  {
    id: "data",
    title: "旧页 · 数据与重置",
  },
  {
    id: "about",
    title: "来处 · 关于与反馈",
  },
];

export function SettingsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const {
    kernelRuntimeMode,
    proxyMode, proxyURL,
    autoRetryEnabled,
    autoRetryCount,
    protectStreamPreview,
    theme, fontScale,
    setField, setAPIKey, setProxyConfig,
    history,
    clearHistory: clearStoredHistory,
    exportHistory, importHistory,
    pruneHistoryOlderThanDays,
    setTheme, setFontScale,
    pushToast,
    apiKey, baseURL, apiMode,
    profiles, activeProfileId, setActiveProfile, createProfile, updateProfile,
    openUpstreamConfig, testAPIKey, isTestingKey,
    savePromptSuppressed, setSavePromptSuppressed,
    keepLogs, setKeepLogs,
    cleanupPreviewCacheOnExit, setCleanupPreviewCacheOnExit,
    completionSound,
    completionNotification,
    completionNotificationPermission,
    setCompletionSoundEnabled,
    setCompletionSoundMode,
    setCompletionSoundCustom,
    resetCompletionSoundCustom,
    previewCompletionSound,
    setCompletionNotificationEnabled,
    requestCompletionNotificationPermission,
  } = useStudioStore();

  const [outputDir, setOutputDir] = useState("");
  const [aboutOpen, setAboutOpen] = useState(false);
  const [activeDesktopSection, setActiveDesktopSection] = useState<DesktopSettingsSectionId>(DESKTOP_SETTINGS_SECTIONS[0].id);
  const [upstreamDraft, setUpstreamDraft] = useState<UpstreamProfile | null>(null);
  const [upstreamDraftKey, setUpstreamDraftKey] = useState("");
  const [upstreamSaving, setUpstreamSaving] = useState(false);
  const [inlineModelCatalog, setInlineModelCatalog] = useState<UpstreamModelCatalog | null>(null);
  const [inlineModelsLoading, setInlineModelsLoading] = useState(false);
  const [customModelID, setCustomModelID] = useState("");
  const desktopContentRef = useRef<HTMLDivElement | null>(null);
  const { isMac, usesFluentUI, isAndroid, isAndroidPad } = usePlatform();

  useEffect(() => {
    if (!open) return;
    GetOutputDir().then(setOutputDir).catch(() => undefined);
  }, [open]);

  useEffect(() => {
    if (!open || isAndroid) return;
    setActiveDesktopSection(DESKTOP_SETTINGS_SECTIONS[0].id);
    if (desktopContentRef.current) desktopContentRef.current.scrollTop = 0;
  }, [isAndroid, open]);

  useEffect(() => {
    const profile = profiles.find((item) => item.id === activeProfileId) ?? null;
    setUpstreamDraft(profile);
    setUpstreamDraftKey("");
    setInlineModelCatalog(profile?.modelIDs?.length ? buildUpstreamModelCatalog(profile.modelIDs.map((id) => ({ id }))) : null);
    setCustomModelID("");
    if (profile) {
      GetStoredAPIKey(keyringUserFor(profile.id)).then((key) => setUpstreamDraftKey(key ?? "")).catch(() => undefined);
    }
  }, [activeProfileId, profiles]);

  async function loadInlineModels() {
    if (!upstreamDraft || !upstreamDraft.baseURL.trim() || !upstreamDraftKey.trim()) {
      pushToast("请先填写 Base URL 与 API Key，再获取上游模型", "warn");
      return;
    }
    setInlineModelsLoading(true);
    try {
      const state = useStudioStore.getState();
      const result = await HostRuntime.probeCurrentUpstream(
        upstreamDraft.baseURL,
        upstreamDraftKey,
        state.proxyMode,
        state.proxyURL,
        upstreamDraft.apiMode,
        upstreamDraft.responsesTransport ?? "sse",
        upstreamDraft.allowInsecureConnection === true,
      );
      const catalog = buildUpstreamModelCatalog(result.models ?? []);
      const modelIDs = Array.from(new Set([...(upstreamDraft.modelIDs ?? []), ...catalog.all.map((model) => model.id)]));
      setInlineModelCatalog(buildUpstreamModelCatalog(modelIDs.map((id) => ({ id }))));
      setUpstreamDraft((current) => current ? { ...current, modelIDs } : current);
      pushToast(`已获取 ${catalog.all.length} 个上游模型`, catalog.all.length ? "success" : "warn");
    } catch (error: any) {
      pushToast(`模型目录获取失败：${error?.message ?? error}`, "error", 6000);
    } finally {
      setInlineModelsLoading(false);
    }
  }

  function addInlineCustomModel() {
    const id = customModelID.trim();
    if (!id) return;
    setUpstreamDraft((current) => {
      if (!current) return current;
      const modelIDs = Array.from(new Set([...(current.modelIDs ?? []), id]));
      setInlineModelCatalog(buildUpstreamModelCatalog(modelIDs.map((value) => ({ id: value }))));
      return { ...current, modelIDs };
    });
    setCustomModelID("");
  }

  async function saveInlineUpstream() {
    if (!upstreamDraft) return;
    setUpstreamSaving(true);
    try {
      const ok = await updateProfile(upstreamDraft.id, {
        name: upstreamDraft.name,
        apiMode: upstreamDraft.apiMode,
        requestPolicy: upstreamDraft.requestPolicy,
        baseURL: upstreamDraft.baseURL,
        imageModelID: upstreamDraft.imageModelID,
        textModelID: upstreamDraft.textModelID,
        modelIDs: upstreamDraft.modelIDs,
        apiKey: upstreamDraftKey,
      });
      if (ok) pushToast("上游连接与凭据已保存", "success");
    } finally {
      setUpstreamSaving(false);
    }
  }

  async function createInlineUpstream() {
    const id = await createProfile({ apiMode: "images", requestPolicy: "openai", setActive: true });
    if (id) pushToast("已添入 Images 上游，请继续填写连接信息", "success");
  }

  async function clearAPIKey() {
    if (!confirm("要清除当前上游在本机保存的 API Key 吗？清除后需重新填写才能生成。")) return;
    try {
      await setAPIKey("");
      pushToast("当前上游在本机凭据存储中的 API Key 已清除", "success");
    } catch (e: any) {
      pushToast(`未能清除：${e?.message ?? e}`, "error", 5000);
    }
  }

  async function clearHistory() {
    if (!confirm("要删除全部历史记录吗？\n\n本地数据库中的所有历史都会被清空，此操作无法撤销。")) return;
    try {
      const removed = await clearStoredHistory();
      pushToast(removed > 0 ? `全部 ${removed} 条本地历史已删除` : "全部本地历史已清空", "success");
    } catch (error) {
      pushToast(`未能清空历史：${error instanceof Error ? error.message : String(error)}`, "error", 5000);
    }
  }

  async function pruneHistory(days: number) {
    const removed = await pruneHistoryOlderThanDays(days);
    if (removed > 0) pushToast(`已删除 ${days} 天前的 ${removed} 条历史记录`, "success");
    else pushToast(`${days} 天前没有待清理的旧记录`, "info");
  }

  function openOutputLocation() {
    openOutputLocationForPlatform(OpenOutputDir).catch((e) => pushToast(e?.message ?? "暂时无法抵达作品保存的位置", "warn"));
  }

  function openExternal(url: string) {
    openExternalURLForPlatform(url, OpenExternalURL).catch(() => undefined);
  }

  function updateSavePromptSuppressed(value: boolean) {
    setSavePromptSuppressed(value);
    scheduleCompatibilityExport(useStudioStore.getState());
    pushToast(value ? "作品落定后，将不再弹出另存提醒" : "作品落定后，会提醒你选择另存位置", "success");
  }

  async function updateKeepLogs(value: boolean) {
    await setKeepLogs(value);
    pushToast(value ? "运行日志将留存，便于日后回看" : "日志不再长期留存，退出应用时会清理 log", "success");
  }

  async function updateCleanupPreviewCacheOnExit(value: boolean) {
    await setCleanupPreviewCacheOnExit(value);
    pushToast(
      value ? "退出应用时，将清理可重建的预览缓存" : "预览缓存将保留，供下次打开时使用",
      "success",
    );
  }

  async function chooseCompletionSoundFile() {
    if (typeof document === "undefined") return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "audio/*,.mp3,.wav,.ogg,.m4a,.aac,.webm";
    input.style.position = "fixed";
    input.style.left = "-9999px";
    document.body.appendChild(input);
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return;
      void (async () => {
        try {
          const imported = await importCompletionSoundFile(file);
          setCompletionSoundCustom(imported);
          pushToast(`完成时的回响已换为：${imported.name}`, "success");
        } catch (e: any) {
          pushToast(e?.message ?? "这段声音暂未能导入", "error", 5000);
        }
      })();
    }, { once: true });
    input.click();
  }

  function systemNotificationPermissionLabel(permission: SystemNotificationPermissionState): string {
    if (permission === "granted") return "通知已获允许";
    if (permission === "denied") return "通知权限已拒绝";
    if (permission === "unsupported") return "此平台暂不支持";
    return "等待你的授权";
  }

  async function updateCompletionNotificationEnabled(value: boolean) {
    const permission = await setCompletionNotificationEnabled(value);
    if (!value) {
      pushToast("完成消息将留在应用内，不再发送系统通知", "success");
      return;
    }
    if (permission === "granted") {
      pushToast("离开窗口时，系统通知会带来完成消息", "success");
      return;
    }
    if (permission === "unsupported") {
      pushToast("此平台暂时无法送出系统通知", "warn", 5000);
      return;
    }
    if (permission === "denied") {
      pushToast("系统通知尚被阻止；请到系统设置中允许，再试一次", "warn", 6000);
      return;
    }
    pushToast("请先允许系统通知，完成消息才能送达", "warn");
  }

  async function askCompletionNotificationPermission() {
    const permission = await requestCompletionNotificationPermission();
    if (permission === "granted") {
      pushToast("系统通知已获授权，完成消息可以送达", "success");
    } else if (permission === "denied") {
      pushToast("系统通知尚被阻止；请到系统设置中允许，再试一次", "warn", 6000);
    } else if (permission === "unsupported") {
      pushToast("此平台暂时无法送出系统通知", "warn", 5000);
    } else {
      pushToast("系统通知仍在等待授权", "warn");
    }
  }

  function closeSettings() {
    setAboutOpen(false);
    onClose();
  }

  function selectDesktopSection(id: DesktopSettingsSectionId) {
    setActiveDesktopSection(id);
    if (desktopContentRef.current) desktopContentRef.current.scrollTop = 0;
  }

  const outputLabel = androidTarget.isAndroid ? platformOutputRootLabel() : (outputDir || "...");
  const activeProfile = profiles.find((profile) => profile.id === activeProfileId);
  const upstreamReady = !!apiKey.trim() && !!baseURL.trim();
  const segmentedControlClassName = `platform-seg flex flex-wrap gap-1 bg-black/[0.04] p-0.5 ring-1 ring-black/[0.05] dark:bg-white/[0.06] dark:ring-white/[0.06] ${usesFluentUI ? "rounded-[10px]" : "rounded-[18px]"}`;
  const actionButtonBaseClassName = `inline-flex min-h-[34px] items-center justify-center gap-1.5 border border-black/[0.08] px-3 ${isMac ? "py-2.5 text-[13px]" : "py-2 text-[12px]"} font-medium transition-colors dark:border-white/[0.08] ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`;
  const actionButtonPrimaryClassName = `${actionButtonBaseClassName} text-zinc-700 hover:border-[color:var(--accent)]/35 hover:text-[var(--accent)] dark:text-zinc-300`;
  const actionButtonSecondaryClassName = `${actionButtonBaseClassName} text-zinc-500 hover:border-[color:var(--accent)]/35 hover:text-[var(--accent)] dark:text-zinc-300`;
  const actionButtonDangerClassName = `${actionButtonBaseClassName} text-zinc-500 hover:border-red-400/40 hover:text-red-400 dark:text-zinc-300`;

  const androidSettings = isAndroid ? (
    <AndroidSettingsPanel
      activeProfile={activeProfile}
      activeProfileId={activeProfileId}
      apiMode={apiMode}
      clearAPIKey={() => void clearAPIKey()}
      clearHistory={() => void clearHistory()}
      exportHistory={() => void exportHistory()}
      fontScale={fontScale}
      historyCount={history.length}
      importHistory={() => void importHistory()}
      isTestingKey={isTestingKey}
      autoRetryEnabled={autoRetryEnabled}
      autoRetryCount={autoRetryCount}
      protectStreamPreview={protectStreamPreview}
      kernelRuntimeMode={kernelRuntimeMode}
      onOpenAbout={() => setAboutOpen(true)}
      onOpenFeedback={() => openExternal(ISSUES_URL)}
      onOpenRepo={() => openExternal(REPO_URL)}
      onOpenUpstream={() => openUpstreamConfig("settings")}
      onPreviewCompletionSound={() => void previewCompletionSound()}
      onResetCompletionSound={() => {
        resetCompletionSoundCustom();
        pushToast("已恢复最初的内置提示音", "success");
      }}
      onSelectCompletionSound={() => void chooseCompletionSoundFile()}
      onSetActiveProfile={(id) => {
        if (id) void setActiveProfile(id);
      }}
      onSetCompletionSoundEnabled={(value) => {
        setCompletionSoundEnabled(value);
        pushToast(value ? "作品落定时，会响起一声提醒" : "作品落定时，将保持安静", "success");
      }}
      onSetCompletionSoundMode={(value) => {
        setCompletionSoundMode(value);
        pushToast(value === "custom" ? "完成时将奏响你选定的声音" : "完成时将响起内置提示音", "success");
      }}
      onSetFontScale={setFontScale}
      onSetKernelRuntimeMode={(value) => setField("kernelRuntimeMode", value)}
      onSetAutoRetryEnabled={(value) => {
        setField("autoRetryEnabled", value);
        scheduleCompatibilityExport(useStudioStore.getState());
        pushToast(value ? "遇到可重试的波折，会自动再试" : "自动重试已停用，失败后等待你的下一步", "success");
      }}
      onSetAutoRetryCount={(value) => setField("autoRetryCount", value)}
      onSetProtectStreamPreview={(value) => {
        setField("protectStreamPreview", value);
        scheduleCompatibilityExport(useStudioStore.getState());
        pushToast(value ? "预览保护已启用，优先守住最终图的完整" : "预览保护已停用，将遵循设定的预览帧数", "success");
      }}
      onSetCleanupPreviewCacheOnExit={(value) => void updateCleanupPreviewCacheOnExit(value)}
      onSetProxyConfig={setProxyConfig}
      onSetSavePromptSuppressed={updateSavePromptSuppressed}
      onSetTheme={setTheme}
      completionSound={completionSound}
      openOutputLocation={openOutputLocation}
      outputLabel={outputLabel}
      profiles={profiles}
      proxyMode={proxyMode}
      proxyURL={proxyURL}
      pruneHistory={(days) => void pruneHistory(days)}
      cleanupPreviewCacheOnExit={cleanupPreviewCacheOnExit}
      savePromptSuppressed={savePromptSuppressed}
      surface={isAndroidPad ? "pad" : "phone"}
      testAPIKey={() => void testAPIKey()}
      theme={theme}
      upstreamReady={upstreamReady}
    />
  ) : null;

  const desktopSettings = (
    <div className="settings-category-layout">
      <SettingsAnchorNav
        sections={DESKTOP_SETTINGS_SECTIONS}
        activeId={activeDesktopSection}
        onSelect={(id) => selectDesktopSection(id as DesktopSettingsSectionId)}
      />

      <div ref={desktopContentRef} className="settings-category-content">
        <SettingsSection
          id="settings-runtime"
          active={activeDesktopSection === "runtime"}
          title="行旅 · 运行与网络"
        >
          <SettingsRow label="内核 · 创作在哪里运行">
            <select
              value={kernelRuntimeMode}
              onChange={(e) => setField("kernelRuntimeMode", e.target.value as KernelRuntimeMode)}
              className={`focus-ring w-full border border-black/[0.08] bg-[var(--surface)] px-3 ${isMac ? "min-h-[44px] py-3 text-[14px]" : "py-2.5 text-[12px]"} text-zinc-900 dark:border-white/[0.08] dark:text-zinc-100 ${usesFluentUI ? "rounded-[10px]" : "rounded-[16px]"}`}
            >
              <option value="auto">自动择路（auto）</option>
              <option value="local">留在本机（local · Go/Wails）</option>
              <option value="remote">交给远端（remote · 共享内核）</option>
            </select>
            <p className="mt-1 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-300">
              remote 与 Android / Worker 共用远程内核。
            </p>
          </SettingsRow>

          <SettingsRow label="上游 · 连接与凭据">
            {upstreamDraft ? (
              <div className="space-y-2 rounded-[12px] border border-black/[0.08] bg-[var(--surface)] p-3 dark:border-white/[0.08]">
                <label className="block text-[11px] font-medium text-zinc-600 dark:text-zinc-300">上游名称
                  <input
                    aria-label="上游名称"
                    value={upstreamDraft.name}
                    onChange={(event) => setUpstreamDraft({ ...upstreamDraft, name: event.target.value })}
                    placeholder="配置名称"
                    className={`focus-ring mt-1 w-full border border-black/[0.08] bg-transparent px-3 py-2.5 text-[12px] text-zinc-900 placeholder:text-zinc-400 dark:border-white/[0.08] dark:text-zinc-100 ${usesFluentUI ? "rounded-[8px]" : "rounded-[12px]"}`}
                  />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block text-[11px] font-medium text-zinc-600 dark:text-zinc-300">API 形态
                    <select
                      aria-label="API 形态"
                      value={upstreamDraft.apiMode}
                      onChange={(event) => setUpstreamDraft({ ...upstreamDraft, apiMode: event.target.value as UpstreamProfile["apiMode"] })}
                      className={`focus-ring mt-1 w-full border border-black/[0.08] bg-transparent px-3 py-2.5 text-[12px] text-zinc-900 dark:border-white/[0.08] dark:text-zinc-100 ${usesFluentUI ? "rounded-[8px]" : "rounded-[12px]"}`}
                    >
                      <option value="images">Images API</option>
                      <option value="responses">Responses API</option>
                    </select>
                  </label>
                  <label className="block text-[11px] font-medium text-zinc-600 dark:text-zinc-300">请求策略
                    <select
                      aria-label="请求策略"
                      value={upstreamDraft.requestPolicy}
                      onChange={(event) => setUpstreamDraft({ ...upstreamDraft, requestPolicy: event.target.value as UpstreamProfile["requestPolicy"] })}
                      className={`focus-ring mt-1 w-full border border-black/[0.08] bg-transparent px-3 py-2.5 text-[12px] text-zinc-900 dark:border-white/[0.08] dark:text-zinc-100 ${usesFluentUI ? "rounded-[8px]" : "rounded-[12px]"}`}
                    >
                      <option value="openai">OpenAI 标准</option>
                      <option value="compat">扩展兼容</option>
                    </select>
                  </label>
                </div>
                <label className="block text-[11px] font-medium text-zinc-600 dark:text-zinc-300">Base URL
                  <input aria-label="Base URL" value={upstreamDraft.baseURL} onChange={(event) => setUpstreamDraft({ ...upstreamDraft, baseURL: event.target.value })} placeholder="https://api.example.com" className={`focus-ring mt-1 w-full border border-black/[0.08] bg-transparent px-3 py-2.5 text-[12px] font-mono-token text-zinc-900 placeholder:text-zinc-400 dark:border-white/[0.08] dark:text-zinc-100 ${usesFluentUI ? "rounded-[8px]" : "rounded-[12px]"}`} />
                </label>
                <label className="block text-[11px] font-medium text-zinc-600 dark:text-zinc-300">图像模型
                  <input aria-label="图像模型" value={upstreamDraft.imageModelID} onChange={(event) => setUpstreamDraft({ ...upstreamDraft, imageModelID: event.target.value })} placeholder="gpt-image-2.5-sunburst" className={`focus-ring mt-1 w-full border border-black/[0.08] bg-transparent px-3 py-2.5 text-[12px] text-zinc-900 placeholder:text-zinc-400 dark:border-white/[0.08] dark:text-zinc-100 ${usesFluentUI ? "rounded-[8px]" : "rounded-[12px]"}`} />
                </label>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-300">上游模型目录</span>
                    <button type="button" onClick={() => void loadInlineModels()} disabled={inlineModelsLoading} className="text-[11px] font-medium text-[var(--accent)] disabled:opacity-50">
                      {inlineModelsLoading ? "获取中…" : "获取上游模型"}
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <input aria-label="自定义模型 ID" value={customModelID} onChange={(event) => setCustomModelID(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addInlineCustomModel(); } }} placeholder="自定义模型 ID，可添加多个" className={`focus-ring min-w-0 flex-1 border border-black/[0.08] bg-transparent px-3 py-2 text-[12px] font-mono-token text-zinc-900 placeholder:text-zinc-400 dark:border-white/[0.08] dark:text-zinc-100 ${usesFluentUI ? "rounded-[8px]" : "rounded-[12px]"}`} />
                    <button type="button" onClick={addInlineCustomModel} className={`${actionButtonSecondaryClassName} shrink-0`}>添加</button>
                  </div>
                  {inlineModelCatalog && inlineModelCatalog.all.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {inlineModelCatalog.all.map((model) => (
                        <button key={model.id} type="button" onClick={() => setUpstreamDraft({ ...upstreamDraft, imageModelID: model.id })} className={`max-w-full truncate border px-2 py-1 text-[10px] ${model.id === upstreamDraft.imageModelID ? "border-[color:var(--accent)]/40 bg-[var(--accent-soft)] text-[var(--accent)]" : "border-black/[0.08] text-zinc-600 dark:border-white/[0.08] dark:text-zinc-300"} ${usesFluentUI ? "rounded-[6px]" : "rounded-full"}`} title={model.id}>{model.id}</button>
                      ))}
                    </div>
                  ) : null}
                  <p className="text-[10px] leading-relaxed text-zinc-500 dark:text-zinc-400">获取目录后会自动保存在当前上游；也可手动添加多个模型并点击模型标签切换。</p>
                </div>
                <label className="block text-[11px] font-medium text-zinc-600 dark:text-zinc-300">API Key
                  <input aria-label="API Key" type="password" value={upstreamDraftKey} onChange={(event) => setUpstreamDraftKey(event.target.value)} placeholder="仅保存至系统凭据存储" className={`focus-ring mt-1 w-full border border-black/[0.08] bg-transparent px-3 py-2.5 text-[12px] font-mono-token text-zinc-900 placeholder:text-zinc-400 dark:border-white/[0.08] dark:text-zinc-100 ${usesFluentUI ? "rounded-[8px]" : "rounded-[12px]"}`} />
                </label>
                <button type="button" onClick={() => void saveInlineUpstream()} disabled={upstreamSaving || !upstreamDraft.baseURL.trim() || !upstreamDraftKey.trim()} className={`w-full ${actionButtonPrimaryClassName} disabled:cursor-not-allowed disabled:opacity-50`}>
                  {upstreamSaving ? "正在保存…" : "保存连接与凭据"}
                </button>
              </div>
            ) : <button type="button" onClick={() => void createInlineUpstream()} className={`w-full ${actionButtonPrimaryClassName}`}>添入 Images 上游配置</button>}
            <div className="flex items-center gap-2 rounded-[12px] border border-black/[0.08] bg-[var(--surface)] px-3 py-2.5 dark:border-white/[0.08]">
              <Plug className="h-4 w-4 shrink-0 text-[var(--accent)]" />
              <div className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-zinc-800 dark:text-zinc-100">
                  {activeProfile ? activeProfile.name : "尚待添入一处可用上游"}
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-zinc-500 dark:text-zinc-300">
                  {activeProfile
                    ? `${apiMode === "images" ? "Images API" : "Responses API"} · ${upstreamReady ? "凭据已就绪" : "等待填写 API Key 与地址"}`
                    : "在这里添加并管理 API Key、模型和请求地址"}
                </span>
              </div>
              <span className={`shrink-0 text-[11px] font-semibold ${upstreamReady ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-500 dark:text-zinc-400"}`}>
                {upstreamReady ? "已就绪" : "待配置"}
              </span>
            </div>
            {profiles.length > 0 ? (
              <select
                aria-label="当前上游配置"
                value={activeProfileId}
                onChange={(event) => void setActiveProfile(event.target.value)}
                className={`focus-ring mt-2 w-full border border-black/[0.08] bg-[var(--surface)] px-3 py-2.5 text-[12px] text-zinc-900 dark:border-white/[0.08] dark:text-zinc-100 ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}
              >
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name} · {profile.apiMode === "images" ? "Images" : "Responses"}
                  </option>
                ))}
              </select>
            ) : null}
            <div className="mt-2 flex gap-1.5">
              <button onClick={() => openUpstreamConfig("settings")} className={`flex-1 ${actionButtonPrimaryClassName}`}>
                <Plug className="w-3 h-3" /> 打理上游配置
              </button>
              <button onClick={() => void testAPIKey()} disabled={!upstreamReady || isTestingKey} className={`flex-1 ${actionButtonSecondaryClassName}`}>
                {isTestingKey ? "正在探路…" : "探测连接"}
              </button>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-300">
              API Key 仅保存在系统凭据存储；模型、地址与接口形态可在上游配置中调整。
            </p>
          </SettingsRow>

          <SettingsRow label="代理 · 请求的途经之地">
            <div className={segmentedControlClassName}>
              {([
                ["none", "直接连接"],
                ["system", "沿用系统"],
                ["custom", "自行指定"],
              ] as Array<[ProxyMode, string]>).map(([value, label]) => (
                <SettingsSegButton key={value} active={proxyMode === value} onClick={() => setProxyConfig(value)}>
                  {value === "custom" ? <Network className="w-3 h-3" /> : null}
                  {label}
                </SettingsSegButton>
              ))}
            </div>
            {proxyMode === "custom" ? (
              <input
                value={proxyURL}
                onChange={(e) => setProxyConfig("custom", e.target.value)}
                placeholder="http://127.0.0.1:7890"
                className={`focus-ring mt-2 w-full border border-black/[0.08] bg-[var(--surface)] px-3 ${isMac ? "min-h-[42px] py-2.5 text-[13px]" : "py-2.5 text-[12px]"} font-mono-token text-zinc-900 placeholder:text-zinc-400 dark:border-white/[0.08] dark:text-zinc-100 ${usesFluentUI ? "rounded-[8px]" : "rounded-[14px]"}`}
              />
            ) : null}
            <p className="mt-1 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-300">
              自定义代理支持 http://、https:// 地址。
            </p>
          </SettingsRow>

          <SettingsRow label="重试 · 遇到波折再出发">
            <div className={segmentedControlClassName}>
              <SettingsSegButton active={autoRetryEnabled} onClick={() => {
                setField("autoRetryEnabled", true);
                scheduleCompatibilityExport(useStudioStore.getState());
                pushToast("遇到可重试的波折，会自动再试", "success");
              }}>
                启用
              </SettingsSegButton>
              <SettingsSegButton active={!autoRetryEnabled} onClick={() => {
                setField("autoRetryEnabled", false);
                scheduleCompatibilityExport(useStudioStore.getState());
                pushToast("自动重试已停用，失败后等待你的下一步", "success");
              }}>
                停用
              </SettingsSegButton>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-300">
              遇到 403 / 502 / 503 / 504 / 524 或可重试的网络错误时，自动重试。
            </p>
            <div className="mt-2 flex items-center gap-3">
              <input
                type="range"
                min={1}
                max={MAX_AUTO_RETRY_COUNT}
                step={1}
                value={autoRetryCount}
                onChange={(e) => setField("autoRetryCount", Number(e.target.value))}
                onMouseUp={() => {
                  const value = useStudioStore.getState().autoRetryCount;
                  scheduleCompatibilityExport(useStudioStore.getState());
                  pushToast(`遇到波折时，最多再试 ${value} 次`, "success");
                }}
                onTouchEnd={() => {
                  const value = useStudioStore.getState().autoRetryCount;
                  scheduleCompatibilityExport(useStudioStore.getState());
                  pushToast(`遇到波折时，最多再试 ${value} 次`, "success");
                }}
                className="focus-ring flex-1"
              />
              <div className="min-w-[88px] rounded-[14px] border border-black/[0.08] bg-[var(--surface)] px-3 py-2 text-center text-[12px] font-medium text-zinc-800 dark:border-white/[0.08] dark:text-zinc-100">
                {autoRetryCount} 次
              </div>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-300">
              重试次数不含首次请求。
            </p>
          </SettingsRow>

          <SettingsRow label="预览 · 守护完整成图">
            <div className={segmentedControlClassName}>
              <SettingsSegButton active={protectStreamPreview} onClick={() => {
                setField("protectStreamPreview", true);
                scheduleCompatibilityExport(useStudioStore.getState());
                pushToast("预览保护已启用，优先守住最终图的完整", "success");
              }}>
                启用
              </SettingsSegButton>
              <SettingsSegButton active={!protectStreamPreview} onClick={() => {
                setField("protectStreamPreview", false);
                scheduleCompatibilityExport(useStudioStore.getState());
                pushToast("预览保护已停用，将遵循设定的预览帧数", "success");
              }}>
                停用
              </SettingsSegButton>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-300">
              高并发或 Android 大尺寸任务会暂停流式预览；停用后按设定帧数预览。
            </p>
          </SettingsRow>
        </SettingsSection>

        <SettingsSection
          id="settings-files"
          active={activeDesktopSection === "files"}
          title="归处 · 输出与缓存"
        >
          <SettingsRow label="作品归处 · 保存目录">
            <div className={`flex items-center gap-1 border border-black/[0.08] bg-[var(--surface)] px-3 ${isMac ? "py-3" : "py-2.5"} dark:border-white/[0.08] ${usesFluentUI ? "rounded-[10px]" : "rounded-[16px]"}`}>
              <span title={outputDir} className={`flex-1 truncate font-mono-token text-zinc-700 dark:text-zinc-200 ${isMac ? "text-[13px]" : "text-[12px]"}`}>
                {outputDir || "..."}
              </span>
              <button
                onClick={openOutputLocation}
                title="在系统文件管理器中前往作品归处"
                className={`p-1 text-zinc-500 hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] ${usesFluentUI ? "rounded-[6px]" : "rounded-full"}`}
              >
                <Folder className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="mt-1.5 flex gap-1.5">
              <button
                onClick={async () => {
                  try {
                    const chosen = await ChooseOutputDir();
                    if (chosen) {
                      try { localStorage.setItem("gptcodex.outputDir", chosen); } catch {}
                      rememberTrustedOutputRoot(chosen);
                      setOutputDir(chosen);
                      scheduleCompatibilityExport(useStudioStore.getState());
                      pushToast(`作品的保存位置已换为：${chosen}`, "success");
                    }
                  } catch (e: any) {
                    pushToast(`未能切换保存位置：${e?.message ?? e}`, "error", 5000);
                  }
                }}
                className={`flex-1 ${actionButtonPrimaryClassName}`}
              >
                <FolderEdit className="w-3 h-3" /> 另择位置
              </button>
              <button
                onClick={async () => {
                  try {
                    await SetOutputDir("");
                    try { localStorage.removeItem("gptcodex.outputDir"); } catch {}
                    const def = await GetOutputDir();
                    rememberTrustedOutputRoot(def);
                    setOutputDir(def);
                    scheduleCompatibilityExport(useStudioStore.getState());
                    pushToast("已恢复最初的作品保存目录", "success");
                  } catch (e: any) {
                    pushToast(`未能恢复默认目录：${e?.message ?? e}`, "error", 5000);
                  }
                }}
                title={`清除自选保存路径，恢复到 ${platformOutputRootLabel()}/images`}
                className={actionButtonSecondaryClassName}
              >
                <RotateCw className="w-3 h-3" /> 恢复默认
              </button>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-300">
              源图、成图及会话输出保存在此。
            </p>
          </SettingsRow>

          <SettingsRow label="落定之后 · 另存提醒">
            <div className={segmentedControlClassName}>
              <SettingsSegButton active={!savePromptSuppressed} onClick={() => updateSavePromptSuppressed(false)}>
                <Save className="w-3 h-3" /> 轻声提醒
              </SettingsSegButton>
              <SettingsSegButton active={savePromptSuppressed} onClick={() => updateSavePromptSuppressed(true)}>
                不再提醒
              </SettingsSegButton>
            </div>
          </SettingsRow>

          <SettingsRow label="运行札记 · 日志保留">
            <div className={segmentedControlClassName}>
              <SettingsSegButton active={!keepLogs} onClick={() => void updateKeepLogs(false)}>
                停用
              </SettingsSegButton>
              <SettingsSegButton active={keepLogs} onClick={() => void updateKeepLogs(true)}>
                启用
              </SettingsSegButton>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-300">
              停用后，退出时清理输出目录内的 log；当前会话仍可查看原始响应。
            </p>
          </SettingsRow>

          <SettingsRow label="离开时 · 清理预览缓存">
            <div className={segmentedControlClassName}>
              <SettingsSegButton active={!cleanupPreviewCacheOnExit} onClick={() => void updateCleanupPreviewCacheOnExit(false)}>
                停用
              </SettingsSegButton>
              <SettingsSegButton active={cleanupPreviewCacheOnExit} onClick={() => void updateCleanupPreviewCacheOnExit(true)}>
                启用
              </SettingsSegButton>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-300">
              退出时删除可重建的预览与缩略图缓存，保留源图、成图和历史。
            </p>
          </SettingsRow>
        </SettingsSection>

        <SettingsSection
          id="settings-alerts"
          active={activeDesktopSection === "alerts"}
          title="回响 · 通知与提示"
        >
          <SettingsRow label="成图回响 · 提示音">
            <div className={segmentedControlClassName}>
              <SettingsSegButton active={completionSound.enabled} onClick={() => {
                setCompletionSoundEnabled(true);
                pushToast("作品落定时，会响起一声提醒", "success");
              }}>
                <Bell className="w-3 h-3" /> 启用
              </SettingsSegButton>
              <SettingsSegButton active={!completionSound.enabled} onClick={() => {
                setCompletionSoundEnabled(false);
                pushToast("作品落定时，将保持安静", "success");
              }}>
                停用
              </SettingsSegButton>
            </div>
            <div className={`mt-2 ${segmentedControlClassName}`}>
              <SettingsSegButton active={completionSound.mode === "default"} onClick={() => {
                setCompletionSoundMode("default");
                pushToast("完成时将响起内置提示音", "success");
              }}>
                内置回响
              </SettingsSegButton>
              <SettingsSegButton active={completionSound.mode === "custom"} onClick={() => {
                if (!completionSound.customDataURL) {
                  void chooseCompletionSoundFile();
                  return;
                }
                setCompletionSoundMode("custom");
                pushToast("完成时将奏响你选定的声音", "success");
              }}>
                自选声音
              </SettingsSegButton>
            </div>
            <div className="mt-2 flex gap-1.5">
              <button onClick={() => void previewCompletionSound()} className={`flex-1 ${actionButtonPrimaryClassName}`}>
                听听回响
              </button>
              <button onClick={() => void chooseCompletionSoundFile()} className={`flex-1 ${actionButtonPrimaryClassName}`}>
                选入音频
              </button>
              <button
                onClick={() => {
                  resetCompletionSoundCustom();
                  pushToast("已恢复最初的内置提示音", "success");
                }}
                className={actionButtonSecondaryClassName}
              >
                恢复内置音
              </button>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-300">
              整批完成后响一次。当前：{completionSound.mode === "custom" && completionSound.customName ? `${completionSound.customName}` : "内置提示音"}。
            </p>
          </SettingsRow>

          <SettingsRow label="远处来信 · 系统通知">
            <div className={segmentedControlClassName}>
              <SettingsSegButton active={completionNotification.enabled} onClick={() => void updateCompletionNotificationEnabled(true)}>
                <Bell className="w-3 h-3" /> 启用
              </SettingsSegButton>
              <SettingsSegButton active={!completionNotification.enabled} onClick={() => void updateCompletionNotificationEnabled(false)}>
                停用
              </SettingsSegButton>
            </div>
            <div className="mt-2 flex gap-1.5">
              <button onClick={() => void askCompletionNotificationPermission()} className={`flex-1 ${actionButtonPrimaryClassName}`}>
                {completionNotificationPermission === "granted" ? "再查看通知权限" : "允许完成消息送达"}
              </button>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-300">
              整批完成且窗口在后台时通知。权限：{systemNotificationPermissionLabel(completionNotificationPermission)}。
            </p>
          </SettingsRow>
        </SettingsSection>

        <SettingsSection
          id="settings-appearance"
          active={activeDesktopSection === "appearance"}
          title="光影 · 外观与字号"
        >
          <SettingsRow label="界面光色">
            <div className={segmentedControlClassName}>
              <SettingsSegButton active={theme === "system"} onClick={() => setTheme("system")}>
                <Monitor className="w-3 h-3" /> 随系统
              </SettingsSegButton>
              <SettingsSegButton active={theme === "dark"} onClick={() => setTheme("dark")}>
                <Moon className="w-3 h-3" /> 夜色 · 深色
              </SettingsSegButton>
              <SettingsSegButton active={theme === "light"} onClick={() => setTheme("light")}>
                <Sun className="w-3 h-3" /> 晨光 · 浅色
              </SettingsSegButton>
            </div>
          </SettingsRow>

          <SettingsRow label={`文字尺度 · ${Math.round(fontScale * 100)}%`}>
            <div className={segmentedControlClassName}>
              {[0.85, 1, 1.15].map((v) => (
                <SettingsSegButton key={v} active={Math.abs(fontScale - v) < 0.01} onClick={() => setFontScale(v)}>
                  {v === 0.85 ? "小巧" : v === 1 ? "适中" : "舒展"}
                </SettingsSegButton>
              ))}
            </div>
          </SettingsRow>
        </SettingsSection>

        <SettingsSection
          id="settings-data"
          active={activeDesktopSection === "data"}
          title="旧页 · 数据与重置"
        >
          <SettingsRow label="创作旧页 · 历史记录">
            <div className="flex gap-1.5">
              <button onClick={exportHistory} title="将全部创作历史备份为 JSON" className={`flex-1 ${actionButtonPrimaryClassName}`}>
                <Upload className="w-3 h-3" /> 备份历史
              </button>
              <button onClick={importHistory} title="从 JSON 文件带回创作历史" className={`flex-1 ${actionButtonPrimaryClassName}`}>
                <Download className="w-3 h-3" /> 读入历史
              </button>
            </div>
          </SettingsRow>

          <SettingsRow label="明确清理 · 本地数据">
            <div className="flex gap-1.5">
              <button onClick={clearAPIKey} className={`flex-1 ${actionButtonDangerClassName}`}>
                <KeyRound className="w-3 h-3" /> 清除当前 API Key
              </button>
              <button onClick={clearHistory} className={`flex-1 ${actionButtonDangerClassName}`}>
                <Trash2 className="w-3 h-3" /> 删除全部历史
              </button>
            </div>
            <div className="mt-1.5 flex gap-1.5">
              <button onClick={() => pruneHistory(3)} className={`flex-1 ${actionButtonSecondaryClassName}`}>
                删除 3 天前历史
              </button>
              <button onClick={() => pruneHistory(7)} className={`flex-1 ${actionButtonSecondaryClassName}`}>
                删除 7 天前历史
              </button>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-300">
              仅清除当前上游的本机 API Key；历史清理会删除本地数据库记录，无法撤销。
            </p>
          </SettingsRow>
        </SettingsSection>

        <SettingsSection
          id="settings-about"
          active={activeDesktopSection === "about"}
          title="来处 · 关于与反馈"
        >
          <SettingsRow label="认识 Image Studio">
            <button onClick={() => setAboutOpen(true)} className={actionButtonSecondaryClassName}>
              <Info className="w-3 h-3" /> 翻开项目简介
            </button>
          </SettingsRow>

          <SettingsRow label="新章与回音">
            <div className="flex gap-1.5">
              <button onClick={() => openExternal(RELEASES_URL)} className={`flex-1 ${actionButtonPrimaryClassName}`}>
                <Github className="w-3 h-3" /> 看看新版本
              </button>
              <button onClick={() => openExternal(ISSUES_URL)} className={`flex-1 ${actionButtonPrimaryClassName}`}>
                <MessageSquare className="w-3 h-3" /> 留下反馈
              </button>
            </div>
          </SettingsRow>
        </SettingsSection>
      </div>
    </div>
  );

  return (
    <>
      <Modal
        open={open}
        onClose={closeSettings}
        title="创作偏好"
        width={isAndroidPad ? 1040 : (isAndroid ? 540 : 920)}
        backdropClassName={isAndroid ? "android-settings-modal-backdrop" : ""}
        cardClassName={isAndroid ? "android-settings-modal-card" : "xai-settings-panel max-w-[calc(100vw-40px)]"}
        headerClassName={isAndroid ? "android-settings-modal-header" : ""}
        bodyClassName={isAndroid ? "android-settings-modal-body" : "settings-category-body"}
      >
        {androidSettings ?? desktopSettings}
      </Modal>

      <AboutImageStudioModal
        open={aboutOpen}
        onClose={() => setAboutOpen(false)}
        onOpenFeedback={() => openExternal(REPO_URL + "/issues")}
        onOpenLicense={() => openExternal(LICENSE_URL)}
        onOpenRepo={() => openExternal(REPO_URL)}
        licenseLabel="GNU AGPL v3.0"
      />
    </>
  );
}
