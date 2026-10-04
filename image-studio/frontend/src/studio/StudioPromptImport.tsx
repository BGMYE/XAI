import { useEffect, useRef, useState } from "react";

interface ImportPayload {
  prompt?: { zh?: string; en?: string };
  negative_prompt?: { zh?: string; en?: string };
  resolvedSize?: string;
  aspect_ratio?: string;
}
interface ImportHost {
  ImportPromptByToken(token: string): Promise<ImportPayload>;
  ActivatePromptImportListener(): Promise<{ tokens?: string[]; invalidCount?: number }>;
}
export interface ImportedStudioPrompt {
  prompt: string;
  negativePrompt: string;
  size: string;
}
function preferred(text?: { zh?: string; en?: string }): string {
  return text?.zh?.trim() || text?.en?.trim() || "";
}

/** Desktop deep links require confirmation and never submit a generation. */
export function StudioPromptImport({ onApply, report }: {
  onApply(value: ImportedStudioPrompt): void;
  report(message: string): void;
}) {
  const [payload, setPayload] = useState<ImportedStudioPrompt | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const handlers = useRef({ onApply, report });
  handlers.current = { onApply, report };
  const next = useRef<() => void>(() => undefined);
  const close = () => { setPayload(null); next.current(); };

  useEffect(() => {
    const w = window as unknown as {
      go?: { backend?: { Service?: ImportHost } };
      runtime?: { EventsOnMultiple(name: string, callback: (...args: unknown[]) => void, max: number): () => void };
    };
    const host = w.go?.backend?.Service;
    const runtime = w.runtime;
    if (!host?.ImportPromptByToken || !host.ActivatePromptImportListener || !runtime?.EventsOnMultiple) return;
    const queue: string[] = [];
    let stopped = false, busy = false;
    const invalid = () => handlers.current.report("提示词链接无效或已过期，请回来源页面重新发送。");
    const pump = async () => {
      if (busy || stopped) return;
      const token = queue.shift();
      if (!token) return;
      busy = true;
      try {
        const data = await host.ImportPromptByToken(token);
        const prompt = preferred(data.prompt);
        if (!prompt) throw Error("TOKEN_INVALID");
        if (stopped) return;
        const candidate = data.resolvedSize?.trim() || "auto";
        setPayload({ prompt, negativePrompt: preferred(data.negative_prompt),
          size: /^(auto|[1-9]\d{1,4}x[1-9]\d{1,4})$/.test(candidate) ? candidate : "auto" });
      } catch (error) {
        if (stopped) return;
        const message = String(error);
        handlers.current.report(message.includes("TOKEN_USED") ? "这个提示词链接已经使用过了。" :
          /TOKEN_(INVALID|EXPIRED|NOT_FOUND)/.test(message) ? "提示词链接无效或已过期，请重新发送。" : "提示词导入服务暂不可用。");
        busy = false;
        void pump();
      }
    };
    next.current = () => { busy = false; void pump(); };
    const enqueue = (value: unknown) => {
      if (typeof value !== "string" || !value.trim()) { invalid(); return; }
      if (!queue.includes(value.trim())) queue.push(value.trim());
      void pump();
    };
    const offToken = runtime.EventsOnMultiple("studio-import-token", enqueue, -1);
    const offInvalid = runtime.EventsOnMultiple("studio-import-token-invalid", invalid, -1);
    // StrictMode's probe mount must not consume the native pending-token queue.
    void Promise.resolve().then(() => stopped ? null : host.ActivatePromptImportListener()).then((result) => {
      if (stopped || !result) return;
      if (result.invalidCount) invalid();
      for (const token of result.tokens ?? []) enqueue(token);
    }).catch(() => { if (!stopped) handlers.current.report("提示词链接监听暂不可用。"); });
    return () => { stopped = true; offToken(); offInvalid(); next.current = () => undefined; };
  }, []);

  useEffect(() => {
    if (payload) dialog.current?.showModal();
    return () => dialog.current?.close();
  }, [payload]);
  if (!payload) return null;
  return <dialog ref={dialog} className="studio-dialog" onCancel={(event) => { event.preventDefault(); close(); }}>
    <header><h2>导入提示词</h2><button type="button" onClick={close} aria-label="关闭">×</button></header>
    <p>来源：Image-Prompts。确认后替换创作表单的提示词、反向提示词与尺寸，再由你检查并点击生成。</p>
    <label>提示词<textarea readOnly rows={7} value={payload.prompt} /></label>
    {payload.negativePrompt && <label>反向提示词<textarea readOnly rows={3} value={payload.negativePrompt} /></label>}
    <p>尺寸：{payload.size}。反向提示词仅在上游明确支持且开启中转扩展时发送。</p>
    <footer><button type="button" onClick={close}>取消</button>
      <button type="button" className="studio-primary" onClick={() => { handlers.current.onApply(payload); close(); }}>导入到创作表单</button></footer>
  </dialog>;
}
