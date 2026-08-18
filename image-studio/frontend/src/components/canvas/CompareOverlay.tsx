import { useEffect, useRef } from "react";
import { useBlobURL } from "../../lib/images";

export function CompareOverlay({
  aBlob, aB64, aUrl, bBlob, bB64, bUrl, split, onSplit, aLabel = "当前图", bLabel = "对比图",
}: {
  aBlob: Blob | null;
  aB64?: string | null;
  aUrl?: string | null;
  bBlob: Blob | null;
  bB64?: string | null;
  bUrl?: string | null;
  split: number;
  onSplit: (v: number) => void;
  aLabel?: string;
  bLabel?: string;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const aURL = useBlobURL(aBlob, aBlob ? null : aB64);
  const bURL = useBlobURL(bBlob, bBlob ? null : bB64);
  const aSrc = aURL || aUrl || "";
  const bSrc = bURL || bUrl || "";

  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!draggingRef.current || !wrapRef.current) return;
      const r = wrapRef.current.getBoundingClientRect();
      const x = e.clientX - r.left;
      onSplit(x / r.width);
    };
    const up = () => { draggingRef.current = false; };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [onSplit]);

  const pct = Math.round(split * 100);
  return (
    <div ref={wrapRef} style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <img
        src={aSrc}
        draggable={false}
        style={{
          position: "absolute", inset: 0, width: "100%", height: "100%",
          objectFit: "contain", userSelect: "none",
          clipPath: `inset(0 ${100 - pct}% 0 0)`,
        }}
      />
      <img
        src={bSrc}
        draggable={false}
        style={{
          position: "absolute", inset: 0, width: "100%", height: "100%",
          objectFit: "contain", userSelect: "none",
          clipPath: `inset(0 0 0 ${pct}%)`,
        }}
      />
      <div
        onMouseDown={(e) => { e.preventDefault(); draggingRef.current = true; }}
        style={{
          position: "absolute",
          top: 0, bottom: 0,
          left: `${pct}%`,
          width: 3, marginLeft: -1.5,
          background: "#7e5cff",
          cursor: "ew-resize",
          boxShadow: "0 0 0 1px rgba(0,0,0,0.4)",
        }}
      >
        <div style={{
          position: "absolute",
          top: "50%", left: "50%",
          transform: "translate(-50%, -50%)",
          width: 24, height: 24, borderRadius: "50%",
          background: "#7e5cff",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "#fff", fontSize: 12,
        }}>⇆</div>
      </div>
      <div style={{ position: "absolute", top: 8, left: 8, background: "rgba(0,0,0,0.55)", padding: "2px 8px", borderRadius: 4, fontSize: 11, color: "#9ec5ff" }}>{`A · ${aLabel}`}</div>
      <div style={{ position: "absolute", top: 8, right: 8, background: "rgba(0,0,0,0.55)", padding: "2px 8px", borderRadius: 4, fontSize: 11, color: "#cdb8ff" }}>{`B · ${bLabel}`}</div>
    </div>
  );
}
