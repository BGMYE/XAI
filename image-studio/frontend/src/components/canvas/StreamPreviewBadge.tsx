import { RadioTower } from "lucide-react";
import { usePlatform } from "../../platform/context";

export function StreamPreviewBadge({ compact = false }: { compact?: boolean }) {
  const { isAndroidPhone, usesFluentUI } = usePlatform();
  return (
    <span
      className={`stream-preview-badge ${compact || isAndroidPhone ? "stream-preview-badge-compact" : ""} ${usesFluentUI ? "stream-preview-badge-fluent" : ""}`}
      title="流式预览"
    >
      <RadioTower aria-hidden="true" />
      <span>流式预览</span>
    </span>
  );
}
