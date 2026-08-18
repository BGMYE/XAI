import { useEffect, useMemo, useState } from "react";
import { Edit3, Plus, Save, Trash2 } from "lucide-react";
import { Modal } from "../common/Modal";
import { useStudioStore } from "../../state/studioStore";
import {
  NEW_PROMPT_TEMPLATE_ID,
  nextDefaultPromptTemplateLabel,
  resolvePromptTemplateManagerSelection,
} from "../../lib/promptTemplates";
import { usePlatform } from "../../platform/context";
import { OpenExternalURL } from "../../platform/runtime/host";
import { openExternalURLForPlatform } from "../../platform/android/bridge";

const PROMPT_WEBSITE_URL = "https://prompts.sorry.ink/";

export function PromptTemplateManagerModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const {
    prompt,
    promptTemplates,
    addPromptTemplate,
    updatePromptTemplate,
    deletePromptTemplate,
    pushToast,
  } = useStudioStore();
  const { usesFluentUI, isAndroidPhone } = usePlatform();
  const [selectedId, setSelectedId] = useState("");
  const [draftLabel, setDraftLabel] = useState("");
  const [draftText, setDraftText] = useState("");

  const selection = useMemo(
    () => resolvePromptTemplateManagerSelection(promptTemplates, selectedId),
    [promptTemplates, selectedId],
  );
  const selectedTemplate = selection.mode === "selected" ? selection.template : null;

  function openPromptWebsite() {
    void openExternalURLForPlatform(PROMPT_WEBSITE_URL, OpenExternalURL).catch(() => {
      pushToast("无法打开提示词网站", "error");
    });
  }

  useEffect(() => {
    if (!open) return;
    if (selection.selectedId !== selectedId) {
      setSelectedId(selection.selectedId);
    }
    if (!selection.initializeDraft) return;
    if (selection.mode === "selected") {
      setDraftLabel(selection.template.label);
      setDraftText(selection.template.text);
      return;
    }
    setDraftLabel(nextDefaultPromptTemplateLabel(promptTemplates));
    setDraftText("");
  }, [open, promptTemplates, selectedId, selection]);

  function startCreate(fromCurrentPrompt: boolean) {
    setSelectedId(NEW_PROMPT_TEMPLATE_ID);
    setDraftLabel(nextDefaultPromptTemplateLabel(promptTemplates));
    setDraftText(fromCurrentPrompt ? prompt.trim() : "");
  }

  function saveTemplate() {
    if (selectedTemplate) {
      const ok = updatePromptTemplate(selectedTemplate.id, { label: draftLabel, text: draftText });
      if (!ok) {
        pushToast("模板标题和内容不能为空", "warn");
        return;
      }
      pushToast(`已更新模板「${draftLabel.trim()}」`, "success");
      return;
    }
    const id = addPromptTemplate(draftLabel, draftText);
    if (!id) {
      pushToast("模板标题和内容不能为空", "warn");
      return;
    }
    setSelectedId(id);
    pushToast(`已保存模板「${draftLabel.trim()}」`, "success");
  }

  function deleteCurrentTemplate() {
    if (!selectedTemplate) return;
    if (!window.confirm(`确定删除模板「${selectedTemplate.label}」吗?`)) return;
    deletePromptTemplate(selectedTemplate.id);
    pushToast(`已删除模板「${selectedTemplate.label}」`, "success");
    const remaining = promptTemplates.filter((item) => item.id !== selectedTemplate.id);
    if (remaining[0]) {
      setSelectedId(remaining[0].id);
      setDraftLabel(remaining[0].label);
      setDraftText(remaining[0].text);
    } else {
      startCreate(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="自定义提示词模板" width={isAndroidPhone ? 720 : 860}>
      <div className="flex flex-col gap-4">
        <div className={`rounded-[14px] border border-[color:var(--accent)]/16 bg-[var(--accent-soft)] px-3.5 py-2.5 text-[12px] leading-6 text-zinc-600 dark:text-zinc-300 ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}>
          可以去
          {" "}
          <a
            href={PROMPT_WEBSITE_URL}
            onClick={(event) => {
              event.preventDefault();
              openPromptWebsite();
            }}
            className="font-medium text-[var(--accent)] underline decoration-[color:var(--accent)]/45 underline-offset-2 hover:opacity-80"
          >
            prompts.sorry.ink
          </a>
          {" "}
          查找提示词，并通过网页一键导入到本软件。
        </div>

        <div className={`grid gap-4 ${isAndroidPhone ? "grid-cols-1" : "grid-cols-[260px_minmax(0,1fr)]"}`}>
        <section className={`platform-card border border-black/[0.08] bg-[var(--surface)] p-3 dark:border-white/[0.08] ${usesFluentUI ? "rounded-[12px]" : "rounded-[18px]"}`}>
          <div className="mb-3 flex gap-2">
            <button
              type="button"
              onClick={() => startCreate(false)}
              className={`platform-pill inline-flex flex-1 items-center justify-center gap-1.5 border border-black/[0.08] px-3 py-2 text-[12px] text-zinc-700 transition-colors hover:border-[color:var(--accent)]/35 hover:text-[var(--accent)] dark:border-white/[0.08] dark:text-zinc-300 ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
            >
              <Plus className="h-3.5 w-3.5" /> 新建
            </button>
            <button
              type="button"
              onClick={() => startCreate(true)}
              disabled={!prompt.trim()}
              className={`platform-pill inline-flex flex-1 items-center justify-center gap-1.5 border border-black/[0.08] px-3 py-2 text-[12px] text-zinc-700 transition-colors hover:border-[color:var(--accent)]/35 hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/[0.08] dark:text-zinc-300 ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
            >
              <Edit3 className="h-3.5 w-3.5" /> 保存当前
            </button>
          </div>
          <div className="flex max-h-[380px] flex-col gap-2 overflow-y-auto">
            {promptTemplates.length === 0 ? (
              <div className={`border border-dashed border-black/[0.08] px-4 py-8 text-center text-[12px] text-zinc-500 dark:border-white/[0.08] dark:text-zinc-300 ${usesFluentUI ? "rounded-[10px]" : "rounded-[16px]"}`}>
                还没有自定义模板
              </div>
            ) : (
              promptTemplates.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  className={`w-full border px-3 py-2 text-left transition-colors ${
                    selectedId === item.id
                      ? "border-[color:var(--accent)]/35 bg-[var(--accent-soft)] text-[var(--accent)]"
                      : "border-black/[0.08] text-zinc-700 hover:border-[color:var(--accent)]/30 hover:text-[var(--accent)] dark:border-white/[0.08] dark:text-zinc-300"
                  } ${usesFluentUI ? "rounded-[10px]" : "rounded-[16px]"}`}
                >
                  <div className="text-[12px] font-semibold">{item.label}</div>
                  <div className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">{item.text}</div>
                </button>
              ))
            )}
          </div>
        </section>

        <section className={`platform-card border border-black/[0.08] bg-[var(--surface)] p-4 dark:border-white/[0.08] ${usesFluentUI ? "rounded-[12px]" : "rounded-[18px]"}`}>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">
            {selectedTemplate ? "编辑模板" : "新建模板"}
          </div>
          <div className="mb-3">
            <input
              value={draftLabel}
              onChange={(e) => setDraftLabel(e.target.value)}
              placeholder="模板标题"
              className={`focus-ring w-full border border-black/[0.08] bg-[var(--surface)] px-3 py-2 text-[14px] text-zinc-900 dark:border-white/[0.08] dark:text-zinc-100 ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}
            />
          </div>
          <textarea
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            placeholder="输入模板内容"
            className={`focus-ring min-h-[280px] w-full resize-y border border-black/[0.08] bg-[var(--surface)] px-3 py-3 text-[14px] leading-[1.65] text-zinc-900 dark:border-white/[0.08] dark:text-zinc-100 ${usesFluentUI ? "rounded-[10px]" : "rounded-[14px]"}`}
          />
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={saveTemplate}
              className={`platform-pill inline-flex flex-1 items-center justify-center gap-1.5 border border-[color:var(--accent)]/25 bg-[var(--accent-soft)] px-3 py-2 text-[12px] font-medium text-[var(--accent)] ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
            >
              <Save className="h-3.5 w-3.5" /> 保存模板
            </button>
            <button
              type="button"
              onClick={deleteCurrentTemplate}
              disabled={!selectedTemplate}
              className={`platform-pill inline-flex items-center justify-center gap-1.5 border border-black/[0.08] px-3 py-2 text-[12px] text-zinc-500 transition-colors hover:border-red-400/40 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/[0.08] dark:text-zinc-300 ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
            >
              <Trash2 className="h-3.5 w-3.5" /> 删除
            </button>
          </div>
        </section>
        </div>
      </div>
    </Modal>
  );
}
