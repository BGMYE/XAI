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
        <div className="android-upstream-kicker">创作源头 · Android</div>
        <h2>{activeProfile ? activeProfile.name : "尚待接入"}</h2>
        <p>
          {activeProfile
            ? `${activeProfile.apiMode === "responses" ? "Responses API" : "Images API"} · ${activeProfile.baseURL || "尚待填写地址"}`
            : "添入一条可用配置，让灵感有处成图。"}
        </p>
      </div>
      <div className="android-upstream-header-metrics" aria-label="上游连接概况">
        <span className={activeProfile?.baseURL ? "ready" : "missing"}>
          <CheckCircle2 className="h-3.5 w-3.5" />
          {activeProfile?.baseURL ? "已填地址" : "待填地址"}
        </span>
        <span>
          <ShieldCheck className="h-3.5 w-3.5" />
          {profileCount} 组
        </span>
        <button type="button" className="android-upstream-quick-import" onClick={onQuickImport}>
          <ClipboardPaste className="h-3.5 w-3.5" />
          从 JSON 带入
        </button>
      </div>
    </section>
  );
}
