import { useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { client, isDesktop } from "./client";
import type { DLSS5Probe } from "./types";
const stateText = {
  ready: ["内置引擎已就绪", "视频增强在这台设备上完成，原视频会保留。"],
  missing_runtime: ["当前安装包缺少增强组件", "请重新安装或完整解压配套的 XAI Windows 版本，再重新检测。"],
  unsupported_platform: ["当前设备暂不支持视频增强", "此功能需要受支持的 Windows 系统和兼容显卡。其他创作功能仍可正常使用。"],
  incompatible_runtime: ["增强组件与当前设备不兼容", "请使用与当前 XAI 版本配套的完整安装包，并检查显卡驱动是否满足要求。"],
  error: ["暂时无法启动视频增强", "请重新检测；若仍失败，可查看下方检测详情定位原因。"],
} as const;
/** The packaged engine is discovered automatically. No user-supplied paths. */
export function DLSS5EngineSettings({ onProbe }: { onProbe(probe: DLSS5Probe): void }) {
  const desktop = isDesktop();
  const [busy, setBusy] = useState(desktop), [probe, setProbe] = useState<DLSS5Probe>({ available: false });
  const callback = useRef(onProbe), mounted = useRef(true), operation = useRef(0), locked = useRef(false);
  callback.current = onProbe;
  const publish = (value: DLSS5Probe) => { if (mounted.current) { setProbe(value); callback.current(value); } };
  const detect = async () => {
    if (!desktop || locked.current) return;
    locked.current = true;
    const token = ++operation.current;
    setBusy(true);
    publish({ available: false, reason: "正在检测内置引擎与显卡，首次初始化可能需要几分钟。" });
    try {
      const detected = await client.probeDLSS5();
      if (mounted.current && token === operation.current) publish(detected);
    } catch (error) {
      if (mounted.current && token === operation.current) publish({ available: false, status: "error", reason: String(error) });
    } finally {
      if (token === operation.current) {
        locked.current = false;
        if (mounted.current) setBusy(false);
      }
    }
  };
  useEffect(() => {
    mounted.current = true;
    if (desktop) void detect();
    else { setBusy(false); publish({ available: false, status: "unsupported_platform", reason: "浏览器可编辑增强参数；运行内置视频增强需要使用 XAI 桌面应用。" }); }
    return () => { mounted.current = false; operation.current++; locked.current = false; };
  }, [desktop]);
  const status = probe.status && stateText[probe.status] ? probe.status : probe.available ? "ready" : "error";
  const [heading, help] = stateText[status];
  return <section className="dlss5-engine" aria-label="内置视频增强引擎">
    <div className={`dlss5-engine-status ${probe.available ? "ready" : "unavailable"}`} role="status" aria-busy={busy}>
      {busy ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <span className="dlss5-status-dot" aria-hidden="true" />}
      <strong>{busy ? "正在检测内置引擎与显卡…" : desktop ? heading : "请使用 XAI 桌面应用"}</strong>
    </div>
    <p className="dlss5-tip">{busy ? "首次初始化可能需要几分钟，检测完成后即可预览和导出。" : desktop ? help : probe.reason}</p>
    {(probe.gpu || probe.bundleVersion || probe.engineVersion) && <dl className="dlss5-engine-info">
      {probe.gpu && <><dt>显卡</dt><dd>{probe.gpu}</dd></>}
      {(probe.bundleVersion || probe.engineVersion) && <><dt>内置引擎版本</dt><dd>{probe.bundleVersion || probe.engineVersion}{probe.bundleVersion && probe.engineVersion ? ` · ${probe.engineVersion}` : ""}</dd></>}
    </dl>}
    {!busy && desktop && !probe.available && probe.reason && <details className="dlss5-engine-detail"><summary>查看检测详情</summary><p className="dlss5-tip">{probe.reason}</p></details>}
    <button className="studio-secondary" type="button" disabled={!desktop || busy} onClick={() => void detect()}>
      {busy ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}{busy ? "检测中…" : "重新检测"}
    </button>
    <p className="dlss5-tip">当前支持 SDR 视频；HDR 输入会在处理前明确提示。</p>
  </section>;
}
