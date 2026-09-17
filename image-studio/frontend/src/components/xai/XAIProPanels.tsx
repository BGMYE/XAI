import { useEffect, useRef, useState } from "react";
import { Brush, ChevronDown, Copy, Crop, Download, Eraser, Expand, FlipHorizontal, FlipVertical, ImagePlus, Layers, LayoutGrid, MoreHorizontal, MousePointer2, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Plus, Redo2, RotateCcw, RotateCw, SlidersHorizontal, Sparkles, Square, Type, Undo2, X } from "lucide-react";
import { useStudioStore } from "../../state/studioStore";
import { clampCanvasScale, sourceHistoryItemForCanvasNode } from "../../state/canvasNodes";
import { historyFullSrc, historyPreviewSrc } from "../../lib/images";
import { SIZE_OPTIONS, type SizeValue } from "../../types/domain";
import { ChooseDirectory } from "../../platform/runtime/host";
import { CanvasStage } from "../canvas/CanvasStage";
import { DragExportHandle } from "../canvas/DragExportHandle";
import { BatchProcessSection } from "../panel/BatchProcessSection";
import { LoopGenerationSection } from "../panel/LoopGenerationSection";
import { VideoGenerationPanel } from "../panel/VideoGenerationPanel";
import { availableQualityOptions, normalizeQualitySelection } from "../panel/panelOptions";
import { formatSizeValue, normalizeSizeSelection } from "../panel/sizeCapabilities";
import { qualityLabel } from "../history/historyLabels";
import { XAIProgress } from "./XAIProgress";
import { activateLocalPaint, professionalPanelDefaults, selectedCropRect, type CanvasCommand } from "./proCanvasActions";
import "./xai-pro.css";

