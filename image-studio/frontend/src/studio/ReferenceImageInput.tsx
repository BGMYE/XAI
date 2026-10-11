import { useEffect, useRef, useState } from "react";
import { ImagePlus } from "lucide-react";
import { mediaURL } from "./client";
import type { Asset } from "./types";

export function ReferenceImageInput({ asset, disabled, onChoose, onImport, report }: {
  asset?: Asset;
  disabled: boolean;
  onChoose: () => void;
  onImport: (file: File) => void;
  report: (error: unknown) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  // Mounted only on the classic creation page. Text pastes remain native,
  // and an open dialog owns its clipboard instead of changing the reference.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (disabled || event.defaultPrevented || document.querySelector("dialog[open]")) return;
      const files = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith("image/"));
      if (!files.length) return;
      event.preventDefault();
      if (files.length > 1) report(Error("请一次导入一张主参考图片；更多参考图可从已有素材中追加。"));
      else onImport(files[0]);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [disabled, onImport, report]);

  return (
    <button
      type="button"
      className={`studio-reference-dropzone${dragging ? " is-dragging" : ""}`}
      aria-label="导入参考图"
      disabled={disabled}
      onClick={onChoose}
      onDragEnter={(event) => {
        if (disabled || !event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        dragDepth.current++;
        setDragging(true);
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = disabled ? "none" : "copy";
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setDragging(false);
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.files.length) return;
        event.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        if (disabled) return;
        if (event.dataTransfer.files.length > 1) {
          report(Error("请一次导入一张主参考图片；更多参考图可从已有素材中追加。"));
          return;
        }
        onImport(event.dataTransfer.files[0]);
      }}
    >
      {asset ? <img src={mediaURL(asset.id)} alt={asset.name} draggable={false} /> : <ImagePlus size={28} />}
      <span>
        <strong>{asset ? "点击更换参考图" : "点击导入参考图"}</strong>
        {asset && <span className="studio-reference-name">{asset.name}</span>}
        <small>支持本地图片、拖拽或直接粘贴（Ctrl+V / ⌘V）</small>
        <small>PNG、JPEG、WebP、GIF · 单张不超过 20 MB</small>
      </span>
    </button>
  );
}
