import {
  DeleteStoredAPIKey,
  GetStoredAPIKey,
  SetStoredAPIKey,
} from "../platform/runtime/host";
import type { APIMode, ReasoningEffortValue, RequestPolicy, UpstreamProfile } from "../types/domain";
import type { StudioState } from "./studioStore.types";
import {
  DEFAULT_IMAGES_PROFILE,
  duplicateProfile as cloneProfile,
  genProfileId,
  keyringUserFor,
  nextDefaultProfileName,
  normalizeResponsesTransport,
  pickActiveProfile,
  pickAIProfile,
  persistAIProfileId,
} from "../lib/profiles";
import { cleanBaseURL } from "../lib/security";
import {
  clearRegistryKey,
  deleteRegistryProfile,
  duplicateRegistryProfile,
  readProfileKey,
  registryActive,
  rememberProfileUse,
  saveRegistryProfile,
} from "../lib/upstreamRegistry";
import { normalizeConcurrencyLimit } from "./workspaceRuntime";
import { persistActiveProfileId, persistProfiles } from "./studioStore.shared";

/** Reads a profile's key from the shared registry on the desktop, else from the classic keychain entry. */
export function readAPIKey(id: string): Promise<string> {
  return readProfileKey(id, (profileId) => GetStoredAPIKey(keyringUserFor(profileId)));
}