export function XAIProPanels() {
  const state = useStudioStore();
  const {
    profiles, activeProfileId, imageModelID, apiMode, requestPolicy, size, quality, inputFidelity,
    outputFormat, batchCount, prompt, isRunning, jobsCompleted, jobsTotal, progress, sources,
    currentImage, history, canvasNodes, selectedNodeId, tool, annotationKind, annotationColor,
    brushSize, brushMode, undoStack, redoStack, viewZoom, canvasViewport, fontScale,
    compareB, compareSplit, batchResults, resultGridOpen, editSourceMode, batchProcess,
    setActiveProfile, setField, selectSourceImage, viewSourceOnCanvas, compareSourceOnCanvas,
    selectCanvasNode, removeCanvasNode, removeSource, setCanvasViewport, applyHistoryParams,
    reuseAsSource, openResultDetail, importMaskImage, resetMask, clearAnnotations, openHistoryTimeline,
    undo, redo, submit, cancel, pushToast, setCompareB, setCompareSplit, openResultGrid, closeResultGrid,
    chooseBatchInputDir, chooseBatchInputFiles, refreshBatchInputDir,
  } = state;
  const rootRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDetailsElement>(null);
  const [width, setWidth] = useState(1200);
  const [panelOverrides, setPanelOverrides] = useState<{ materials?: boolean; inspector?: boolean }>({});
  const defaults = professionalPanelDefaults(width, fontScale);
  const materialsOpen = panelOverrides.materials ?? defaults.materials;
  const inspectorOpen = panelOverrides.inspector ?? defaults.inspector;
  const selectedNode = canvasNodes.find((node) => node.id === selectedNodeId);
  const selectedSourceIndex = sources.findIndex((source) => `source-preview:${source.path}` === selectedNodeId);
  const selectedSource = sources[selectedSourceIndex];
  const selectedItem = currentImage?.id === selectedNodeId ? currentImage : history.find((item) => item.id === selectedNodeId);
  const hasSelection = !!(selectedNode || selectedSource || selectedItem);
  const canEdit = !!currentImage && !isRunning;
  const canTransform = canEdit && !!currentImage?.savedPath;
  const cropRect = selectedCropRect(state);
  const selectedTitle = selectedSource?.name || selectedNode?.label || selectedItem?.prompt || "未命名图层";
  const selectedPreview = selectedSource ? historyPreviewSrc(selectedSource, null) : selectedItem ? historyFullSrc(selectedItem, null) : selectedNode?.src;
  const dimensions = selectedNode ? `${selectedNode.width} × ${selectedNode.height}`
    : selectedItem?.previewWidth && selectedItem.previewHeight ? `${selectedItem.previewWidth} × ${selectedItem.previewHeight}`
      : selectedSource?.previewWidth && selectedSource.previewHeight ? `${selectedSource.previewWidth} × ${selectedSource.previewHeight}` : "—";
  const activeProfile = profiles.find((profile) => profile.id === activeProfileId);
  const modelIDs = Array.from(new Set([imageModelID, ...(activeProfile?.modelIDs ?? [])].filter(Boolean)));
  const sizeOptions = Array.from(new Set([size, ...SIZE_OPTIONS.map((option) => normalizeSizeSelection(option.value, { apiMode, requestPolicy, imageModelID }))]));
  const zoom = canvasViewport?.scale ?? viewZoom;
  const properties = [
    ["尺寸", formatSizeValue(selectedItem?.size ?? size)], ["质量", qualityLabel(selectedItem?.quality ?? quality)],
    ["格式", (selectedItem?.outputFormat ?? outputFormat).toUpperCase()], ["参考图保真", (selectedItem?.inputFidelity ?? inputFidelity) === "high" ? "高" : (selectedItem?.inputFidelity ?? inputFidelity) === "low" ? "低" : "自动"],
  ];

  useEffect(() => {
    const element = rootRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) menuRef.current?.removeAttribute("open");
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !menuRef.current?.open) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      menuRef.current.removeAttribute("open");
      menuRef.current.querySelector("summary")?.focus();
    };
    document.addEventListener("pointerdown", dismiss);
    window.addEventListener("keydown", escape, true);
    return () => { document.removeEventListener("pointerdown", dismiss); window.removeEventListener("keydown", escape, true); };
  }, []);

  const setZoom = (scale: number) => {
    const viewport = useStudioStore.getState().canvasViewport || { x: 0, y: 0, scale: zoom };
    setCanvasViewport({ ...viewport, scale: clampCanvasScale(scale) });
  };
  const togglePanel = (panel: "materials" | "inspector") => {
    const open = panel === "materials" ? materialsOpen : inspectorOpen;
    setPanelOverrides((previous) => ({ ...previous, [panel]: !open }));
  };
  const executeCanvasCommand = (command: CanvasCommand) => {
    const current = useStudioStore.getState();
    switch (command) {
      case "toggle-materials": togglePanel("materials"); return;
      case "toggle-inspector": togglePanel("inspector"); return;
      case "select": setField("tool", "pan"); return;
      case "fit": setCanvasViewport(null); setField("canvasViewResetTick", current.canvasViewResetTick + 1); return;
      case "zoom-in": setZoom((current.canvasViewport?.scale ?? current.viewZoom) * 1.2); return;
      case "zoom-out": setZoom((current.canvasViewport?.scale ?? current.viewZoom) / 1.2); return;
      case "mask": void activateLocalPaint(useStudioStore.getState); return;
      case "annotate": if (current.currentImage && !current.isRunning) setField("tool", "annotate"); return;
      case "save": if (current.currentImage) void current.saveCurrentImageAs(); return;
    }
    if (!current.currentImage?.savedPath || current.isRunning) return;
    switch (command) {
      case "rotate-left": void current.rotateCurrent(-90); break;
      case "rotate-right": void current.rotateCurrent(90); break;
      case "flip-horizontal": void current.flipCurrent(true); break;
      case "flip-vertical": void current.flipCurrent(false); break;
      case "crop": {
        const rect = selectedCropRect(current);
        if (rect) void current.cropToRect(rect.x, rect.y, rect.width, rect.height);
        else { setField("annotationKind", "rect"); setField("tool", "annotate"); pushToast("在图片上画出矩形，再选择“裁剪选区”。", "info"); }
        break;
      }
    }
  };
  useEffect(() => {
    const handleCommand = (event: Event) => executeCanvasCommand((event as CustomEvent<{ command: CanvasCommand }>).detail?.command);
    window.addEventListener("studio:canvas-command", handleCommand);
    return () => window.removeEventListener("studio:canvas-command", handleCommand);
  });

  const addAsset = async () => {
    const previousPaths = new Set(useStudioStore.getState().sources.map((source) => source.path));
    await selectSourceImage();
    const index = useStudioStore.getState().sources.findIndex((source) => !previousPaths.has(source.path));
    if (index >= 0) await viewSourceOnCanvas(index);
  };
  const selectLayer = (id: string) => {
    const node = canvasNodes.find((entry) => entry.id === id);
    const item = history.find((entry) => entry.id === id) ?? sourceHistoryItemForCanvasNode(node);
    if (node?.type === "video") setField("currentImage", null);
    else if (item && currentImage?.id !== id) setField("currentImage", item);
    selectCanvasNode(id);
  };
  const copyText = async (text: string) => {
    try { await navigator.clipboard.writeText(text); pushToast("已复制", "success"); }
    catch { pushToast("当前环境无法写入剪贴板", "warn"); }
  };
  const applyToCanvas = async () => {
    if (selectedSource) {
      await viewSourceOnCanvas(selectedSourceIndex);
      setField("sources", [selectedSource]); setField("mode", "edit"); setField("editSourceMode", "manual");
      setField("editAutoAspectResolution", ""); setField("size", "auto");
    } else if (selectedItem) {
      setField("errorMessage", null);
      await reuseAsSource(selectedItem);
      const applied = useStudioStore.getState();
      const source = applied.sources.find((entry) => entry.path === applied.currentImage?.savedPath);
      if (applied.errorMessage || applied.currentImage?.id !== selectedItem.id || !source) return;
      if (!selectedItem.id.startsWith("source-preview:")) applyHistoryParams(selectedItem);
      else { setField("editAutoAspectResolution", ""); setField("size", "auto"); }
      setField("sources", [source]); setField("mode", "edit"); setField("editSourceMode", "manual"); selectCanvasNode(selectedItem.id);
    } else return;
    pushToast("已设为编辑图片", "success");
  };

  return <div ref={rootRef} className="xai-pro-workspace" data-compact={!defaults.inspector} data-narrow={!defaults.materials}>
    <div className="xai-pro-commandbar" role="toolbar" aria-label="专业工作台">
      <button className="studio-icon-button" aria-label={materialsOpen ? "收起素材与参数" : "展开素材与参数"} aria-expanded={materialsOpen} aria-controls="pro-materials" onClick={() => executeCanvasCommand("toggle-materials")}>{materialsOpen ? <PanelLeftClose /> : <PanelLeftOpen />}</button>
      <span className="xai-pro-command-title">画布</span>
      <button className="studio-button xai-pro-prompt-shortcut" onClick={() => { setPanelOverrides((previous) => ({ ...previous, materials: true })); requestAnimationFrame(() => promptRef.current?.focus()); }}><SlidersHorizontal />创作参数</button>
      <button className="studio-icon-button" aria-label={inspectorOpen ? "收起属性" : "展开属性"} aria-expanded={inspectorOpen} aria-controls="pro-inspector" onClick={() => executeCanvasCommand("toggle-inspector")}>{inspectorOpen ? <PanelRightClose /> : <PanelRightOpen />}</button>
      {isRunning ? <button className="studio-button xai-pro-stop" onClick={() => void cancel()}><Square />停止生成</button> : <button className="studio-button xai-pro-generate" disabled={!prompt.trim()} onClick={() => void submit()}><Sparkles />生成</button>}
    </div>
    <div className="xai-pro-body">
      {materialsOpen && <aside id="pro-materials" className="xai-pro-left" aria-label="素材与创作参数">
        <div className="xai-pro-panel-header"><h2><Layers />素材</h2><button className="studio-icon-button" aria-label="收起素材与参数" onClick={() => executeCanvasCommand("toggle-materials")}><PanelLeftClose /></button></div>
        <button className="studio-button xai-add-asset" onClick={() => void addAsset()}><Plus />添加素材</button>
        <div className="xai-layer-list" role="list" aria-label="画布图层">
          {canvasNodes.filter((node) => !sources.some((source) => node.id === `source-preview:${source.path}`)).map((node) => <div role="listitem" className="xai-layer-row" key={node.id}>
            <button className={`xai-layer ${selectedNodeId === node.id ? "active" : ""}`} aria-pressed={selectedNodeId === node.id} onClick={() => selectLayer(node.id)}>{node.type === "image" ? <img src={node.src} alt="" /> : <LayoutGrid />}<span>{node.label || "未命名图层"}<small>{node.type === "video" ? "视频" : "图片"} · {node.width} × {node.height}</small></span></button>
            <button className="studio-icon-button xai-layer-remove" aria-label={`移除图层 ${node.label || "未命名图层"}`} onClick={() => { removeCanvasNode(node.id); if (currentImage?.id === node.id) setField("currentImage", null); }}><X /></button>
          </div>)}
          {sources.map((source, index) => <div className="xai-layer-row" role="listitem" key={source.path}><button className={`xai-layer ${selectedNodeId === `source-preview:${source.path}` ? "active" : ""}`} aria-pressed={selectedNodeId === `source-preview:${source.path}`} onClick={() => void viewSourceOnCanvas(index)}><img src={historyPreviewSrc(source, null)} alt="" /><span>{source.name}<small>参考图</small></span></button><button className="studio-icon-button xai-layer-remove" aria-label={`删除参考图 ${source.name}`} onClick={() => removeSource(index)}><X /></button></div>)}
          {!canvasNodes.length && !sources.length && <p className="xai-pro-note">添加图片，或从作品中选择。</p>}
        </div>
        <details className="xai-pro-section" open><summary>创作参数<ChevronDown /></summary><div className="xai-pro-fields">
          <label className="xai-field">上游<select value={activeProfileId} onChange={(event) => void setActiveProfile(event.target.value)} disabled={!profiles.length}>{!profiles.length && <option value="">请在设置中添加上游</option>}{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label>
          <label className="xai-field">图像模型<select value={imageModelID} disabled={!modelIDs.length} onChange={(event) => setField("imageModelID", event.target.value)}>{!modelIDs.length && <option value="">请在设置中添加模型</option>}{modelIDs.map((id) => <option value={id} key={id}>{id}</option>)}</select></label>
          <label className="xai-field">图像尺寸<select value={size} onChange={(event) => setField("size", event.target.value as SizeValue)}>{sizeOptions.map((value) => <option value={value} key={value}>{formatSizeValue(value)}</option>)}</select></label>
          <div className="xai-pro-field-pair"><label className="xai-field">格式<select value={outputFormat} onChange={(event) => setField("outputFormat", event.target.value as typeof outputFormat)}>{["png", "jpeg", "webp"].map((value) => <option key={value} value={value}>{value.toUpperCase()}</option>)}</select></label><label className="xai-field">张数<select value={batchCount} onChange={(event) => setField("batchCount", Number(event.target.value))}>{Array.from(new Set([batchCount, 1, 2, 3, 4, 6, 9])).sort((a, b) => a - b).map((value) => <option key={value} value={value}>{value} 张</option>)}</select></label></div>
          <label className="xai-field">生成质量<select value={quality} onChange={(event) => setField("quality", normalizeQualitySelection(event.target.value, imageModelID))}>{availableQualityOptions(imageModelID).map((option) => <option value={option.value} key={option.value}>{option.value === "high" ? "高" : option.label}</option>)}</select></label>
          <label className="xai-field">参考图保真<select value={inputFidelity} onChange={(event) => setField("inputFidelity", event.target.value as typeof inputFidelity)}><option value="auto">自动</option><option value="high">高</option><option value="low">低</option></select></label>
          <label className="xai-field">提示词<textarea ref={promptRef} value={prompt} onChange={(event) => setField("prompt", event.target.value)} placeholder="描述画面、光线与细节…" rows={5} /></label>
        </div></details>
        <details className="xai-pro-section"><summary>批量创作<ChevronDown /></summary><div className="xai-pro-embedded">
          <LoopGenerationSection value={state.loopGeneration} onChange={(value) => setField("loopGeneration", value)} />
          <BatchProcessSection currentImageSavedPath={currentImage?.savedPath} editSourceMode={editSourceMode} batchProcess={batchProcess} setEditSourceMode={(value) => { setField("editSourceMode", value); if (value === "batch") setField("mode", "edit"); }} setBatchProcess={(value) => setField("batchProcess", value)} onChooseInputDir={() => void chooseBatchInputDir()} onChooseInputFiles={() => void chooseBatchInputFiles()} onRefreshInputDir={() => void refreshBatchInputDir()} onChooseOutputDir={() => { void ChooseDirectory("选择批处理输出目录").then((directory) => { if (directory) setField("batchProcess", { ...useStudioStore.getState().batchProcess, outputMode: "custom_dir", outputDir: directory }); }).catch(() => pushToast("无法打开目录选择器", "warn")); }} />
        </div></details>
        <details className="xai-pro-section"><summary>视频创作<ChevronDown /></summary><div className="xai-pro-embedded"><VideoGenerationPanel /></div></details>
      </aside>}
      <main className="xai-canvas" aria-label="无限画布">
        <div className="xai-canvas-toolbar studio-glass" role="toolbar" aria-label="画布工具">
          <button className="studio-button" aria-pressed={tool === "pan"} title="选择或移动图层，按住空格平移画布" onClick={() => executeCanvasCommand("select")}><MousePointer2 /><span>选择</span></button>
          <button className="studio-button" aria-pressed={tool === "mask"} disabled={!canEdit} onClick={() => executeCanvasCommand("mask")}><Brush /><span>局部绘制</span></button>
          <button className="studio-button" aria-pressed={tool === "annotate"} disabled={!canEdit} onClick={() => executeCanvasCommand("annotate")}><Type /><span>标注</span></button>
          <span className="xai-toolbar-separator" />
          <button className="studio-icon-button" aria-label="撤销" disabled={!undoStack.length} onClick={undo}><Undo2 /></button><button className="studio-icon-button" aria-label="重做" disabled={!redoStack.length} onClick={redo}><Redo2 /></button>
          <details ref={menuRef} className="xai-canvas-more"><summary aria-label="更多画布操作"><MoreHorizontal /></summary><div className="xai-canvas-menu" onClick={(event) => { if ((event.target as HTMLElement).closest("button:enabled")) menuRef.current?.removeAttribute("open"); }}>
            <button disabled={!canTransform} onClick={() => executeCanvasCommand("rotate-left")}><RotateCcw />左转 90°</button><button disabled={!canTransform} onClick={() => executeCanvasCommand("rotate-right")}><RotateCw />右转 90°</button><button disabled={!canTransform} onClick={() => executeCanvasCommand("flip-horizontal")}><FlipHorizontal />水平翻转</button><button disabled={!canTransform} onClick={() => executeCanvasCommand("flip-vertical")}><FlipVertical />垂直翻转</button><button disabled={!canTransform} onClick={() => executeCanvasCommand("crop")}><Crop />{cropRect ? "裁剪选区" : "选择裁剪区域"}</button>
            <button disabled={!currentImage} onClick={() => executeCanvasCommand("save")}><Download />另存为…</button><button disabled={batchResults.length < 2} onClick={() => resultGridOpen ? closeResultGrid() : openResultGrid()}><LayoutGrid />{resultGridOpen ? "返回当前图片" : "查看本批结果"}</button><button onClick={openHistoryTimeline}><Layers />浏览作品</button>
          </div></details>
          <button className="studio-icon-button" aria-label="适应画布" title="适应画布" onClick={() => executeCanvasCommand("fit")}><Expand /></button>
          <select className="xai-zoom-select" aria-label="画布缩放" value={String(zoom)} onChange={(event) => setZoom(Number(event.target.value))}>{Array.from(new Set([zoom, 0.25, 0.5, 1, 1.5, 2, 4])).sort((a, b) => a - b).map((scale) => <option key={scale} value={scale}>{Math.round(scale * 100)}%</option>)}</select>
        </div>
        {tool === "mask" && <div className="xai-tool-options" role="group" aria-label="蒙版选项"><button className="studio-button" aria-pressed={brushMode === "paint"} onClick={() => setField("brushMode", "paint")}><Brush />绘制</button><button className="studio-button" aria-pressed={brushMode === "erase"} onClick={() => setField("brushMode", "erase")}><Eraser />擦除</button><label>画笔大小<input aria-label="画笔大小" type="range" min={4} max={160} value={brushSize} onChange={(event) => setField("brushSize", Number(event.target.value))} /><output>{brushSize}</output></label><button className="studio-button" onClick={() => void importMaskImage()}>导入蒙版</button><button className="studio-button" onClick={resetMask}>清空蒙版</button></div>}
        {tool === "annotate" && <div className="xai-tool-options" role="group" aria-label="标注选项"><label>标注类型<select value={annotationKind} onChange={(event) => setField("annotationKind", event.target.value as typeof annotationKind)}><option value="text">文字</option><option value="rect">矩形</option><option value="arrow">箭头</option><option value="freehand">自由绘制</option></select></label><label>颜色<input aria-label="标注颜色" type="color" value={annotationColor} onChange={(event) => setField("annotationColor", event.target.value)} /></label><button className="studio-button" onClick={clearAnnotations}>清空标注</button>{cropRect && <button className="studio-button" disabled={!canTransform} onClick={() => executeCanvasCommand("crop")}><Crop />裁剪选区</button>}</div>}
        {compareB && <div className="xai-tool-options"><label>对比位置<input aria-label="对比位置" type="range" min={0} max={100} value={Math.round(compareSplit * 100)} onChange={(event) => setCompareSplit(Number(event.target.value) / 100)} /></label><button className="studio-button" onClick={() => setCompareB(null)}>结束对比</button></div>}
        <div className="xai-pro-progress"><XAIProgress isRunning={isRunning} progress={progress} jobsCompleted={jobsCompleted} jobsTotal={jobsTotal} /></div>
        <div className="xai-live-canvas"><CanvasStage /></div>
      </main>
      {inspectorOpen && <aside id="pro-inspector" className="xai-pro-right" aria-label="所选图层属性">
        <div className="xai-pro-panel-header"><h2>属性</h2><button className="studio-icon-button" aria-label="收起属性" onClick={() => executeCanvasCommand("toggle-inspector")}><PanelRightClose /></button></div>
        {hasSelection ? <>
          {selectedNode?.type === "video" ? <video className="xai-inspector-image" src={selectedPreview} controls /> : <img className="xai-inspector-image" src={selectedPreview} alt={selectedTitle} />}
          <div className="xai-inspector-meta"><h3>{selectedTitle}</h3><span>{dimensions} · {selectedNode?.type === "video" ? "视频" : "图片"}</span></div>
          {selectedNode?.type !== "video" && <button className="studio-button xai-apply" disabled={!selectedItem && !selectedSource} onClick={() => void applyToCanvas()}><ImagePlus />应用到画布</button>}
          <details className="xai-pro-section" open><summary>提示词<ChevronDown /></summary><div className="xai-property-heading"><button className="studio-button" disabled={!selectedItem?.prompt} onClick={() => void copyText(selectedItem?.prompt || "")}><Copy />复制</button></div><p className="xai-property-content">{selectedItem?.prompt || "这张素材还没有提示词。"}</p></details>
          <details className="xai-pro-section" open><summary>图像参数<ChevronDown /></summary><dl className="xai-property-list">{properties.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><button className="studio-button" onClick={() => void copyText(JSON.stringify(Object.fromEntries(properties), null, 2))}><Copy />复制参数</button></details>
          <details className="xai-pro-section"><summary>参考图与对比<ChevronDown /></summary><div className="xai-inspector-actions">{sources.map((source, index) => <button className="studio-button" disabled={!currentImage} key={source.path} onClick={() => void compareSourceOnCanvas(index)}>{source.name}<span>对比</span></button>)}{!sources.length && <p className="xai-pro-note">添加参考图后可对比。</p>}</div></details>
          <div className="xai-inspector-actions"><button className="studio-button" disabled={!selectedItem} onClick={() => selectedItem && void openResultDetail(selectedItem)}>查看详情</button><button className="studio-button" disabled={!currentImage} onClick={() => executeCanvasCommand("save")}><Download />另存为…</button>{selectedItem && <DragExportHandle item={selectedItem} className="studio-button" />}</div>
        </> : <div className="xai-inspector-empty"><MousePointer2 /><p>选择图层以查看属性</p><button className="studio-button" onClick={openHistoryTimeline}>浏览作品</button></div>}
      </aside>}
    </div>
  </div>;
}
