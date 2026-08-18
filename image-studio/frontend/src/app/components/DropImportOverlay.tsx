export function DropImportOverlay() {
  return (
    <div className="drop-overlay">
      <div className="drop-message">
        松开鼠标导入图片到画板
        <div style={{ fontSize: 12, opacity: 0.6, marginTop: 8 }}>支持 PNG / JPG / WebP, 最大 50MB</div>
      </div>
    </div>
  );
}
