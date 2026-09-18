import { useEffect, useRef, useState } from "react";
import { Group, Image as KonvaImage, Rect, Text } from "react-konva";
import type Konva from "konva";
import type { CanvasNode } from "../../state/canvasNodes";
import { useImageFromSource } from "./canvasImage";

export function CanvasNodeShape({ node, selected, source, draggable, onSelect, onMove, onDelete }: {
  node: CanvasNode; selected: boolean; source?: string | null; draggable: boolean;
  onSelect: () => void; onMove: (x: number, y: number) => void; onDelete: () => void;
}) {
  const image = useImageFromSource(null, undefined, node.type === "image" ? (node.src ?? source ?? null) : null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoImageRef = useRef<Konva.Image | null>(null);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (node.type !== "video" || !node.src) { setVideo(null); return; }
    setFailed(false); setPlaying(false);
    const element = document.createElement("video");
    element.muted = true; element.loop = true; element.playsInline = true; element.preload = "metadata"; element.src = node.src;
    videoRef.current = element;
    let raf = 0;
    const draw = () => { if (element.paused || element.ended) return; if (element.readyState >= 2) videoImageRef.current?.getLayer()?.batchDraw(); raf = requestAnimationFrame(draw); };
    const onError = () => setFailed(true);
    const onLoadedData = () => { setVideo(element); videoImageRef.current?.getLayer()?.batchDraw(); };
    const onPlaying = () => { setPlaying(true); cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); };
    const onPause = () => { setPlaying(false); cancelAnimationFrame(raf); raf = 0; };
    element.addEventListener("error", onError); element.addEventListener("loadeddata", onLoadedData); element.addEventListener("playing", onPlaying); element.addEventListener("pause", onPause);
    return () => {
      cancelAnimationFrame(raf); element.pause(); element.removeAttribute("src"); element.load();
      element.removeEventListener("error", onError); element.removeEventListener("loadeddata", onLoadedData); element.removeEventListener("playing", onPlaying); element.removeEventListener("pause", onPause); videoRef.current = null;
    };
  }, [node.type, node.src]);
  const toggleVideo = (e: Konva.KonvaEventObject<MouseEvent>) => { e.cancelBubble = true; const element = videoRef.current; if (!element || failed) return; if (element.paused) void element.play().catch(() => setFailed(true)); else element.pause(); };
  const fontFamily = getComputedStyle(document.documentElement).getPropertyValue("--xai-body-font").trim() || "sans-serif";
  return <Group x={node.x} y={node.y} draggable={draggable} onClick={(e) => { e.cancelBubble = true; onSelect(); }} onTap={(e) => { e.cancelBubble = true; onSelect(); }} onDragEnd={(e) => { e.cancelBubble = true; onMove(e.target.x(), e.target.y()); }}>
    {node.type === "image" && image ? <KonvaImage image={image} width={node.width} height={node.height} /> : null}
    {node.type === "video" && video && !failed ? <KonvaImage ref={videoImageRef} image={video} width={node.width} height={node.height} /> : null}
    {(node.type === "video" && (!video || failed)) || (node.type === "image" && !image) ? <Rect width={node.width} height={node.height} fill="#dbe9fb" /> : null}
    <Rect width={node.width} height={node.height} stroke={selected ? "#2574f5" : "rgba(39,35,32,.18)"} strokeWidth={selected ? 4 : 1} cornerRadius={16} listening={false} />
    {node.type === "video" ? <Text fontFamily={fontFamily} text={failed ? "视频无法预览 · 点击打开" : (playing ? "暂停" : "播放")} x={12} y={12} fill="#235496" fontSize={14} onClick={failed && node.src ? (e) => { e.cancelBubble = true; window.open(node.src, "_blank", "noopener,noreferrer"); } : toggleVideo} /> : null}
    <Text fontFamily={fontFamily} text={node.type === "video" ? "VIDEO" : (node.label ?? "图片")} x={12} y={node.height - 28} fill={selected ? "#235496" : "#365576"} fontSize={13} listening={false} />
    {selected ? <Text fontFamily={fontFamily} text="×" x={node.width - 28} y={6} fill="#235496" fontSize={22} onClick={(e) => { e.cancelBubble = true; onDelete(); }} /> : null}
  </Group>;
}
