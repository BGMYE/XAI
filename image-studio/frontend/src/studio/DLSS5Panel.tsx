import { useEffect, useId, useMemo, useState } from "react";
import { ChevronDown, Sparkles } from "lucide-react";
import { DLSS5EngineSettings } from "./DLSS5EngineSettings";
import { DLSS5Preview } from "./DLSS5Preview";
import { dlss5AspectRatio, validateDLSS5Options } from "./DLSS5Options.mjs";
import type { Asset, DLSS5Options, DLSS5Probe, DLSS5Resolution, Job } from "./types";
import { applyDLSS5Preset, selectedDLSS5Preset, loadDLSS5Preferences, saveDLSS5Preferences, type DLSS5Preset } from "./DLSS5Preferences.mjs";
import "./DLSS5.css";
const strengths = [
  ["intensity", "增强程度", "调整光影与材质细节的增强程度。"],
  ["localTone", "局部色调", "调整局部明暗与色调。"],
  ["localStructure", "局部结构", "调整画面细节与结构。"],
  ["skinStructure", "皮肤结构", "调整皮肤区域的结构细节。"],
  ["outputMix", "效果混合", "0% 为原画面，100% 为增强结果。"],
] as const;
function ResolutionControl({ label, value, max, onChange }: { label: string; value: DLSS5Resolution; max: number; onChange(value: DLSS5Resolution): void }) {
  return <fieldset className="dlss5-resolution"><legend>{label}</legend>
    <label>尺寸方式<select value={value.mode} onChange={event => onChange({ ...value, mode: event.target.value as DLSS5Resolution["mode"] })}>
      <option value="source">跟随原视频</option><option value="custom">自定义宽高</option>
    </select></label>
    {value.mode === "custom" && <div className="dlss5-two-columns">
      <label>宽度 · px<input type="number" min={128} max={max} step={2} value={Number.isFinite(value.width) ? value.width : ""} onChange={event => onChange({ ...value, width: event.target.valueAsNumber })} /></label>
      <label>高度 · px<input type="number" min={128} max={max} step={2} value={Number.isFinite(value.height) ? value.height : ""} onChange={event => onChange({ ...value, height: event.target.valueAsNumber })} /></label>
    </div>}
    <p className="dlss5-tip">{value.mode === "custom" ? `画面比例 ${dlss5AspectRatio(value.width, value.height)} · 宽高须为偶数` : "保留原视频尺寸；运行前检查实际尺寸是否在引擎限制内。"}</p>
  </fieldset>;
}
export function DLSS5Panel({ value, onChange, jobs, assets, onBlockedReason, onRefresh, report }: {
  value?: DLSS5Options; onChange(value: DLSS5Options): void; jobs: Job[]; assets: Asset[];
  onBlockedReason(reason: string): void; onRefresh(): Promise<unknown>; report(error: unknown): void;
}) {
  const id = useId(), fallback = useMemo(loadDLSS5Preferences, []), options = value ?? fallback;
  const [probe, setProbe] = useState<DLSS5Probe>({ available: false, reason: "请先检测本地引擎。" });
  const [customPreset, setCustomPreset] = useState(false);
  const patch = (update: Partial<DLSS5Options>) => onChange({ ...options, ...update });
  useEffect(() => { if (!value) onChange(fallback); }, [value, fallback, onChange]);
  useEffect(() => { saveDLSS5Preferences(options); }, [options]);
  const supportedFlow = (["raft", "nvofa"] as const).filter(flow => probe.available && probe.supportsFlow?.includes(flow));
  const unsupportedSelection = options.flowBackend !== "off" && !supportedFlow.includes(options.flowBackend);
  const strengthControls = (advanced: boolean) => <div className="dlss5-sliders">{strengths.filter(([key]) => advanced ? key !== "intensity" && key !== "outputMix" : key === "intensity" || key === "outputMix").map(([key, label, tip]) => <label className={`dlss5-slider ${key === "skinStructure" && !options.autoMask ? "is-disabled" : ""}`} key={key}>
    <span>{label}<span className="dlss5-percent"><input type="number" min={0} max={100} step={1} aria-label={`${label}百分比`} disabled={key === "skinStructure" && !options.autoMask} value={Number.isFinite(options[key]) ? Math.round(options[key] * 100) : ""} onChange={event => { setCustomPreset(false); patch({ [key]: event.target.valueAsNumber / 100 }); }} /><span>%</span></span></span>
    <input type="range" min={0} max={1} step={0.01} value={Number.isFinite(options[key]) ? options[key] : 0} disabled={key === "skinStructure" && !options.autoMask} onChange={event => { setCustomPreset(false); patch({ [key]: Number(event.target.value) }); }} aria-label={label} />
    <small>{key === "skinStructure" && !options.autoMask ? "自动皮肤蒙版已关闭，皮肤结构增强不生效；开启后恢复此设置。" : tip}</small>
  </label>)}</div>;
  const invalid = options.enabled ? validateDLSS5Options(options) : null;
  useEffect(() => {
    onBlockedReason(!probe.available ? probe.reason || "本地引擎不可用。" : options.flowBackend !== "off" && !probe.supportsFlow?.includes(options.flowBackend) ? "当前设备不支持上次选择的时间一致性方式，请选择关闭或已支持的选项。" : "");
  }, [probe, options.flowBackend, onBlockedReason]);
  return <section className={`dlss5-panel ${options.enabled ? "is-enabled" : ""}`}>
    <div className="dlss5-toggle-row"><span><Sparkles size={18} aria-hidden="true" /><label htmlFor={id}>DLSS5 视频增强</label></span>
      <input id={id} type="checkbox" role="switch" aria-expanded={options.enabled} aria-controls={`${id}-body`} checked={options.enabled} onChange={event => patch({ enabled: event.target.checked })} />
    </div>
    <p className="dlss5-tip">视频生成后在本机增强。原片保留，可先用短片预览效果。</p>
    {options.enabled && <div id={`${id}-body`} className="dlss5-expanded">
      <DLSS5EngineSettings onProbe={setProbe} />
      <label>XAI 增强预设<select aria-label="XAI 增强预设" value={customPreset ? "custom" : selectedDLSS5Preset(options)} onChange={event => {
        const preset = event.target.value as DLSS5Preset;
        setCustomPreset(preset === "custom");
        if (preset !== "custom") onChange(applyDLSS5Preset(options, preset));
      }}><option value="natural">自然均衡</option><option value="detail">细节增强</option><option value="cinematic">电影风格</option><option value="custom">自定义</option></select></label>
      <p className="dlss5-tip">预设是 XAI 提供的参数组合，可继续微调；不会改变预览、导出尺寸或时间一致性设置。</p>
      {strengthControls(false)}
      <details className="dlss5-flow dlss5-advanced"><summary>高级调节 <ChevronDown size={14} /></summary><div className="dlss5-config-fields">
        <label>画面基调<select value={options.style} onChange={event => { setCustomPreset(false); patch({ style: Number(event.target.value) as DLSS5Options["style"] }); }}>
          <option value={0}>均衡</option><option value={1}>自然</option><option value={2}>电影</option>
        </select></label>
        {strengthControls(true)}
        <label className="dlss5-check"><input type="checkbox" checked={options.autoMask} onChange={event => { setCustomPreset(false); patch({ autoMask: event.target.checked }); }} />自动皮肤蒙版</label>
        <button className="studio-secondary" type="button" onClick={() => { setCustomPreset(false); patch({ style: 0, intensity: 1, localTone: 1, localStructure: 1, skinStructure: 1, outputMix: 1, autoMask: true }); }}>重置画面参数</button>
        <label>时间一致性<select aria-label="时间一致性" value={options.flowBackend} onChange={event => patch({ flowBackend: event.target.value as DLSS5Options["flowBackend"] })}>
          <option value="off">关闭</option>
          {supportedFlow.includes("raft") && <option value="raft">标准帧间一致性</option>}
          {supportedFlow.includes("nvofa") && <option value="nvofa">显卡加速帧间一致性</option>}
          {unsupportedSelection && <option value={options.flowBackend} disabled>上次选择的方式 · 当前不可用</option>}
        </select></label>
        <p className="dlss5-tip">{supportedFlow.length ? "仅显示当前设备已检测支持的方式，用于减少连续帧之间的变化。" : "当前设备尚未检测到可用的帧间一致性方式。"}{unsupportedSelection ? "上次参数已保留，请选择关闭或可用选项后继续。" : ""}</p>
        {options.flowBackend !== "off" && <div className="dlss5-two-columns"><label>分析画面长边<input type="number" min={128} max={2048} step={1} value={Number.isFinite(options.flowWidth) ? options.flowWidth : ""} onChange={event => patch({ flowWidth: event.target.valueAsNumber })} /></label>
          {options.flowBackend === "raft" && <label>细化次数<input type="number" min={1} max={32} step={1} value={Number.isFinite(options.flowIterations) ? options.flowIterations : ""} onChange={event => patch({ flowIterations: event.target.valueAsNumber })} /></label>}</div>}
      </div></details>
      <ResolutionControl label="短片预览分辨率" value={options.previewResolution} max={4096} onChange={previewResolution => patch({ previewResolution })} />
      <ResolutionControl label="完整导出分辨率" value={options.exportResolution} max={8192} onChange={exportResolution => patch({ exportResolution })} />
      <p className="dlss5-tip">预览与导出可使用不同尺寸。比例与原片不同时，等比缩放并补黑边；自定义尺寸属于缩放，不代表 AI 超分。预览最多 829 万像素，导出最多 3318 万像素。</p>
      {invalid && <p className="dlss5-error" role="alert">{invalid}</p>}
      <DLSS5Preview options={options} jobs={jobs} assets={assets} probe={probe} onRefresh={onRefresh} report={report} />
    </div>}
  </section>;
}
