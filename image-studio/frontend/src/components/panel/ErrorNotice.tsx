import { FileText, RotateCw, X } from "lucide-react";
import { OpenFile } from "../../platform/runtime/host";
import { usePlatform } from "../../platform/context";

export function ErrorNotice({
  errorMessage,
  errorRawPath,
  showRetry,
  onRetry,
  onClear,
  onPushToast,
}: {
  errorMessage: string;
  errorRawPath: string | null;
  showRetry: boolean;
  onRetry: () => void;
  onClear: () => void;
  onPushToast: (text: string, kind?: "info" | "success" | "error" | "warn", ttl?: number) => void;
}) {
  const { usesFluentUI } = usePlatform();

  return (
    <div className={`border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-700 shadow-[var(--shadow-card)] dark:text-red-200 ${usesFluentUI ? "rounded-[12px]" : "rounded-[18px]"}`}>
      <div className="flex items-start gap-2">
        <div className="flex-1 whitespace-pre-wrap leading-relaxed">{errorMessage}</div>
        <button
          onClick={onClear}
          className={`-m-1 p-1 text-red-400 hover:bg-red-500/10 hover:text-red-300 ${usesFluentUI ? "rounded-[6px]" : "rounded-full"}`}
          title="关闭"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      {showRetry || errorRawPath ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {showRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className={`platform-pill inline-flex items-center gap-1 bg-red-500/15 px-2.5 py-1 text-[11px] transition-colors hover:bg-red-500/25 ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
            >
              <RotateCw className="w-3 h-3" /> 重试上次请求
            </button>
          ) : null}
          {errorRawPath ? (
            <button
              onClick={() =>
                OpenFile(errorRawPath).catch((e: any) =>
                  onPushToast(`无法打开日志:${e?.message ?? e}`, "error")
                )
              }
              title={errorRawPath}
              className={`platform-pill inline-flex items-center gap-1 px-2.5 py-1 text-[11px] ring-1 ring-red-500/30 transition-colors hover:bg-red-500/10 ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
            >
              <FileText className="w-3 h-3" /> 查看日志
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
