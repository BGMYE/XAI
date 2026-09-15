import { useEffect, useMemo, useState } from "react";
import { GetStoredAPIKey, probeCurrentUpstream } from "../../runtime/host";
import { keyringUserFor } from "../../../lib/profiles";
import { useStudioStore } from "../../../state/studioStore";
import type { APIMode, ReasoningEffortValue, RequestPolicy, UpstreamProfile } from "../../../types/domain";
import { buildUpstreamModelCatalog, type UpstreamModelCatalog } from "../../../lib/upstreamModels";
import {
  applyParsedUpstreamConfigImport,
  parseUpstreamConfigImportFile,
} from "../../../lib/upstreamConfigTransfer";

export const ANDROID_API_MODE_OPTIONS: Array<{
  id: APIMode;
  title: string;
  meta: string;
}> = [
  { id: "images", title: "Images", meta: "沿用标准图像接口" },
  { id: "responses", title: "Responses", meta: "以 SSE 保活长任务" },
];

export const ANDROID_REQUEST_POLICY_OPTIONS: Array<{
  id: RequestPolicy;
  title: string;
  meta: string;
}> = [
  { id: "openai", title: "OpenAI 标准", meta: "仅携带公开字段" },
  { id: "compat", title: "兼容中转", meta: "添上 relay 扩展字段" },
];

export const ANDROID_REASONING_EFFORT_OPTIONS: Array<{
  id: ReasoningEffortValue;
  title: string;
  meta: string;
}> = [
  { id: "xhigh", title: "xhigh", meta: "初始选择，兼容性稳妥" },
  { id: "high", title: "high", meta: "深入思考" },
  { id: "medium", title: "medium", meta: "适中思考" },
  { id: "low", title: "low", meta: "较轻思考，可能无法调用工具" },
];

