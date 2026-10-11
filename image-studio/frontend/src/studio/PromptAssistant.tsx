import { useEffect, useId, useRef, useState } from "react";
import { Check, Loader2, Sparkles, X } from "lucide-react";
import { OptimizePrompt } from "../../wailsjs/go/backend/Service";
import { loadProxyConfig } from "../lib/proxy";
import { isDesktop } from "./client";
import type { Profile } from "./types";

export interface ConfirmedStudioPrompt {
  originalPrompt: string;
  confirmedPrompt: string;
  /** The exact text the user approved, for the later generation request. */
  prompt: string;
  promptMode: "verbatim";
}

interface PromptAssistantProps {
  profile?: Profile;
  prompt: string;
  hasReferenceImages?: boolean;
  onConfirm(value: ConfirmedStudioPrompt): void;
  onClose(): void;
}

const promptByteLimit = 16000;
const byteLength = (value: string) => new TextEncoder().encode(value).byteLength;

/** Text-only optimization followed by editable, explicit user confirmation.
 * This component never submits an image generation or reads an API key.
 */
export function PromptAssistant({ profile, prompt, hasReferenceImages = false, onConfirm, onClose }: PromptAssistantProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const titleID = useId();
  const [source] = useState(() => ({
    prompt,
    profileID: profile?.id,
    updatedAt: profile?.updatedAt,
  }));
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    mounted.current = true;
    const element = dialog.current;
    element?.showModal();
    return () => { mounted.current = false; element?.close(); };
  }, []);

  const changed = prompt !== source.prompt || profile?.id !== source.profileID || profile?.updatedAt !== source.updatedAt;
  const unavailable = !isDesktop() ? "请在桌面应用中使用提示词优化。" :
    !profile?.id || !profile.hasKey || !profile.baseUrl ? "请先保存上游地址和 API Key。" :
    profile.protocol !== "openai" ? "提示词优化需要 OpenAI 兼容上游的 Responses 文本接口。" :
    !profile.textModel?.trim() ? "请先在上游设置中填写支持 Responses 的文本模型 ID。" :
    !source.prompt.trim() ? "请先在创作表单中输入要优化的提示词。" :
    byteLength(source.prompt) > promptByteLimit ? "原始提示词超过 16000 字节，请缩短后重试。" :
    changed ? "提示词或上游配置已更改，请关闭后重新打开优化面板。" : "";
  const suggestionTooLong = suggestion !== null && byteLength(suggestion) > promptByteLimit;

  const optimize = async () => {
    if (inFlight.current || unavailable || !source.profileID) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const proxy = loadProxyConfig();
      // The existing native service resolves this saved profile's credential,
      // endpoint, model and network settings. No secret enters the WebView.
      const result = await OptimizePrompt({
        profileId: source.profileID,
        apiKey: "",
        baseURL: "",
        textModelID: "",
        prompt: source.prompt,
        mode: hasReferenceImages ? "edit" : "generate",
        proxyMode: proxy.mode,
        proxyURL: proxy.url,
        imagePaths: [],
        imagePath: "",
      });
      if (!result.trim()) throw new Error("文本模型未返回可用建议，请检查该模型的 Responses 权限。");
      if (mounted.current) setSuggestion(result);
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const confirm = () => {
    if (busy || unavailable || suggestion === null || !suggestion.trim() || suggestionTooLong) return;
    onConfirm({ originalPrompt: source.prompt, confirmedPrompt: suggestion, prompt: suggestion, promptMode: "verbatim" });
    onClose();
  };

  return (
    <dialog ref={dialog} className="studio-dialog studio-dialog--structured studio-dialog--wide" aria-labelledby={titleID}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right ||
          event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
      }}>
      <header className="studio-dialog-header">
        <h2 id={titleID}>优化并确认提示词</h2>
        <button type="button" className="studio-dialog-close" onClick={onClose} aria-label="关闭提示词优化"><X size={20} /></button>
      </header>
      <div className="studio-dialog-body">
        <p className="studio-muted">先由文本模型提出建议，再由你编辑确认。确认后回到创作表单，以「精确执行」模式使用这段文字；生成图片仍需单独点击生成。</p>
        <div className="studio-callout">
          <strong>仅优化文字 · 可能产生文本模型费用</strong>
          <p>使用已保存的上游「{profile?.name || "未选择"}」和文本模型 {profile?.textModel || "未配置"}。点击优化才发送一次文本请求。</p>
          {hasReferenceImages && <p>参考图和蒙版不会发送给文本模型。请在原始文字中写清保留区域、主体、数量和编辑限制，并结合参考图检查建议。</p>}
        </div>
        <label>原始提示词<textarea value={source.prompt} readOnly rows={4} /></label>
        <div className="studio-form-actions">
          <button type="button" className="studio-secondary" disabled={busy || Boolean(unavailable)} onClick={() => void optimize()}>
            {busy ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}
            {busy ? "正在优化文字…" : suggestion === null ? "调用文本模型优化" : "重新优化原始提示词"}
          </button>
        </div>
        {unavailable && <p className="studio-callout warning" role="status">{unavailable}</p>}
        {busy && <p className="studio-muted" role="status">正在等待文本建议。关闭面板不会取消已发送的文本请求，未确认的建议不会写入创作表单。</p>}
        {error && <p className="studio-callout warning" role="alert">优化失败：{error}</p>}
        {suggestion !== null && (
          <>
            <label>优化建议（可编辑）
              <textarea value={suggestion} rows={8} disabled={busy} onChange={(event) => setSuggestion(event.target.value)} />
            </label>
            <p className="studio-muted">请核对画面内的文字、主体、数量和编辑范围。历史会分别保存原文、你确认的文字以及实际发送的提示词。</p>
            {suggestionTooLong && <p className="studio-callout warning" role="alert">建议超过 16000 字节，请编辑缩短后确认。</p>}
          </>
        )}
      </div>
      <footer className="studio-dialog-footer">
        <button type="button" className="studio-secondary" onClick={onClose}>保留原文并关闭</button>
        <button type="button" className="studio-primary" disabled={busy || Boolean(unavailable) || suggestion === null || !suggestion.trim() || suggestionTooLong} onClick={confirm}>
          <Check size={16} />确认并返回创作
        </button>
      </footer>
    </dialog>
  );
}
