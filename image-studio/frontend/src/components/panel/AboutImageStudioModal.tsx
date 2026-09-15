import { Github, MessageSquare } from "lucide-react";
import "../../styles/_xai-typography.css";
import { Modal } from "../common/Modal";
import { androidTarget } from "../../platform/android/bridge";
import { appVersion } from "../../lib/version";
import { platformRuntimeLabel } from "../../platform";
import { usePlatform } from "../../platform/context";
import { getHostCapabilities, OpenExternalURL } from "../../platform/runtime/host";
import { SettingsFact } from "./settingsPrimitives";
import { useStudioStore } from "../../state/studioStore";
import { openExternalURLForPlatform } from "../../platform/android/bridge";

export function AboutImageStudioModal({
  licenseLabel,
  open,
  onClose,
  onOpenFeedback,
  onOpenLicense,
  onOpenRepo,
}: {
  licenseLabel: string;
  open: boolean;
  onClose: () => void;
  onOpenFeedback: () => void;
  onOpenLicense: () => void;
  onOpenRepo: () => void;
}) {
  const { usesFluentUI } = usePlatform();
  const hostCapabilities = getHostCapabilities();
  const appUpdate = useStudioStore((state) => state.appUpdate);
  const openUpdateURL = () => {
    if (!appUpdate?.releaseURL) return;
    void openExternalURLForPlatform(appUpdate.releaseURL, OpenExternalURL).catch(() => undefined);
  };

  return (
    <Modal open={open} onClose={onClose} title="来处 · Image Studio" width={460} cardClassName={androidTarget.isAndroid ? undefined : "xai-settings-panel"}>
      <div className={`text-center ${androidTarget.isAndroid ? "mb-4" : "mb-5"}`}>
        <div className={`w-14 h-14 mx-auto ${androidTarget.isAndroid ? "mb-1.5" : "mb-2"} bg-white dark:bg-zinc-100 ring-1 ring-black/15 dark:ring-white/20 flex items-center justify-center ${usesFluentUI ? "rounded-[12px]" : "rounded-2xl"}`}>
          <svg width="40" height="40" viewBox="0 0 1024 1024" fill="none" aria-hidden>
            <rect x="160" y="270" width="704" height="490" rx="56" stroke="#18181b" strokeWidth="56" />
            <path d="M 200 740 L 420 470 L 560 600 L 460 740 Z" fill="#52525b" />
            <path d="M 380 740 L 580 490 L 670 580 L 770 480 L 824 740 Z" fill="#18181b" />
            <circle cx="700" cy="420" r="55" stroke="#18181b" strokeWidth="48" />
            <polygon points="820,200 836,240 820,280 804,240" fill="#18181b" />
            <polygon points="780,240 820,224 860,240 820,256" fill="#18181b" />
          </svg>
        </div>
        <div className={`${androidTarget.isAndroid ? "text-[17px]" : "text-lg"} font-bold`}>Image Studio</div>
        <div className="text-[10px] text-zinc-500 mt-0.5">
          v{appVersion} · <span onClick={onOpenLicense} className="cursor-pointer text-[var(--accent)] hover:opacity-80">{licenseLabel}</span>
        </div>
      </div>
      {androidTarget.isAndroid ? (
        <>
          <p className="text-[11px] leading-relaxed text-zinc-700 dark:text-zinc-300">
            让灵感落成画面的一间开源工作室。历史与作品留在本机，生成所需内容会交给你选定的上游；API Key 由系统凭据存储保管。
          </p>
          <p className="mt-2 text-[10px] leading-relaxed text-zinc-500">
            Copyright © 2026 RoseKhlifa · 本程序按 GNU AGPL v3.0 发布，不提供任何担保。
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2 text-[10px]">
            <SettingsFact label="作品归处" value="保存在本机" />
            <SettingsFact label="运行所在" value="Android WebView" />
            <SettingsFact label="画面加速" value={hostCapabilities.imageTransformAcceleration} />
            <SettingsFact label="连接的接口" value="Responses / Images" />
            <SettingsFact label="版本新章" value={appUpdate?.latestVersion ? `已有新章 v${appUpdate.latestVersion}` : "暂未发现更新版本"} />
          </div>
        </>
      ) : (
        <>
          <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
            一间供灵感生长的开源图像工作室，以 Wails（Go + React/TS）连接生成与编辑。
            历史与作品安放在本机，生成所需内容会发往你选定的上游。API Key 交由系统凭据存储保管，不以明文留在 localStorage。
          </p>
          <p className="xai-license-copy mt-2 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
            Copyright © 2026 RoseKhlifa · 本程序按 GNU AGPL v3.0 发布，不提供任何担保。
          </p>
          <div className="mt-3 text-[10px] text-zinc-500 leading-relaxed space-y-0.5">
            <div><strong className="text-zinc-700 dark:text-zinc-300">构成这间工作室的技术：</strong></div>
            <div>· 后端所用：Go ≥ 1.25 / SSE</div>
            <div>· 前端所用：React 18 + TypeScript / Tailwind v4 / zustand / react-konva</div>
            <div>· 运行形态：{platformRuntimeLabel()}</div>
            <div>· 图像处理：{hostCapabilities.imageTransformAcceleration}</div>
            <div>· 版本新章：{appUpdate?.latestVersion ? `已有新章 v${appUpdate.latestVersion}` : "暂未发现更新版本"}</div>
            <div className="pt-1.5"><strong className="text-zinc-700 dark:text-zinc-300">可以连接的上游：</strong></div>
            <div>· 兼容 OpenAI <strong className="text-zinc-700 dark:text-zinc-300">Responses API</strong></div>
            <div>· 标准 <strong className="text-zinc-700 dark:text-zinc-300">Images API</strong>(generations + edits)</div>
          </div>
        </>
      )}
      <div className="mt-3.5 flex gap-2">
        <button
          type="button"
          onClick={appUpdate?.releaseURL ? openUpdateURL : onOpenRepo}
          className={`liquid-primary-button flex-1 inline-flex items-center justify-center gap-1.5 bg-[var(--accent)] px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-[var(--accent-2)] ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
        >
          <Github className="w-3.5 h-3.5" /> {appUpdate?.releaseURL ? "翻阅新版本" : "前往 GitHub"}
        </button>
        <button
          type="button"
          onClick={onOpenFeedback}
          className={`flex-1 inline-flex items-center justify-center gap-1.5 border border-black/[0.08] px-3 py-2 text-xs text-zinc-700 transition-colors hover:bg-black/[0.04] dark:border-white/[0.08] dark:text-zinc-300 dark:hover:bg-white/[0.06] ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
        >
          <MessageSquare className="w-3.5 h-3.5" /> 留下反馈
        </button>
      </div>
      <hr className="border-black/[0.06] dark:border-white/[0.04] mt-3.5 mb-2.5" />
      <div className="text-[9px] text-zinc-500 text-center leading-relaxed">
        作品留在本机 · 无遥测 · 无云端账户 · 无内购
      </div>
    </Modal>
  );
}
