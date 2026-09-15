import { useState } from "react";
import { ChevronDown, ChevronRight, Copy, LayoutGrid, Move, Plus, Redo2, Scissors, Sparkles, Type, Undo2 } from "lucide-react";
import { useStudioStore } from "../../state/studioStore";
import { clampCanvasScale, sourceHistoryItemForCanvasNode } from "../../state/canvasNodes";
import { historyFullSrc, historyPreviewSrc } from "../../lib/images";
import { SIZE_OPTIONS, type SizeValue } from "../../types/domain";
import { CanvasStage } from "../canvas/CanvasStage";
import { normalizeQualitySelection } from "../panel/panelOptions";
import { formatSizeValue, normalizeSizeSelection } from "../panel/sizeCapabilities";
import { XAIProgress } from "./XAIProgress";
import "./xai-pro.css";

export function XAIProPanels() {
  const {
    profiles, activeProfileId, imageModelID, apiMode, requestPolicy, size, quality, inputFidelity,
    outputFormat, batchCount, prompt, isRunning, jobsCompleted, jobsTotal, progress, sources, currentImage, history, canvasNodes,
    selectedNodeId, tool, annotationKind, brushSize, brushMode, undoStack, redoStack,
    viewZoom, canvasViewport, setActiveProfile, setField, selectSourceImage, viewSourceOnCanvas,
    selectCanvasNode, removeCanvasNode, setCanvasViewport, applyHistoryParams, reuseAsSource, openResultDetail,
    importMaskImage, resetMask, openHistoryTimeline, undo, redo, submit, pushToast,
  } = useStudioStore();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ sources: true, operations: true });
  const selectedNode = canvasNodes.find((node) => node.id === selectedNodeId);
  const selectedSourceIndex = sources.findIndex((source) => `source-preview:${source.path}` === selectedNodeId);
  const selectedSource = sources[selectedSourceIndex];
  const selectedItem = currentImage?.id === selectedNodeId ? currentImage : history.find((item) => item.id === selectedNodeId);
  const hasSelection = !!(selectedNode || selectedSource || selectedItem);
  const canEdit = !!currentImage;
  const selectedTitle = selectedSource?.name || selectedNode?.label || selectedItem?.prompt || "当前选择";
  const selectedPreview = selectedSource ? historyPreviewSrc(selectedSource, null) : selectedItem ? historyFullSrc(selectedItem, null) : selectedNode?.src;
  const dimensions = selectedItem?.previewWidth && selectedItem.previewHeight
    ? `${selectedItem.previewWidth} × ${selectedItem.previewHeight}`
    : selectedSource?.previewWidth && selectedSource.previewHeight
      ? `${selectedSource.previewWidth} × ${selectedSource.previewHeight}`
      : selectedNode ? `${selectedNode.width} × ${selectedNode.height}` : "—";
  const sizeOptions = Array.from(new Set([size, ...SIZE_OPTIONS.map((option) => normalizeSizeSelection(option.value, { apiMode, requestPolicy, imageModelID }))]));
  const zoom = canvasViewport?.scale ?? viewZoom;
  const params = JSON.stringify({ size: selectedItem?.size ?? size, quality: selectedItem?.quality ?? quality, outputFormat: selectedItem?.outputFormat ?? outputFormat, inputFidelity: selectedItem?.inputFidelity ?? inputFidelity, seed: selectedItem?.seed ?? 0 }, null, 2);
  const sections = [
    { id: "prompt", title: "提示词", text: selectedItem?.prompt || prompt || "暂无提示词" },
    { id: "params", title: "参数信息", text: params },
    { id: "sources", title: `参考图（${selectedItem?.sourcePaths?.length ?? sources.length}）`, text: (selectedItem?.sourcePaths ?? sources.map((source) => source.name)).join("\n") || "暂无参考图" },
  ];
  const toggleSection = (id: string) => setCollapsed((state) => ({ ...state, [id]: !state[id] }));

  const addAsset = async () => {
    const previousPaths = new Set(useStudioStore.getState().sources.map((source) => source.path));
    await selectSourceImage();
    const nextSources = useStudioStore.getState().sources;
    const index = nextSources.findIndex((source) => !previousPaths.has(source.path));
    if (index >= 0) await viewSourceOnCanvas(index);
  };
  const selectLayer = (id: string) => {
    const node = canvasNodes.find((entry) => entry.id === id);
    const item = history.find((entry) => entry.id === id) ?? sourceHistoryItemForCanvasNode(node);
    if (node?.type === "video") setField("currentImage", null);
    else if (item && currentImage?.id !== id) setField("currentImage", item);
    selectCanvasNode(id);
  };
  const setZoom = (scale: number) => {
    const viewport = canvasViewport || { x: 0, y: 0, scale: zoom };
    setCanvasViewport({ ...viewport, scale: clampCanvasScale(scale) });
  };
  const copyText = async (text: string) => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(text);
      pushToast("已复制", "success");
    } catch { pushToast("当前环境无法写入剪贴板", "warn"); }
  };
  const applyToCanvas = async () => {
    if (selectedSource) {
      await viewSourceOnCanvas(selectedSourceIndex);
      setField("sources", [selectedSource]);
      setField("mode", "edit");
      setField("editSourceMode", "manual");
      setField("editAutoAspectResolution", "");
      setField("size", "auto");
    }
    else if (selectedItem) {
      setField("errorMessage", null);
      await reuseAsSource(selectedItem);
      const applied = useStudioStore.getState();
      const source = applied.sources.find((entry) => entry.path === applied.currentImage?.savedPath);
      if (applied.errorMessage || applied.currentImage?.id !== selectedItem.id || !source) return;
      if (!selectedItem.id.startsWith("source-preview:")) applyHistoryParams(selectedItem);
      else {
        setField("editAutoAspectResolution", "");
        setField("size", "auto");
      }
      setField("sources", [source]);
      setField("mode", "edit");
      setField("editSourceMode", "manual");
      selectCanvasNode(selectedItem.id);
    } else if (selectedNode) selectCanvasNode(selectedNode.id);
    if (hasSelection) pushToast("已应用到画布", "success");
  };
  const removeSelected = () => {
    if (!selectedNode) return;
    removeCanvasNode(selectedNode.id);
    if (currentImage?.id === selectedNode.id) setField("currentImage", null);
  };
  const activateLocalPaint = async () => {
    const state = useStudioStore.getState();
    if (!state.currentImage) return;
    const hasCurrentSource = !!state.currentImage.savedPath
      && state.sources.some((source) => source.path === state.currentImage?.savedPath);
    if (state.mode !== "edit" || !hasCurrentSource) {
      await reuseAsSource(state.currentImage);
    }
    const latest = useStudioStore.getState();
    if (!latest.currentImage) return;
    if (latest.mode !== "edit") {
      pushToast("当前图片暂时无法进入局部绘制", "warn");
      return;
    }
    selectCanvasNode(latest.currentImage.id);
    setField("tool", "mask");
  };

  return <>
    <aside className="xai-pro-left">
      <div className="xai-pro-tabs"><button className="active" onClick={() => setCanvasViewport(null)}>画布</button><button onClick={() => pushToast("工作流编排尚未开放，当前可使用画布创作", "info")}>工作流</button></div>
      <button className="xai-panel-heading xai-panel-toggle" aria-expanded={!collapsed.layers} onClick={() => toggleSection("layers")}>素材与图层 {collapsed.layers ? <ChevronRight size={15} /> : <ChevronDown size={15} />}</button>
      {!collapsed.layers && <>
        <button className="xai-add-asset" onClick={() => void addAsset()}><Plus size={16} />添加素材</button>
        <div className="xai-layer-list">
          {canvasNodes.filter((node) => !sources.some((source) => node.id === `source-preview:${source.path}`)).map((node) => <button className={`xai-layer ${selectedNodeId === node.id ? "active" : ""}`} key={node.id} onClick={() => selectLayer(node.id)}>
            {node.type === "image" ? <img src={node.src} alt="" /> : <span>视频</span>}<span>{node.label || "图层"}<small>{node.width} × {node.height}</small></span><ChevronRight size={14} />
          </button>)}
          {sources.map((source, index) => <button className={`xai-layer ${selectedNodeId === `source-preview:${source.path}` ? "active" : ""}`} key={source.path} onClick={() => { if (currentImage?.id !== `source-preview:${source.path}`) void viewSourceOnCanvas(index); else selectCanvasNode(currentImage.id); }}>
            <img src={historyPreviewSrc(source, null)} alt="" /><span>{source.name}<small>参考图 · 点击应用到画布</small></span><ChevronRight size={14} />
          </button>)}
          {!canvasNodes.length && !sources.length && <p className="xai-pro-note">添加素材或生成图片后，图层会显示在这里。</p>}
        </div>
      </>}
      <button className="xai-panel-heading xai-panel-toggle" aria-expanded={!collapsed.settings} onClick={() => toggleSection("settings")}>生成设置 {collapsed.settings ? <ChevronRight size={15} /> : <ChevronDown size={15} />}</button>
      {!collapsed.settings && <>
        <label className="xai-field">模型 / 上游<select value={activeProfileId} onChange={(event) => void setActiveProfile(event.target.value)} disabled={!profiles.length}>
          {!profiles.length && <option value="">{imageModelID.trim() || "选择模型"}</option>}{profiles.map((profile) => {
            const configuredModel = profile.imageModelID.trim() || (profile.id === activeProfileId ? imageModelID.trim() : "");
            return <option key={profile.id} value={profile.id}>{configuredModel ? `${configuredModel} · ${profile.name}` : profile.name}</option>;
          })}
        </select></label>
        <label className="xai-field">图像尺寸<select value={size} onChange={(event) => setField("size", event.target.value as SizeValue)}>{sizeOptions.map((value) => <option key={value} value={value}>{formatSizeValue(value)}</option>)}</select></label>
        <label className="xai-field">输出格式<select value={outputFormat} onChange={(event) => setField("outputFormat", event.target.value as typeof outputFormat)}>{["png", "jpeg", "webp"].map((value) => <option value={value} key={value}>{value.toUpperCase()}</option>)}</select></label>
        <label className="xai-field">生成张数<select value={batchCount} onChange={(event) => setField("batchCount", Number(event.target.value))}>{Array.from(new Set([batchCount, 1, 2, 3, 4])).sort((a, b) => a - b).map((value) => <option value={value} key={value}>{value} 张</option>)}</select></label>
        <button className="xai-toggle-row" role="switch" aria-checked={quality === "high" || quality === "hd"} onClick={() => setField("quality", normalizeQualitySelection(quality === "high" || quality === "hd" ? "medium" : "high", imageModelID))}><span>高清修复<small>生成质量</small></span><i className={quality === "high" || quality === "hd" ? "on" : ""} /></button>
        <button className="xai-toggle-row" role="switch" aria-checked={inputFidelity === "high"} onClick={() => setField("inputFidelity", inputFidelity === "high" ? "auto" : "high")}><span>面部增强<small>参考图保真</small></span><i className={inputFidelity === "high" ? "on" : ""} /></button>
        <p className="xai-pro-note">通过生成质量与参考图保真控制细节；效果由上游模型提供。</p>
        <label className="xai-field">提示词<textarea value={prompt} onChange={(event) => setField("prompt", event.target.value)} placeholder="描述你想要创作的内容…" /></label>
        <button className="xai-generate xai-pro-generate" disabled={isRunning || !prompt.trim()} onClick={() => void submit()}><Sparkles size={16} />{isRunning ? "生成中…" : "生成"}</button>
        <XAIProgress isRunning={isRunning} progress={progress} jobsCompleted={jobsCompleted} jobsTotal={jobsTotal} />
      </>}
    </aside>
    <main className="xai-canvas">
      <div className="xai-canvas-toolbar">
        <button title="选择 / 移动图层" className={tool === "pan" ? "active" : ""} onClick={() => setField("tool", "pan")}>选择</button>
        <button title="移动画布（按住空格）" aria-label="移动画布" className={tool === "pan" ? "active" : ""} onClick={() => setField("tool", "pan")}><Move size={14} /></button>
        <button title="文字标注" aria-label="文字标注" className={tool === "annotate" ? "active" : ""} disabled={!canEdit} onClick={() => { setField("annotationKind", "text"); setField("tool", "annotate"); }}><Type size={14} /></button>
        <button title="局部绘制" aria-label="局部绘制" className={tool === "mask" ? "active" : ""} disabled={!canEdit} onClick={() => void activateLocalPaint()}><Scissors size={14} /></button>
        <span />
        <select className="xai-zoom-select" aria-label="画布缩放" value={String(zoom)} onChange={(event) => event.target.value === "fit" ? setCanvasViewport(null) : setZoom(Number(event.target.value))}>
          <option value="fit">适应画布</option>{Array.from(new Set([zoom, 0.25, 0.5, 1, 1.5, 2, 4])).sort((a, b) => a - b).map((scale) => <option value={scale} key={scale}>{Math.round(scale * 100)}%</option>)}
        </select>
        <button title="撤销" aria-label="撤销" disabled={!undoStack.length} onClick={undo}><Undo2 size={15} /></button><button title="重做" aria-label="重做" disabled={!redoStack.length} onClick={redo}><Redo2 size={15} /></button>
      </div>
      {tool === "mask" && <div className="xai-tool-options"><label>画笔 {brushSize}<input aria-label="画笔大小" type="range" min={4} max={160} value={brushSize} onChange={(event) => setField("brushSize", Number(event.target.value))} /></label><button onClick={() => setField("brushMode", brushMode === "paint" ? "erase" : "paint")}>{brushMode === "paint" ? "绘制蒙版" : "擦除蒙版"}</button><button onClick={() => void importMaskImage()}>导入蒙版</button><button onClick={resetMask}>清空蒙版</button></div>}
      {tool === "annotate" && <div className="xai-tool-options"><label>标注<select value={annotationKind} onChange={(event) => setField("annotationKind", event.target.value as typeof annotationKind)}><option value="text">文字</option><option value="rect">矩形</option><option value="arrow">箭头</option><option value="freehand">自由绘制</option></select></label></div>}
      <div className="xai-grid-canvas xai-live-canvas"><CanvasStage /><div className="xai-zoom"><button aria-label="缩小画布" onClick={() => setZoom(zoom / 1.2)}>−</button><span>{Math.round(zoom * 100)}%</span><button aria-label="放大画布" onClick={() => setZoom(zoom * 1.2)}>＋</button></div></div>
    </main>
    <aside className="xai-pro-right">
      <div className="xai-pro-tabs"><button className="active" onClick={() => setCollapsed({})}>属性</button><button onClick={openHistoryTimeline}>历史</button></div>
      {hasSelection ? <>
        {selectedNode?.type === "video" ? <video className="xai-inspector-image" src={selectedPreview} controls /> : <img className="xai-inspector-image" src={selectedPreview} alt="当前选择" />}
        <div className="xai-inspector-meta"><b>{selectedTitle}</b><span>尺寸　{dimensions}</span><span>类型　{selectedNode?.type === "video" ? "视频" : (selectedItem?.outputFormat || selectedSource?.name.split(".").pop() || "图片").toUpperCase()}</span>{selectedSource?.size ? <span>大小　{Math.round(selectedSource.size / 1024)} KB</span> : null}</div>
      </> : <p className="xai-pro-note">选择图层或参考图以查看属性。</p>}
      {sections.map((section) => <div className="xai-property-section" key={section.id}><div className="xai-collapse"><button aria-expanded={!collapsed[section.id]} onClick={() => toggleSection(section.id)}>{collapsed[section.id] ? <ChevronRight size={14} /> : <ChevronDown size={14} />}{section.title}</button><button title={`复制${section.title}`} aria-label={`复制${section.title}`} onClick={() => void copyText(section.text)}><Copy size={13} /></button></div>{!collapsed[section.id] && <pre className="xai-property-content">{section.text}</pre>}</div>)}
      <div className="xai-collapse"><button aria-expanded={!collapsed.operations} onClick={() => toggleSection("operations")}>{collapsed.operations ? <ChevronRight size={14} /> : <ChevronDown size={14} />}更多操作</button></div>
      {!collapsed.operations && <div className="xai-inspector-actions"><button disabled={!selectedItem} onClick={() => selectedItem && void openResultDetail(selectedItem)}>查看详情</button><button disabled={!selectedNode} onClick={removeSelected}>移除画布图层</button></div>}
      <button className="xai-apply" disabled={!hasSelection} onClick={() => void applyToCanvas()}><LayoutGrid size={15} />应用到画布</button>
    </aside>
  </>;
}
