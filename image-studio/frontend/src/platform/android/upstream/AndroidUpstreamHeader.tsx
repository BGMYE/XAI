import { CheckCircle2, ClipboardPaste, PlugZap, ShieldCheck } from "lucide-react";
import type { UpstreamProfile } from "../../../types/domain";

export function AndroidUpstreamHeader({
  activeProfile,
  profileCount,
  onQuickImport,
}: {
  activeProfile: UpstreamProfile | null;
  profileCount: number;
  onQuickImport: () => void;
}) {
  return (
    <section className="android-upstream-header">
      <div className="android-upstream-header-icon">
        <PlugZap className="h-5 w-5" />
      </div>
      <div className="android-upstream-header-copy">
        <div className="android-upstream-kicker">Android 上游</div>
        <h2>{activeProfile ? activeProfile.name : "未配置"}</h2>
        <p>
          {activeProfile
            ? `${activeProfile.apiMode === "responses" ? "Responses API" : "Images API"} · ${activeProfile.baseURL || "未填写地址"}`
            : "先添加一个可用配置。"}
        </p>
      </div>
      <div className="android-upstream-header-metrics" aria-label="上游状态">
        <span className={activeProfile?.baseURL ? "ready" : "missing"}>
          <CheckCircle2 className="h-3.5 w-3.5" />
          {activeProfile?.baseURL ? "可用" : "待配置"}
        </span>
        <span>
          <ShieldCheck className="h-3.5 w-3.5" />
          {profileCount} 组
        </span>
        <button type="button" className="android-upstream-quick-import" onClick={onQuickImport}>
          <ClipboardPaste className="h-3.5 w-3.5" />
          快捷导入
        </button>
      </div>
    </section>
  );
}