/** Saves the key of a profile; an empty key clears it. */
export async function storeAPIKey(profile: UpstreamProfile, key: string): Promise<void> {
  const trimmed = key.trim();
  if (!registryActive()) {
    await SetStoredAPIKey(keyringUserFor(profile.id), trimmed);
    return;
  }
  if (trimmed) await saveRegistryProfile(profile, trimmed);
  else await clearRegistryKey(profile.id);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type StateAdapter = {
  getState: () => StudioState;
  setState: (patch: Partial<StudioState> | ((state: StudioState) => Partial<StudioState>)) => void;
};

export function createProfileActions(store: StateAdapter) {
  return {
    async createProfile(input: {
      name?: string;
      apiMode: APIMode;
      responsesTransport?: UpstreamProfile["responsesTransport"];
      baseURL?: string;
      requestPolicy?: RequestPolicy;
      imagesNewAPICompat?: boolean;
      allowInsecureConnection?: boolean;
      textModelID?: string;
      imageModelID?: string;
      modelIDs?: string[];
      videoModelID?: string;
      reasoningEffort?: ReasoningEffortValue;
      concurrencyLimit?: number;
      apiKey?: string;
      setActive?: boolean;
    }) {
      const list = store.getState().profiles;
      const id = genProfileId();
      let profile: UpstreamProfile = {
        id,
        name: input.name?.trim() || nextDefaultProfileName(list),
        apiMode: input.apiMode,
        responsesTransport: normalizeResponsesTransport(input.apiMode === "responses" ? input.responsesTransport : "sse"),
        requestPolicy: input.requestPolicy ?? "openai",
        imagesNewAPICompat: input.imagesNewAPICompat === true,
        allowInsecureConnection: input.allowInsecureConnection === true,
        baseURL: cleanBaseURL(input.baseURL ?? (input.apiMode === "images" ? DEFAULT_IMAGES_PROFILE.baseURL : "")),
        textModelID: (input.textModelID ?? "").trim(),
        imageModelID: (input.imageModelID ?? (input.apiMode === "images" ? DEFAULT_IMAGES_PROFILE.imageModelID : "")).trim(),
        modelIDs: Array.from(new Set((input.modelIDs ?? []).map((value) => value.trim()).filter(Boolean))),
        videoModelID: (input.videoModelID ?? "").trim(),
        reasoningEffort: input.reasoningEffort ?? "xhigh",
        concurrencyLimit: normalizeConcurrencyLimit(input.concurrencyLimit ?? 0),
        fallbackProfileId: undefined,
        createdAt: Date.now(),
      };
      if (registryActive()) {
        try { profile = await saveRegistryProfile(profile, input.apiKey ?? ""); }
        catch (error) {
          store.getState().pushToast(`上游配置未保存：${errorMessage(error)}`, "error", 6000);
          return "";
        }
      } else if ((input.apiKey ?? "").trim()) {
        try { await SetStoredAPIKey(keyringUserFor(id), input.apiKey!.trim()); }
        catch {
          store.getState().pushToast("API Key 未能写入系统凭据存储，配置未保存。请使用桌面应用并检查凭据存储权限。", "error", 6000);
          return "";
        }
      }
      const next = [...list, profile];
      persistProfiles(next);
      const aiProfile = pickAIProfile(next, store.getState().aiProfileId, store.getState().activeProfileId);
      if (aiProfile?.id && aiProfile.id !== store.getState().aiProfileId) {
        persistAIProfileId(aiProfile.id);
      }
      store.setState({ profiles: next, aiProfileId: aiProfile?.id ?? "" });
      if (input.setActive ?? true) {
        await this.setActiveProfile(id);
      }
      return id;
    },

    async updateProfile(id: string, patch: Partial<Omit<UpstreamProfile, "id" | "createdAt">> & { apiKey?: string }) {
      const list = store.getState().profiles;
      const index = list.findIndex((profile) => profile.id === id);
      if (index < 0) return false;
      const current = list[index];
      let next: UpstreamProfile = {
        ...current,
        name: patch.name !== undefined ? patch.name.trim() : current.name,
        apiMode: patch.apiMode ?? current.apiMode,
        responsesTransport: patch.responsesTransport !== undefined
          ? normalizeResponsesTransport(patch.responsesTransport)
          : normalizeResponsesTransport(current.responsesTransport),
        requestPolicy: patch.requestPolicy ?? current.requestPolicy,
        imagesNewAPICompat: patch.imagesNewAPICompat ?? current.imagesNewAPICompat ?? false,
        allowInsecureConnection: patch.allowInsecureConnection ?? current.allowInsecureConnection ?? false,
        baseURL: patch.baseURL !== undefined ? cleanBaseURL(patch.baseURL) : current.baseURL,
        textModelID: patch.textModelID !== undefined ? patch.textModelID.trim() : current.textModelID,
        imageModelID: patch.imageModelID !== undefined ? patch.imageModelID.trim() : current.imageModelID,
        modelIDs: patch.modelIDs !== undefined
          ? Array.from(new Set(patch.modelIDs.map((value) => value.trim()).filter(Boolean)))
          : current.modelIDs,
        videoModelID: patch.videoModelID !== undefined ? patch.videoModelID.trim() : current.videoModelID,
        reasoningEffort: patch.reasoningEffort ?? current.reasoningEffort ?? "xhigh",
        concurrencyLimit: patch.concurrencyLimit !== undefined
          ? normalizeConcurrencyLimit(patch.concurrencyLimit) : current.concurrencyLimit,
        fallbackProfileId: patch.fallbackProfileId !== undefined ? patch.fallbackProfileId || undefined : current.fallbackProfileId,
        lastUsedAt: patch.lastUsedAt ?? current.lastUsedAt,
      };
      if (registryActive()) {
        try {
          // An empty key clears it, as in the classic keychain. Clear first, so
          // an address change in the same save is not refused for the old key.
          if (patch.apiKey !== undefined && !patch.apiKey.trim()) await clearRegistryKey(id);
          next = await saveRegistryProfile(next, patch.apiKey ?? "");
        } catch (error) {
          store.getState().pushToast(`上游配置未保存：${errorMessage(error)}`, "error", 6000);
          return false;
        }
      } else if (patch.apiKey !== undefined) {
        try { await SetStoredAPIKey(keyringUserFor(id), patch.apiKey); }
        catch {
          store.getState().pushToast("API Key 未能写入系统凭据存储，配置未保存。请使用桌面应用并检查凭据存储权限。", "error", 6000);
          return false;
        }
      }
      const nextList = list.map((profile, idx) => (idx === index ? next : profile));
      persistProfiles(nextList);
      const aiProfile = pickAIProfile(nextList, store.getState().aiProfileId, store.getState().activeProfileId);
      if ((aiProfile?.id ?? "") !== store.getState().aiProfileId) {
        persistAIProfileId(aiProfile?.id ?? "");
      }
      store.setState({ profiles: nextList, aiProfileId: aiProfile?.id ?? "" });
      if (id === store.getState().activeProfileId) {
        const apiKey = patch.apiKey !== undefined ? patch.apiKey.trim() : store.getState().apiKey;
        store.setState({
          apiMode: next.apiMode,
          responsesTransport: next.responsesTransport ?? "sse",
          requestPolicy: next.requestPolicy,
          imagesNewAPICompat: next.imagesNewAPICompat ?? false,
          baseURL: next.baseURL,
          textModelID: next.textModelID,
          imageModelID: next.imageModelID,
          reasoningEffort: next.reasoningEffort,
          apiKey,
        });
      }
      return true;
    },

    async deleteProfile(id: string) {
      const list = store.getState().profiles;
      const index = list.findIndex((profile) => profile.id === id);
      if (index < 0) return;
      const nextList = list.filter((_, i) => i !== index);
      if (registryActive()) {
        try { await deleteRegistryProfile(id); }
        catch (error) {
          store.getState().pushToast(`上游配置未删除：${errorMessage(error)}`, "error", 6000);
          return;
        }
        persistProfiles(nextList);
      } else {
        persistProfiles(nextList);
        try { await DeleteStoredAPIKey(keyringUserFor(id)); }
        catch {
          store.getState().pushToast("上游配置已删除，但系统凭据清理失败。请在系统凭据管理器中移除对应条目。", "warn", 6000);
        }
      }
      const aiProfile = pickAIProfile(nextList, store.getState().aiProfileId === id ? "" : store.getState().aiProfileId, store.getState().activeProfileId);
      persistAIProfileId(aiProfile?.id ?? "");
      store.setState({ profiles: nextList, aiProfileId: aiProfile?.id ?? "" });
      if (store.getState().activeProfileId === id) {
        const fallback = pickActiveProfile(nextList, "");
        if (fallback) {
          await this.setActiveProfile(fallback.id);
        } else {
          persistActiveProfileId("");
          store.setState({
            profiles: nextList,
            activeProfileId: "",
            apiKey: "",
            baseURL: "",
            textModelID: "",
            imageModelID: "",
            reasoningEffort: "xhigh",
            apiMode: "responses",
            responsesTransport: "sse",
            requestPolicy: "openai",
            imagesNewAPICompat: false,
            upstreamModalOpen: false,
            settingsOpen: true,
            upstreamReturnTarget: "settings",
          });
        }
      }
    },

    async duplicateProfile(id: string) {
      const current = store.getState().profiles.find((profile) => profile.id === id);
      if (!current) return null;
      if (registryActive()) {
        try {
          const copy = await duplicateRegistryProfile(id);
          const next = [...store.getState().profiles, copy];
          persistProfiles(next);
          store.setState({ profiles: next });
          return copy.id;
        } catch {
          store.getState().pushToast("系统凭据复制失败，上游配置未复制。", "error", 6000);
          return null;
        }
      }
      const cloned = cloneProfile(current);
      try {
        const existingKey = await GetStoredAPIKey(keyringUserFor(id));
        if (existingKey) {
          await SetStoredAPIKey(keyringUserFor(cloned.id), existingKey);
        }
      } catch {
        store.getState().pushToast("系统凭据复制失败，上游配置未复制。", "error", 6000);
        return null;
      }
      const next = [...store.getState().profiles, cloned];
      persistProfiles(next);
      store.setState({ profiles: next });
      return cloned.id;
    },

    async setActiveProfile(id: string) {
      const profile = store.getState().profiles.find((p) => p.id === id);
      if (!profile) return;
      persistActiveProfileId(id);
      const apiKey = await readAPIKey(id).catch(() => "");
      const refreshed: UpstreamProfile = { ...profile, lastUsedAt: Date.now() };
      if (registryActive()) rememberProfileUse(id, refreshed.lastUsedAt);
      const nextProfiles = store.getState().profiles.map((p) => p.id === id ? refreshed : p);
      persistProfiles(nextProfiles);
      store.setState({
        profiles: nextProfiles,
        activeProfileId: id,
        apiMode: profile.apiMode,
        responsesTransport: profile.responsesTransport ?? "sse",
        requestPolicy: profile.requestPolicy,
        imagesNewAPICompat: profile.imagesNewAPICompat ?? false,
        baseURL: profile.baseURL,
        textModelID: profile.textModelID,
        imageModelID: profile.imageModelID,
        reasoningEffort: profile.reasoningEffort,
        apiKey,
      });
    },

    async setAIProfile(id: string) {
      const profile = store.getState().profiles.find((item) => item.id === id);
      if (!profile || profile.apiMode !== "responses") return false;
      persistAIProfileId(id);
      store.setState({ aiProfileId: id });
      return true;
    },
  };
}
