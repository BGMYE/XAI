import { useEffect, useState } from "react";
import { Copy } from "lucide-react";
import { Modal } from "../common/Modal";
import { ReadTextFile } from "../../platform/runtime/host";
import { useStudioStore } from "../../state/studioStore";
import { usePlatform } from "../../platform/context";

const MAX_PREVIEW = 200_000; // chars

export function RawResponseModal({ path, onClose }: { path: string; onClose: () => void }) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pushToast = useStudioStore((s) => s.pushToast);
  const { usesFluentUI } = usePlatform();

  useEffect(() => {
    setLoading(true);
    ReadTextFile(path)
      .then((t) => {
        if (t.length > MAX_PREVIEW) {
          setText(t.slice(0, MAX_PREVIEW) + `\n\n... [截断,完整 ${(t.length / 1024).toFixed(1)} KB 在文件里]`);
        } else setText(t);
      })
      .catch((e: any) => setError(e?.message ?? String(e)))
      .finally(() => setLoading(false));
  }, [path]);

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(text);
      pushToast("已复制到剪贴板", "success");
    } catch (e: any) {
      pushToast(`复制失败:${e?.message ?? e}`, "error");
    }
  }

  return (
    <Modal open onClose={onClose} title="原始上游响应" width={760}>
      <div className="flex justify-between items-center mb-2 text-[11px] text-zinc-500 gap-2">
        <code className="font-mono-token break-all text-zinc-600 dark:text-zinc-400">{path}</code>
        <button
          onClick={copyAll}
          className={`inline-flex shrink-0 items-center gap-1 border border-black/[0.08] px-2.5 py-1.5 text-xs text-zinc-700 transition-colors hover:border-[color:var(--accent)]/35 hover:text-[var(--accent)] dark:border-white/[0.08] dark:text-zinc-300 ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
        >
          <Copy className="w-3 h-3" /> 复制全文
        </button>
      </div>
      {loading && <div className="text-zinc-500 p-3 text-sm">读取中...</div>}
      {error && (
        <div className={`border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-400 ${usesFluentUI ? "rounded-[10px]" : "rounded-[16px]"}`}>{error}</div>
      )}
      {!loading && !error && (
        <pre className={`font-mono-token max-h-[55vh] overflow-auto whitespace-pre-wrap break-all border border-black/[0.08] bg-[var(--surface)] p-3 text-[11px] leading-relaxed text-zinc-600 dark:border-white/[0.06] dark:text-zinc-400 ${usesFluentUI ? "rounded-[10px]" : "rounded-[16px]"}`}>
          {text}
        </pre>
      )}
    </Modal>
  );
}
