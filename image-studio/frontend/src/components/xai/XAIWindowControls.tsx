import { Maximize2, Minus, X } from "lucide-react";
import type { MouseEvent } from "react";
import { getRuntime } from "../../platform/runtime/hostBindings.ts";
import "./xai-window-controls.css";

const controls = [
  { action: "Quit", label: "关闭窗口", color: "red", Icon: X },
  { action: "WindowMinimise", label: "最小化窗口", color: "yellow", Icon: Minus },
  { action: "WindowToggleMaximise", label: "最大化或还原窗口", color: "green", Icon: Maximize2 },
] as const;

export function handleWindowTitleBarDoubleClick(event: MouseEvent<HTMLElement>, onUnavailable: () => void) {
  if ((event.target as HTMLElement).closest(".no-drag")) return;
  const runtime = getRuntime();
  if (typeof runtime?.WindowToggleMaximise !== "function") {
    onUnavailable();
    return;
  }
  runtime.WindowToggleMaximise();
}

export function XAIWindowControls({ onUnavailable }: { onUnavailable: () => void }) {
  const invoke = (action: typeof controls[number]["action"]) => {
    const runtime = getRuntime();
    const operation = runtime?.[action];
    if (typeof operation !== "function") {
      onUnavailable();
      return;
    }
    operation.call(runtime);
  };
  return <div className="xai-traffic no-drag" role="group" aria-label="窗口控制">
    {controls.map(({ action, label, color, Icon }) => <button key={action} type="button" className="xai-window-control no-drag" aria-label={label} title={label} onClick={() => invoke(action)}>
      <span className={`xai-window-control-dot ${color}`}><Icon size={9} strokeWidth={2.5} aria-hidden="true" /></span>
    </button>)}
  </div>;
}
