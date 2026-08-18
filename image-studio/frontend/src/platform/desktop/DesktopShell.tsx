import { ControlPanel } from "../../components/panel/ControlPanel";
import { Toolbar } from "../../components/canvas/Toolbar";
import { SourceStrip } from "../../components/canvas/SourceStrip";
import { CanvasStage } from "../../components/canvas/CanvasStage";
import { StatusBar } from "../../components/canvas/StatusBar";
import { HistoryRail } from "../../components/history/HistoryRail";

export function DesktopShell({
  fullscreen,
}: {
  fullscreen: boolean;
}) {
  return (
    <div className={`studio ${fullscreen ? "fullscreen" : ""}`}>
      <ControlPanel />
      <div className="canvas-shell">
        <Toolbar />
        <SourceStrip />
        <CanvasStage />
        <StatusBar />
      </div>
      <HistoryRail />
    </div>
  );
}
