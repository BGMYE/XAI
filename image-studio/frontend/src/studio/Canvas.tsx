import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  ArrowDownToLine,
  FileText,
  ImagePlus,
  Minus,
  MousePointer2,
  Plus,
  Redo2,
  Scan,
  StickyNote,
  Trash2,
  Undo2,
  Video,
  Workflow,
  X,
} from "lucide-react";
import { connect, exportTemplate, fitNodes, mergeProject, removeNodes, uid, zoomAt } from "./graph.mjs";
import { downloadText, mediaURL } from "./client";
import type { Asset, Project, StudioNode, Viewport } from "./types";
const labels = { prompt: "提示词", image: "图像生成", video: "视频生成", asset: "素材", note: "便签" };
const icons = { prompt: FileText, image: ImagePlus, video: Video, asset: ImagePlus, note: StickyNote };
type Props = {
  project: Project;
  assets: Asset[];
  onChange(p: Project): void;
  onRun(): void;
  onImport(): void;
  report(e: unknown): void;
  running: boolean;
};
type Change = { before: Project; after: Project };
// A gesture in progress. It is drawn on top of the project and written to it
// once, when the gesture ends, so the app and its autosave see one change per
// drag or zoom instead of one per pointer event.
type Overlay = {
  projectID: string;
  viewport?: Viewport;
  move?: { ids: string[]; dx: number; dy: number; originals: Map<string, StudioNode>; zoom: number };
};
function withOverlay(p: Project, o: Overlay | null): Project {
  if (!o || o.projectID !== p.id) return p;
  let nodes = p.nodes;
  if (o.move) {
    const { ids, dx, dy, originals, zoom } = o.move;
    nodes = p.nodes.map((n) => {
      const old = originals.get(n.id);
      return old && ids.includes(n.id) ? { ...n, x: old.x + dx / zoom, y: old.y + dy / zoom } : n;
    });
  }
  return { ...p, nodes, viewport: o.viewport ?? p.viewport };
}
type NodeActions = {
  begin(e: ReactPointerEvent, node: StudioNode): void;
  connectTo(id: string): void;
  toggleLink(id: string): void;
  pick(id: string): void;
};
// Nodes keep their identity while other nodes move or the view pans, so only
// the nodes that actually change are rendered again.
const NodeView = memo(function NodeView({
  node: n,
  asset,
  selected,
  linking,
  linkSource,
  actions,
}: {
  node: StudioNode;
  asset?: Asset;
  selected: boolean;
  linking: boolean;
  linkSource: boolean;
  actions: NodeActions;
}) {
  const Icon = icons[n.kind];
  return (
    <article
      className={`studio-node ${selected ? "selected" : ""} kind-${n.kind}`}
      style={{ left: n.x, top: n.y }}
      onPointerDown={(e) => actions.begin(e, n)}
    >
      <header>
        <Icon size={16} />
        <strong>{n.title}</strong>
        <span>{labels[n.kind]}</span>
      </header>
      {(n.kind === "image" || n.kind === "video") && (
        <button
          className={`studio-port input ${linking ? "waiting" : ""}`}
          aria-label={`连接到${n.title}`}
          title="先点来源节点的右侧圆点，再点这里"
          onClick={() => actions.connectTo(n.id)}
        />
      )}
      <div className="studio-node-body">
        {asset ? (
          asset.kind === "image" ? (
            <img src={mediaURL(asset.id)} alt={asset.name} loading="lazy" draggable={false} />
          ) : (
            <video src={mediaURL(asset.id)} controls preload="metadata" />
          )
        ) : n.kind === "asset" ? (
          <button className="studio-node-missing" onClick={() => actions.pick(n.id)}>
            选择本地素材
            <br />
            <small>模板不包含原始文件</small>
          </button>
        ) : (
          <>
            <p>
              {n.text ||
                (n.kind === "prompt"
                  ? "在右侧写下你的灵感…"
                  : n.kind === "note"
                    ? "记录想法，不单独触发生成。"
                    : "连接提示词或填写描述")}
            </p>
            {(n.kind === "image" || n.kind === "video") && (
              <small className="studio-node-foot">
                {n.kind === "image" ? "图片 API" : "视频 API"} ·{" "}
                {n.parameters.size || n.parameters.aspectRatio || "上游默认"}
              </small>
            )}
          </>
        )}
      </div>
      <button
        className={`studio-port output ${linkSource ? "active" : ""}`}
        aria-label={`从${n.title}连线`}
        title="点击后选择目标节点左侧圆点"
        onClick={() => actions.toggleLink(n.id)}
      />
    </article>
  );
});
export function Canvas({ project: source, assets, onChange, onRun, onImport, report, running }: Props) {
  const board = useRef<HTMLDivElement>(null);
  const overlay = useRef<Overlay | null>(null),
    settleTimer = useRef<number>();
  const [frame, redraw] = useReducer((n: number) => n + 1, 0);
  const sourceRef = useRef(source);
  sourceRef.current = source;
  // The drawn project: the saved one plus the gesture in progress. `frame`
  // advances whenever the overlay ref changes.
  const project = useMemo(() => withOverlay(source, overlay.current), [source, frame]);
  const latest = useRef(project);
  latest.current = project;
  const [selected, setSelected] = useState<string[]>([]),
    [link, setLink] = useState("");
  const selectedRef = useRef(selected),
    linkRef = useRef(link);
  selectedRef.current = selected;
  linkRef.current = link;
  const undo = useRef<Change[]>([]),
    redo = useRef<Change[]>([]),
    space = useRef(false);
  const drag = useRef<{
    start: { x: number; y: number };
    before: Project;
    originals: Map<string, StudioNode>;
    ids: string[];
    pan: boolean;
  } | null>(null);
  // Writes a pending gesture to the project; a gesture from another canvas is dropped.
  const settle = useCallback(() => {
    window.clearTimeout(settleTimer.current);
    const o = overlay.current;
    overlay.current = null;
    if (!o || o.projectID !== sourceRef.current.id) return;
    onChange(withOverlay(sourceRef.current, o));
    redraw();
  }, [onChange]);
  useEffect(() => () => settle(), [settle]);
  useEffect(() => {
    setSelected([]);
    setLink("");
    undo.current = [];
    redo.current = [];
    drag.current = null;
  }, [source.id]);
  const apply = (next: Project, history = true) => {
    // `next` was derived from the drawn project, so it already holds any
    // pending gesture.
    window.clearTimeout(settleTimer.current);
    overlay.current = null;
    if (history) {
      undo.current = [...undo.current.slice(-49), { before: latest.current, after: next }];
      redo.current = [];
    }
    latest.current = next;
    onChange(next);
    redraw();
  };
  const travel = (back: boolean) => {
    const from = back ? undo.current : redo.current,
      to = back ? redo.current : undo.current;
    const step = from.at(-1);
    if (!step) return;
    try {
      const next = mergeProject(
        back ? step.after : step.before,
        back ? step.before : step.after,
        latest.current,
      );
      from.pop();
      to.push(step);
      apply(next, false);
    } catch (e) {
      report(e);
    }
  };
  useEffect(() => {
    const el = board.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      if (drag.current) return;
      const r = el.getBoundingClientRect();
      // Several wheel events can arrive before a render; build on the newest view.
      const pending = overlay.current?.projectID === sourceRef.current.id ? overlay.current : null;
      const view = pending?.viewport ?? latest.current.viewport;
      overlay.current = {
        ...pending,
        projectID: sourceRef.current.id,
        viewport: zoomAt(
          view,
          { x: e.clientX - r.left, y: e.clientY - r.top },
          view.zoom * Math.exp(-e.deltaY * 0.0015),
        ),
      };
      redraw();
      window.clearTimeout(settleTimer.current);
      settleTimer.current = window.setTimeout(settle, 250);
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [settle]);
  const begin = (e: ReactPointerEvent, node?: StudioNode) => {
    if (e.button !== 0 && e.button !== 1) return;
    if ((e.target as HTMLElement).closest("button,input,textarea,select,video,a,.studio-edge-hit")) return;
    e.preventDefault();
    e.stopPropagation();
    board.current?.focus();
    // The drawn project already includes a pending zoom; settle writes it.
    const before = latest.current;
    settle();
    const current = selectedRef.current;
    const pan = !node || space.current || e.button === 1;
    const ids = pan
      ? []
      : e.shiftKey
        ? current.includes(node!.id)
          ? current
          : [...current, node!.id]
        : current.includes(node!.id)
          ? current
          : [node!.id];
    if (!pan) setSelected(ids);
    else if (!space.current && e.button === 0) setSelected([]);
    const originals = new Map(
      pan ? [] : before.nodes.filter((n) => ids.includes(n.id)).map((n) => [n.id, n]),
    );
    drag.current = { start: { x: e.clientX, y: e.clientY }, before, originals, ids, pan };
    board.current?.setPointerCapture(e.pointerId);
  };
  const move = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.start.x,
      dy = e.clientY - d.start.y;
    // Back at the start, nothing is pending and releasing records no step.
    overlay.current =
      !dx && !dy
        ? null
        : d.pan
          ? {
              projectID: d.before.id,
              viewport: { ...d.before.viewport, x: d.before.viewport.x + dx, y: d.before.viewport.y + dy },
            }
          : {
              projectID: d.before.id,
              move: { ids: d.ids, dx, dy, originals: d.originals, zoom: d.before.viewport.zoom },
            };
    redraw();
  };
  const end = () => {
    const d = drag.current;
    drag.current = null;
    const o = overlay.current;
    if (!d || !o) return;
    overlay.current = null;
    if (o.projectID !== sourceRef.current.id) return;
    const after = withOverlay(sourceRef.current, o);
    undo.current = [...undo.current.slice(-49), { before: d.before, after }];
    redo.current = [];
    latest.current = after;
    onChange(after);
    redraw();
  };
  const add = (kind: StudioNode["kind"]) => {
    const p = latest.current,
      r = board.current?.getBoundingClientRect();
    let x = ((r?.width ?? 900) / 2 - p.viewport.x) / p.viewport.zoom - 124,
      y = ((r?.height ?? 500) / 2 - p.viewport.y) / p.viewport.zoom - 100;
    while (p.nodes.some((n) => Math.abs(n.x - x) < 260 && Math.abs(n.y - y) < 240)) {
      x += 290;
    }
    const n: StudioNode = { id: uid(), kind, x, y, title: labels[kind], text: "", parameters: {} };
    apply({ ...p, nodes: [...p.nodes, n] });
    setSelected([n.id]);
  };
  const current = project.nodes.find((n) => n.id === selected[0]);
  const patch = (value: Partial<StudioNode>) => {
    if (current)
      apply({ ...project, nodes: project.nodes.map((n) => (n.id === current.id ? { ...n, ...value } : n)) });
  };
  const remove = () => {
    apply(removeNodes(latest.current, selected));
    setSelected([]);
  };
  const fit = () =>
    apply({
      ...project,
      viewport: fitNodes(
        project.nodes,
        board.current?.clientWidth ?? 900,
        board.current?.clientHeight ?? 600,
      ),
    });
  // Node handlers read current state through refs, so their identity is stable.
  const handlers = useRef({ begin, connectTo: (_id: string) => {}, toggleLink: (_id: string) => {} });
  handlers.current = {
    begin,
    connectTo: (id: string) => {
      const from = linkRef.current;
      if (!from) return;
      try {
        apply(connect(latest.current, from, id));
        setLink("");
      } catch (e) {
        report(e);
      }
    },
    toggleLink: (id: string) => setLink((value) => (value === id ? "" : id)),
  };
  const actions = useMemo<NodeActions>(
    () => ({
      begin: (e, node) => handlers.current.begin(e, node),
      connectTo: (id) => handlers.current.connectTo(id),
      toggleLink: (id) => handlers.current.toggleLink(id),
      pick: (id) => setSelected([id]),
    }),
    [],
  );
  const assetMap = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]),
    nodeMap = useMemo(() => new Map(project.nodes.map((n) => [n.id, n])), [project.nodes]);
  return (
    <div className="studio-canvas-layout">
      <div
        className="studio-board"
        ref={board}
        tabIndex={0}
        role="region"
        aria-label="无限画布"
        onPointerDown={(e) => begin(e)}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onBlur={() => {
          space.current = false;
          end();
        }}
        onKeyDown={(e) => {
          if ((e.target as HTMLElement).closest("input,textarea,select")) return;
          if (e.code === "Space") {
            space.current = true;
            e.preventDefault();
          }
          if (e.key === "Escape") {
            setLink("");
            setSelected([]);
          }
          if (e.key === "Delete" || e.key === "Backspace") {
            e.preventDefault();
            remove();
          }
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
            e.preventDefault();
            travel(!e.shiftKey);
          }
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
            e.preventDefault();
            travel(false);
          }
        }}
        onKeyUp={(e) => {
          if (e.code === "Space") space.current = false;
        }}
      >
        <div
          className="studio-board-grid"
          style={{
            backgroundSize: `${24 * project.viewport.zoom}px ${24 * project.viewport.zoom}px`,
            backgroundPosition: `${project.viewport.x}px ${project.viewport.y}px`,
          }}
        />
        <div
          className="studio-world"
          style={{
            transform: `translate(${project.viewport.x}px,${project.viewport.y}px) scale(${project.viewport.zoom})`,
          }}
        >
          <svg className="studio-edges" aria-label="工作流连线">
            {project.edges.map((e) => {
              const a = nodeMap.get(e.from),
                b = nodeMap.get(e.to);
              if (!a || !b) return null;
              const x = a.x + 248,
                y = a.y + 58,
                bx = b.x,
                by = b.y + 58,
                d = `M ${x} ${y} C ${x + 100} ${y} ${bx - 100} ${by} ${bx} ${by}`;
              return (
                <g key={e.id}>
                  <path d={d} />
                  <path
                    className="studio-edge-hit"
                    d={d}
                    tabIndex={0}
                    role="button"
                    aria-label="删除连线"
                    onClick={() => apply({ ...project, edges: project.edges.filter((x) => x.id !== e.id) })}
                    onKeyDown={(event) => {
                      if (event.key === "Delete" || event.key === "Enter") {
                        event.stopPropagation();
                        apply({ ...project, edges: project.edges.filter((x) => x.id !== e.id) });
                      }
                    }}
                  >
                    <title>单击删除连线</title>
                  </path>
                </g>
              );
            })}
          </svg>
          {project.nodes.map((n) => (
            <NodeView
              key={n.id}
              node={n}
              asset={n.assetId ? assetMap.get(n.assetId) : undefined}
              selected={selected.includes(n.id)}
              linking={Boolean(link)}
              linkSource={link === n.id}
              actions={actions}
            />
          ))}
        </div>
        {!project.nodes.length && (
          <div className="studio-canvas-empty">
            <Workflow size={48} />
            <h2>把灵感连成工作流</h2>
            <p>
              提示词 → 图像生成 → 视频生成
              <br />
              拖动画布探索，滚轮缩放，自由连接。
            </p>
            <button className="studio-primary" onClick={() => add("prompt")}>
              <Plus size={17} />
              添加第一个节点
            </button>
          </div>
        )}
        <div className="studio-canvas-toolbar" aria-label="画布工具">
          <button title="添加提示词" onClick={() => add("prompt")}>
            <FileText size={18} />
          </button>
          <button title="添加图像生成节点" onClick={() => add("image")}>
            <ImagePlus size={18} />
          </button>
          <button title="添加视频生成节点" onClick={() => add("video")}>
            <Video size={18} />
          </button>
          <button title="添加便签" onClick={() => add("note")}>
            <StickyNote size={18} />
          </button>
          <i />
          <button title="导入参考图" onClick={onImport}>
            <ArrowDownToLine size={18} />
          </button>
          <button title="适配全部" onClick={fit}>
            <Scan size={18} />
          </button>
          <i />
          <button title="撤销 Ctrl+Z" disabled={!undo.current.length} onClick={() => travel(true)}>
            <Undo2 size={18} />
          </button>
          <button title="重做 Ctrl+Shift+Z" disabled={!redo.current.length} onClick={() => travel(false)}>
            <Redo2 size={18} />
          </button>
          <button title="删除选中节点" disabled={!selected.length} onClick={remove}>
            <Trash2 size={18} />
          </button>
        </div>
        {link && (
          <div className="studio-link-hint">
            选择目标节点左侧圆点{" "}
            <button onClick={() => setLink("")} title="取消连线">
              <X size={15} />
            </button>
          </div>
        )}
        <div className="studio-zoom">
          <button
            title="缩小"
            onClick={() =>
              apply(
                {
                  ...project,
                  viewport: zoomAt(project.viewport, { x: 300, y: 250 }, project.viewport.zoom / 1.2),
                },
                false,
              )
            }
          >
            <Minus size={15} />
          </button>
          <span>{Math.round(project.viewport.zoom * 100)}%</span>
          <button
            title="放大"
            onClick={() =>
              apply(
                {
                  ...project,
                  viewport: zoomAt(project.viewport, { x: 300, y: 250 }, project.viewport.zoom * 1.2),
                },
                false,
              )
            }
          >
            <Plus size={15} />
          </button>
        </div>
        <div className="studio-canvas-hint">
          <MousePointer2 size={13} />
          拖动空白平移 · Shift 多选 · Delete 删除
        </div>
      </div>
      <aside className="studio-inspector">
        <div className="studio-section-title">
          <h3>{current ? "节点属性" : "画布设置"}</h3>
          <span>{project.nodes.length} 个节点</span>
        </div>
        {current ? (
          <>
            <label>
              节点名称
              <input
                maxLength={60}
                value={current.title}
                onChange={(e) => patch({ title: e.target.value })}
              />
            </label>
            {current.kind === "asset" ? (
              <label>
                本地素材
                <select value={current.assetId ?? ""} onChange={(e) => patch({ assetId: e.target.value })}>
                  <option value="">请选择素材</option>
                  {assets.map((a) => (
                    <option value={a.id} key={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label>
                {current.kind === "note" ? "便签内容" : "提示词"}
                <textarea
                  rows={7}
                  maxLength={5000}
                  value={current.text ?? ""}
                  onChange={(e) => patch({ text: e.target.value })}
                  placeholder="描述主体、环境、光线和镜头…"
                />
              </label>
            )}
            {(current.kind === "image" || current.kind === "video") && (
              <>
                <label>
                  尺寸（OpenAI 兼容协议）
                  <input
                    value={current.parameters.size ?? ""}
                    placeholder={current.kind === "image" ? "1024x1024" : "1280x720"}
                    onChange={(e) => patch({ parameters: { ...current.parameters, size: e.target.value } })}
                  />
                </label>
                <label>
                  比例（xAI 协议）
                  <select
                    value={current.parameters.aspectRatio ?? ""}
                    onChange={(e) =>
                      patch({ parameters: { ...current.parameters, aspectRatio: e.target.value } })
                    }
                  >
                    <option value="">上游默认</option>
                    {["16:9", "9:16", "1:1", "4:3", "3:4", "3:2", "2:3"].map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </select>
                </label>
                {current.kind === "video" && (
                  <>
                    <label>
                      视频时长 / 秒
                      <input
                        type="number"
                        min={1}
                        max={15}
                        value={current.parameters.seconds ?? ""}
                        placeholder="上游默认"
                        onChange={(e) =>
                          patch({
                            parameters: {
                              ...current.parameters,
                              seconds: e.target.value ? Number(e.target.value) : undefined,
                            },
                          })
                        }
                      />
                    </label>
                    <label>
                      视频分辨率（xAI 协议）
                      <select
                        value={current.parameters.resolution ?? ""}
                        onChange={(e) =>
                          patch({ parameters: { ...current.parameters, resolution: e.target.value } })
                        }
                      >
                        <option value="">上游默认</option>
                        {["480p", "720p", "1080p"].map((x) => (
                          <option key={x}>{x}</option>
                        ))}
                      </select>
                    </label>
                  </>
                )}
              </>
            )}
          </>
        ) : (
          <>
            <label>
              画布名称
              <input
                maxLength={60}
                value={project.name}
                onChange={(e) => apply({ ...project, name: e.target.value })}
              />
            </label>
            <p className="studio-muted">
              图像和视频共用世界坐标。来源右侧圆点连接目标左侧圆点；生成结果自动追加至提交任务时的画布。
            </p>
            <div className="studio-callout">
              工作流会执行全部生成节点，可能产生多次 API 费用。每次成功提交后再运行会创建新任务。
            </div>
          </>
        )}
        <div className="studio-inspector-bottom">
          <button className="studio-primary" disabled={running} onClick={onRun}>
            <Workflow size={17} />
            {running ? "正在提交…" : "运行工作流"}
          </button>
          <button
            className="studio-secondary"
            onClick={() => downloadText(exportTemplate(project), "xai-workflow.json")}
          >
            <ArrowDownToLine size={16} />
            导出无密钥模板
          </button>
          <small>Ctrl / ⌘ + Z 撤销；支持图片结果接入视频节点。</small>
        </div>
      </aside>
    </div>
  );
}
