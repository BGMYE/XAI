import { Github, Heart, Sparkles, Star } from "lucide-react";
import { Modal } from "./Modal";
import { OpenExternalURL } from "../../platform/runtime/host";
import { useStudioStore } from "../../state/studioStore";
import { usePlatform } from "../../platform/context";

const REPO_URL = "https://github.com/RoseKhlifa/Image-Studio";

// 首次成功生图后弹一次的「邀请 star」弹窗。只在 store.starPromptOpen=true
// 时挂载,关闭(无论哪个按钮)都会 set localStorage.gptcodex.starPrompted=1
// 防止下次再弹。UI 按 family 分:Apple 走液态玻璃 + 大圆角,
// Windows/Linux 共享 Fluent 紧凑层级,其他平台用通用中性样式。
export function StarPromptModal({ open }: { open: boolean }) {
  const dismiss = useStudioStore((s) => s.dismissStarPrompt);
  const pushToast = useStudioStore((s) => s.pushToast);
  const source = useStudioStore((s) => s.starPromptSource);
  const { usesFluentUI, usesAppleUI } = usePlatform();
  // 自动弹(用户刚完成首张图)用庆祝调,手动呼起(头部按钮)用中性致谢调 ——
  // 头部按钮可能在任何时候被点,「第一张图」这句话就不准确了。
  const title = source === "auto" ? "第一张图诞生了 🎉" : "支持一下 Image Studio";

  async function openStarPage() {
    try {
      await OpenExternalURL(REPO_URL);
      pushToast("已为你打开 GitHub 仓库,点 ★ Star 就完事啦", "success", 4500);
    } catch {
      pushToast("浏览器没拉起来,可以手动访问 github.com/RoseKhlifa/Image-Studio", "warn", 6000);
    }
    dismiss();
  }

  return (
    <Modal open={open} onClose={dismiss} width={usesFluentUI ? 440 : 460}>
      <div className="flex flex-col items-center gap-4 py-1">
        {/* 头部图标:Apple 用环形液态玻璃光晕,Fluent 用方形 Mica 卡片。 */}
        <div
          className={`relative grid place-items-center ${
            usesAppleUI
              ? "h-16 w-16 rounded-full bg-gradient-to-br from-[var(--accent)] to-[color:var(--accent-2)] shadow-[0_18px_36px_-12px_rgb(0_122_255_/_0.55)]"
              : usesFluentUI
              ? "h-14 w-14 rounded-[10px] bg-[var(--accent-soft)] ring-1 ring-[color:var(--accent)]/30"
              : "h-14 w-14 rounded-[12px] bg-[var(--accent-soft)] ring-1 ring-dashed ring-[color:var(--accent)]/40"
          }`}
        >
          <Star
            className={`${usesAppleUI ? "h-7 w-7 text-white drop-shadow" : "h-6 w-6 text-[var(--accent)]"}`}
            fill="currentColor"
            strokeWidth={1.5}
          />
          {usesAppleUI && (
            <Sparkles
              aria-hidden
              className="absolute -right-1.5 -top-1.5 h-4 w-4 text-yellow-300 drop-shadow"
              fill="currentColor"
            />
          )}
        </div>

        {/* 标题 */}
        <h3
          className={`text-center text-zinc-900 dark:text-zinc-50 ${
            usesFluentUI ? "text-[17px] font-semibold tracking-[0]" : "text-[19px] font-semibold tracking-[-0.01em]"
          }`}
          style={{ fontFamily: "var(--title-font)" }}
        >
          {title}
        </h3>

        {/* 描述 */}
        <p className="text-center text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-300">
          如果 Image Studio 帮到了你,愿意去 GitHub 给我一个 <Star className="inline-block h-3.5 w-3.5 -translate-y-px fill-yellow-400 text-yellow-400" /> Star 吗?
        </p>

        {/* 仓库信息小卡片 */}
        <div
          className={`flex w-full items-center gap-2.5 border border-black/[0.06] bg-[var(--surface)] px-3 py-2 dark:border-white/[0.06] ${
            usesAppleUI ? "liquid-glass-panel rounded-[14px]" : usesFluentUI ? "rounded-[10px]" : "rounded-[12px]"
          }`}
        >
          <Github className="h-4 w-4 shrink-0 text-zinc-700 dark:text-zinc-300" />
          <span className="flex-1 truncate text-[12px] font-mono-token text-zinc-700 dark:text-zinc-300">
            RoseKhlifa/Image-Studio
          </span>
          <Heart className="h-3 w-3 text-red-400" fill="currentColor" />
        </div>

        {/* 按钮组 */}
        <div className="mt-1 flex w-full gap-2">
          <button
            type="button"
            onClick={dismiss}
            className={`platform-action-btn flex-1 border border-black/[0.08] px-4 py-2 text-sm text-zinc-700 transition-colors hover:bg-black/[0.04] dark:border-white/[0.08] dark:text-zinc-300 dark:hover:bg-white/[0.06] ${
              usesFluentUI ? "rounded-[8px]" : "rounded-full"
            }`}
          >
            稍后再说
          </button>
          <button
            type="button"
            onClick={openStarPage}
            className={`liquid-primary-button flex-1 inline-flex items-center justify-center gap-1.5 bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--accent-2)] ${
              usesFluentUI ? "rounded-[8px]" : "rounded-full"
            }`}
          >
            <Star className="h-3.5 w-3.5" fill="currentColor" /> 去 Star ⭐
          </button>
        </div>

        {/* 平台风味的脚注:Apple 给一行手写感,Fluent 给一行紧凑提示。 */}
        {usesAppleUI && (
          <p className="text-[10.5px] italic text-zinc-400 dark:text-zinc-500">
            这个弹窗只会出现这一次,关掉就再也不会打扰你 ☘
          </p>
        )}
        {usesFluentUI && (
          <p className="text-[10.5px] text-zinc-500 dark:text-zinc-500">
            一次性提示 · 关闭后不再显示
          </p>
        )}
      </div>
    </Modal>
  );
}
