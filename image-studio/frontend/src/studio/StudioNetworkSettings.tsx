import { useState } from "react";
import { loadProxyConfig, persistProxyConfig, type ProxyConfig } from "../lib/proxy";

type NetworkHost = {
  SetNetworkProxy(mode: string, url: string): Promise<unknown>;
};

/** Uses the same persisted proxy as earlier releases, without mounting their editor. */
export function StudioNetworkSettings({ disabled }: { disabled: boolean }) {
  const [config, setConfig] = useState<ProxyConfig>(loadProxyConfig);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const save = async () => {
    const host = (window as unknown as { go?: { backend?: { StudioV2?: NetworkHost } } }).go?.backend?.StudioV2;
    if (!host) return;
    setSaving(true);
    setMessage("");
    try {
      const url = config.mode === "custom" ? config.url.trim() : "";
      await host.SetNetworkProxy(config.mode, url);
      persistProxyConfig(config.mode, url);
      setMessage("网络设置已保存，将用于后续请求。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="studio-settings-note">
      <h3>网络代理</h3>
      <p>沿用已有代理配置；切换网络时可在这里调整。</p>
      <label>连接方式
        <select disabled={disabled || saving} value={config.mode}
          onChange={(e) => { setConfig({ ...config, mode: e.target.value as ProxyConfig["mode"] }); setMessage(""); }}>
          <option value="system">跟随系统代理</option>
          <option value="none">直接连接</option>
          <option value="custom">自定义代理</option>
        </select>
      </label>
      {config.mode === "custom" && <label>代理地址
        <input disabled={disabled || saving} value={config.url} placeholder="http://127.0.0.1:7890"
          onChange={(e) => { setConfig({ ...config, url: e.target.value }); setMessage(""); }} />
      </label>}
      <p>支持 HTTP 和 HTTPS 代理。代理地址用于网络转发，API 根地址仍在上游配置中填写。</p>
      <button type="button" disabled={disabled || saving} onClick={() => void save()}>
        {saving ? "保存中…" : "保存网络设置"}
      </button>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
