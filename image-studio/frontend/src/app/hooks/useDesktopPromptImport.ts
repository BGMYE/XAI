import { useEffect, useRef, useState } from "react";
import {
  ActivatePromptImportListener,
  EventsOn,
  ImportPromptByToken,
  canImportPromptByToken,
} from "../../platform/runtime/host";
import type { PromptImportPayloadLike } from "../../platform/runtime/hostTypes";
import { useStudioStore } from "../../state/studioStore";
import { saveActiveWorkspaceSnapshot } from "../../state/studioStore.runtime";
import { normalizeSizeSelection } from "../../components/panel/sizeCapabilities";
import type { SizeValue } from "../../types/domain";

const promptImportEventName = "studio-import-token";
const promptImportInvalidEventName = "studio-import-token-invalid";

export type PromptImportDialogState = {
  open: boolean;
  loading: boolean;
  token: string;
  payload: PromptImportPayloadLike | null;
  resolvedSize: SizeValue;
  close: () => void;
  confirm: () => void;
};

type DialogState = {
  open: boolean;
  loading: boolean;
  token: string;
  payload: PromptImportPayloadLike | null;
  resolvedSize: SizeValue;
};

const emptyDialogState: DialogState = {
  open: false,
  loading: false,
  token: "",
  payload: null,
  resolvedSize: "auto",
};

function preferredText(text?: { zh?: string; en?: string } | null): string {
  if (!text) return "";
  const zh = text.zh?.trim() || "";
  if (zh) return zh;
  return text.en?.trim() || "";
}

function normalizePromptImportPayload(raw: PromptImportPayloadLike | null | undefined): PromptImportPayloadLike | null {
  if (!raw?.prompt) return null;
  return {
    prompt: {
      zh: raw.prompt.zh?.trim() || "",
      en: raw.prompt.en?.trim() || "",
    },
    negative_prompt: raw.negative_prompt
      ? {
          zh: raw.negative_prompt.zh?.trim() || "",
          en: raw.negative_prompt.en?.trim() || "",
        }
      : undefined,
    aspect_ratio: raw.aspect_ratio?.trim() || "",
    resolvedSize: raw.resolvedSize?.trim() || "",
  };
}

function promptImportErrorMessage(error: unknown): string {
  const raw = String((error as any)?.message || error || "").trim();
  if (raw.includes("TOKEN_USED")) return "这个提示词已经导入过了";
  if (raw.includes("TOKEN_EXPIRED")) return "导入链接已过期，请回网页重新发送";
  if (raw.includes("TOKEN_NOT_FOUND") || raw.includes("TOKEN_INVALID")) {
    return "提示词链接无效或已被清理，请回网页重新发送";
  }
  return "导入服务暂时不可用";
}

function toastInvalidToken() {
  useStudioStore.getState().pushToast("提示词链接无效或已被清理，请回网页重新发送", "error", 5000);
}

function applyPromptImportPayload(payload: PromptImportPayloadLike, resolvedSize: SizeValue) {
  const prompt = preferredText(payload.prompt);
  const negativePrompt = preferredText(payload.negative_prompt);
  useStudioStore.setState((state) => {
    const nextState = {
      ...state,
      prompt,
      negativePrompt,
      size: resolvedSize,
    };
    return {
      prompt,
      negativePrompt,
      size: resolvedSize,
      workspaces: saveActiveWorkspaceSnapshot(nextState),
    };
  });
  useStudioStore.getState().pushToast("已从 Image-Prompts 导入提示词", "success");
}

export function useDesktopPromptImport(): PromptImportDialogState {
  const [dialog, setDialog] = useState<DialogState>(emptyDialogState);
  const queueRef = useRef<string[]>([]);
  const busyRef = useRef(false);
  const openRef = useRef(false);
  const activePayloadRef = useRef<PromptImportPayloadLike | null>(null);
  const activeSizeRef = useRef<SizeValue>("auto");
  const pumpRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    openRef.current = dialog.open;
    activePayloadRef.current = dialog.payload;
    activeSizeRef.current = dialog.resolvedSize;
  }, [dialog.open, dialog.payload, dialog.resolvedSize]);

  useEffect(() => {
    if (!canImportPromptByToken()) {
      return;
    }

    let cancelled = false;

    const drainQueue = async () => {
      if (cancelled || busyRef.current || openRef.current) return;
      const token = queueRef.current.shift();
      if (!token) return;
      busyRef.current = true;
      setDialog((current) => ({ ...current, loading: true, token }));
      try {
        const payload = normalizePromptImportPayload(await ImportPromptByToken(token));
        if (!payload) {
          throw new Error("TOKEN_INVALID");
        }
        const state = useStudioStore.getState();
        const resolvedSize = normalizeSizeSelection(
          (payload.resolvedSize || "auto") as SizeValue,
          {
            apiMode: state.apiMode,
            requestPolicy: state.requestPolicy,
            imageModelID: state.imageModelID,
          },
          state.customAspectRatios,
        );
        if (cancelled) return;
        openRef.current = true;
        setDialog({
          open: true,
          loading: false,
          token,
          payload,
          resolvedSize,
        });
      } catch (error) {
        if (!cancelled) {
          useStudioStore.getState().pushToast(promptImportErrorMessage(error), "error", 5000);
          setDialog(emptyDialogState);
        }
      } finally {
        busyRef.current = false;
        if (!cancelled && !openRef.current) {
          void drainQueue();
        }
      }
    };
    pumpRef.current = () => {
      void drainQueue();
    };

    const enqueue = (token: unknown) => {
      if (typeof token !== "string" || !token.trim()) {
        toastInvalidToken();
        return;
      }
      queueRef.current.push(token.trim());
      void drainQueue();
    };

    const offToken = EventsOn(promptImportEventName, (token: string) => {
      enqueue(token);
    });
    const offInvalid = EventsOn(promptImportInvalidEventName, () => {
      toastInvalidToken();
    });

    void ActivatePromptImportListener().then((activation) => {
      if (cancelled) return;
      const invalidCount = Math.max(0, Number(activation?.invalidCount || 0));
      for (let i = 0; i < invalidCount; i += 1) {
        toastInvalidToken();
      }
      for (const token of activation?.tokens ?? []) {
        enqueue(token);
      }
    }).catch(() => undefined);

    return () => {
      cancelled = true;
      offToken();
      offInvalid();
    };
  }, []);

  const close = () => {
    openRef.current = false;
    setDialog(emptyDialogState);
    pumpRef.current();
  };

  const confirm = () => {
    const payload = activePayloadRef.current;
    if (!payload) {
      openRef.current = false;
      setDialog(emptyDialogState);
      return;
    }
    applyPromptImportPayload(payload, activeSizeRef.current);
    openRef.current = false;
    setDialog(emptyDialogState);
    pumpRef.current();
  };

  return {
    ...dialog,
    close,
    confirm,
  };
}
