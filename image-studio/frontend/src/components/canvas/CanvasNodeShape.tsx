import { useEffect, useRef, useState } from "react";
import { Group, Image as KonvaImage, Rect, Text } from "react-konva";
import type Konva from "konva";
import type { CanvasNode } from "../../state/canvasNodes";
import { useImageFromSource } from "./canvasImage";

export type CanvasNodeAppearance = { accent: string; background: string; border: string; text: string; font: string };

export function CanvasNodeShape({ node, selected, source, draggable, appearance, viewScale, fontScale, onSelect, onMove, onDelete }: {
  node: CanvasNode;
  selected: boolean;
  source?: string | null;
  draggable: boolean;
  appearance: CanvasNodeAppearance;
  viewScale: number;
  fontScale: number;
  onSelect: () => void;
  onMove: (x: number, y: number) => void;
  onDelete: () => void;
}) {
  const image = useImageFromSource(null, undefined, node.type === "image" ? (node.src ?? source ?? null) : null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoImageRef = useRef<Konva.Image | null>(null);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (node.type !== "video" || !node.src) { setVideo(null); return; }
    setFailed(false);
    setPlaying(false);
    const element = document.createElement("video");
    element.muted = true;
    element.loop = true;
    element.playsInline = true;
    element.preload = "metadata";
    element.src = node.src;
    videoRef.current = element;
    let raf = 0;
    const draw = () => {
      if (element.paused || element.ended) return;
      if (element.readyState >= 2) videoImageRef.current?.getLayer()?.batchDraw();
      raf = requestAnimationFrame(draw);
    };
    const onError = () => setFailed(true);
    const onLoadedData = () => {
      setVideo(element);
      videoImageRef.current?.getLayer()?.batchDraw();
    };
    const onPlaying = () => {
      setPlaying(true);
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(draw);
    };
    const onPause = () => {
      setPlaying(false);
      cancelAnimationFrame(raf);
      raf = 0;
    };
    element.addEventListener("error", onError);
    element.addEventListener("loadeddata", onLoadedData);
    element.addEventListener("playing", onPlaying);
    element.addEventListener("pause", onPause);
    return () => {
      cancelAnimationFrame(raf);
      element.pause();
      element.removeAttribute("src");
      element.load();
      element.removeEventListener("error", onError);
      element.removeEventListener("loadeddata", onLoadedData);
      element.removeEventListener("playing", onPlaying);
      element.removeEventListener("pause", onPause);
      videoRef.current = null;
    };
  }, [node.type, node.src]);
  const toggleVideo = (e: Konva.KonvaEventObject<MouseEvent>) => { e.cancelBubble = true; const element = videoRef.current; if (!element || failed) return; if (element.paused) void element.play().catch(() => setFailed(true)); else element.pause(); };
  const labelScale = fontScale / viewScale;
  const labelWidth = node.width / labelScale;
  return (
    <Group x={node.x} y={node.y} draggable={draggable} onClick={(e) => { e.cancelBubble = true; onSelect(); }} onTap={(e) => { e.cancelBubble = true; onSelect(); }} onDragEnd={(e) => { e.cancelBubble = true; onMove(e.target.x(), e.target.y()); }}>
      {node.type === "image" && image ? <KonvaImage image={image} width={node.width} height={node.height} /> : null}
      {node.type === "video" && video && !failed ? <KonvaImage ref={videoImageRef} image={video} width={node.width} height={node.height} /> : null}
      {(node.type === "video" && (!video || failed)) || (node.type === "image" && !image) ? <Rect width={node.width} height={node.height} fill={appearance.background} /> : null}
      <Rect width={node.width} height={node.height} stroke={selected ? appearance.accent : appearance.border} strokeWidth={selected ? 3 : 1} strokeScaleEnabled={false} listening={false} />
      <Group y={-32 * labelScale} scaleX={labelScale} scaleY={labelScale}>
        <Rect width={labelWidth} height={30} fill={appearance.background} cornerRadius={[6, 6, 0, 0]} listening={false} />
        <Text text={node.label || (node.type === "video" ? "视频" : "图片")} x={10} y={8} width={Math.max(1, labelWidth - (selected ? 44 : 20))} ellipsis wrap="none" fill={appearance.text} fontFamily={appearance.font} fontSize={14} listening={false} />
        {selected && labelWidth >= 44 ? <Text text="×" x={labelWidth - 30} y={2} width={28} height={28} align="center" fill={appearance.text} fontSize={24} onClick={(e) => { e.cancelBubble = true; onDelete(); }} /> : null}
      </Group>
      {node.type === "video" ? <Group x={12 * labelScale} y={12 * labelScale} scaleX={labelScale} scaleY={labelScale}>
        <Rect width={failed ? 210 : 58} height={32} fill={appearance.background} cornerRadius={8} />
        <Text text={failed ? "视频无法预览 · 点击打开" : (playing ? "暂停" : "播放")} x={10} y={9} fill={appearance.accent} fontFamily={appearance.font} fontSize={14} onClick={failed && node.src ? (e) => { e.cancelBubble = true; window.open(node.src, "_blank", "noopener,noreferrer"); } : toggleVideo} />
      </Group> : null}
    </Group>
  );
}