export function useAndroidUpstreamConfig(open: boolean) {
  const {
    profiles,
    activeProfileId,
    createProfile,
    updateProfile,
    deleteProfile,
    duplicateProfile,
    setActiveProfile,
    testAPIKey,
    isTestingKey,
    pushToast,
  } = useStudioStore();

  const [selectedId, setSelectedId] = useState(activeProfileId);
  const [draft, setDraft] = useState<UpstreamProfile | null>(null);
  const [draftKey, setDraftKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [savedKeyLoaded, setSavedKeyLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [quickImportOpen, setQuickImportOpen] = useState(false);
  const [quickImportText, setQuickImportText] = useState("");
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelCatalog, setModelCatalog] = useState<UpstreamModelCatalog | null>(null);
  const [modelCatalogError, setModelCatalogError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const nextSelectedId = selectedId && profiles.some((profile) => profile.id === selectedId)
      ? selectedId
      : activeProfileId || profiles[0]?.id || "";

    if (nextSelectedId !== selectedId) {
      setSelectedId(nextSelectedId);
      return;
    }

    const selected = profiles.find((profile) => profile.id === nextSelectedId) ?? null;
    setDraft(selected ? { ...selected } : null);
    setDraftKey("");
    setShowKey(false);
    setQuickImportOpen(false);
    setQuickImportText("");
    setSavedKeyLoaded(false);
    setLoadingModels(false);
    setModelCatalog(null);
    setModelCatalogError(null);

    if (!selected) {
      setSavedKeyLoaded(true);
      return;
    }

    let cancelled = false;
    GetStoredAPIKey(keyringUserFor(selected.id))
      .then((key) => {
        if (cancelled) return;
        setDraftKey(key ?? "");
        setSavedKeyLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setSavedKeyLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [activeProfileId, open, profiles, selectedId]);

  const activeProfile = useMemo(
    () => profiles.find((profile) => profile.id === activeProfileId) ?? null,
    [activeProfileId, profiles],
  );

  const baseURLError = useMemo(() => null, [draft]);

  const canSave = !!draft
    && !!draft.name.trim()
    && !!draft.baseURL.trim()
    && !!draftKey.trim()
    && savedKeyLoaded
    && !saving;

  function patchDraft(patch: Partial<UpstreamProfile>) {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  }

  async function handleNew(apiMode: APIMode = "images") {
    const id = await createProfile({
      apiMode,
      requestPolicy: "openai",
      setActive: profiles.length === 0,
    });
    if (id) setSelectedId(id);
  }

  async function handleDuplicate() {
    if (!selectedId) return;
    const id = await duplicateProfile(selectedId);
    if (id) {
      setSelectedId(id);
      pushToast("已为这处上游留下一份副本", "success");
    }
  }

  async function handleDelete() {
    if (!draft) return;
    if (!window.confirm(`要删除「${draft.name}」吗？这条配置及其 API Key 凭据会一并清除，删除后无法恢复。`)) return;
    await deleteProfile(draft.id);
    const remaining = useStudioStore.getState().profiles;
    setSelectedId(remaining[0]?.id ?? "");
    pushToast("上游配置及其 API Key 凭据已删除", "success");
  }

  async function handleSave() {
    if (!draft || !canSave) return false;
    setSaving(true);
    try {
      const ok = await updateProfile(draft.id, {
        name: draft.name,
        apiMode: draft.apiMode,
        responsesTransport: draft.responsesTransport ?? "sse",
        requestPolicy: draft.requestPolicy,
        imagesNewAPICompat: draft.imagesNewAPICompat === true,
        allowInsecureConnection: draft.allowInsecureConnection === true,
        baseURL: draft.baseURL,
        textModelID: draft.textModelID,
        imageModelID: draft.imageModelID,
        videoModelID: draft.videoModelID,
        reasoningEffort: draft.reasoningEffort,
        concurrencyLimit: draft.concurrencyLimit,
        apiKey: draftKey.trim(),
      });
      if (ok) pushToast("这处上游的配置已保存", "success");
      return ok;
    } finally {
      setSaving(false);
    }
  }

  async function handleSetActive() {
    if (!draft) return;
    await setActiveProfile(draft.id);
    pushToast("已将生图交给选定的上游", "success");
  }

  async function handleSaveAndSetActive(onSaved?: () => void) {
    if (!draft) return;
    const draftId = draft.id;
    const saved = await handleSave();
    if (saved && draftId !== activeProfileId) {
      await setActiveProfile(draftId);
    }
    if (saved) onSaved?.();
  }

  async function handleSaveAndTest(onSaved?: () => void) {
    const saved = await handleSave();
    if (!saved || !draft) return;
    if (draft.id !== useStudioStore.getState().activeProfileId) {
      await setActiveProfile(draft.id);
    }
    onSaved?.();
    setTimeout(() => { void testAPIKey(); }, 0);
  }

  async function handleLoadModels() {
    if (!draft) return;
    const apiKey = draftKey.trim();
    const baseURL = draft.baseURL.trim();
    if (!apiKey) {
      pushToast("请先添入 API Key，让请求有凭可行", "warn");
      return;
    }
    if (!baseURL) {
      pushToast("请先写下上游 BASE_URL，确定请求的去处", "warn");
      return;
    }
    setLoadingModels(true);
    setModelCatalogError(null);
    try {
      const state = useStudioStore.getState();
      const result = await probeCurrentUpstream(
        baseURL,
        apiKey,
        state.proxyMode,
        state.proxyURL,
        draft.apiMode,
        draft.responsesTransport ?? "sse",
        draft.allowInsecureConnection === true,
      );
      const catalog = buildUpstreamModelCatalog(result.models ?? []);
      setModelCatalog(catalog);
      if (result.responsesTransport === "websocket" && result.responsesTransportOK === false) {
        pushToast(
          `模型目录已取回，但 Responses WebSocket 暂不可用：${result.responsesTransportError || "上游未说明原因"}`,
          "warn",
          7000,
        );
      } else {
        pushToast(
          result.responsesTransport === "websocket"
            ? `已收录 ${catalog.all.length} 个模型，Responses WebSocket 已连通`
            : catalog.all.length > 0
              ? `已收录 ${catalog.all.length} 个模型`
              : `已抵达上游并取回 ${result.modelCount} 个条目，但其中没有可识别的模型 ID`,
          catalog.all.length > 0 ? "success" : "warn",
        );
      }
    } catch (error: any) {
      const message = `模型目录未能取回：${error?.message ?? error}`;
      setModelCatalogError(message);
      pushToast(message, "error", 6000);
    } finally {
      setLoadingModels(false);
    }
  }

  async function handleImportFromRawJSON(raw: string, successPrefix = "已读入") {
    const parsed = parseUpstreamConfigImportFile(raw);
    const result = await applyParsedUpstreamConfigImport(parsed, {
      getProfiles: () => useStudioStore.getState().profiles,
      createProfile,
      updateProfile,
      setActiveProfile,
    });
    const targetId = result.activeProfileId || result.importedProfileIds[0] || selectedId;
    const selectedProfile = useStudioStore.getState().profiles.find((profile) => profile.id === targetId)
      ?? useStudioStore.getState().profiles[0]
      ?? null;
    if (selectedProfile) {
      setSelectedId(selectedProfile.id);
      setDraft(selectedProfile);
      setDraftKey(await GetStoredAPIKey(keyringUserFor(selectedProfile.id)).catch(() => ""));
      setSavedKeyLoaded(true);
    }
    pushToast(`${successPrefix} ${result.importedCount} 组上游配置记录`, "success");
  }

  async function handleQuickImport() {
    const raw = quickImportText.trim();
    if (!raw) {
      pushToast("请先贴入一份 JSON 配置模板", "warn");
      return;
    }
    try {
      await handleImportFromRawJSON(raw, "已从 JSON 读入");
      setQuickImportOpen(false);
      setQuickImportText("");
    } catch (error: any) {
      pushToast(`这份配置未能读入：${error?.message ?? error}`, "error", 6000);
    }
  }

  return {
    activeProfile,
    activeProfileId,
    baseURLError,
    canSave,
    draft,
    draftKey,
    handleDelete,
    handleDuplicate,
    handleQuickImport,
    handleNew,
    handleSave,
    handleSaveAndSetActive,
    handleSaveAndTest,
    handleSetActive,
    isTestingKey,
    loadingModels,
    modelCatalog,
    modelCatalogError,
    patchDraft,
    profiles,
    quickImportOpen,
    quickImportText,
    savedKeyLoaded,
    saving,
    selectedId,
    setDraftKey,
    handleLoadModels,
    setQuickImportOpen,
    setQuickImportText,
    setSelectedId,
    setShowKey,
    showKey,
  };
}
