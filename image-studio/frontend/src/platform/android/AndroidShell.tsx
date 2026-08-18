import type { ReactElement } from "react";
import { History, Image as ImageIcon, SlidersHorizontal } from "lucide-react";
import { ControlPanel } from "../../components/panel/ControlPanel";
import { HistoryRail } from "../../components/history/HistoryRail";
import type { AndroidView } from "../types";
import { vibrateForPlatform } from "./bridge";
import { usePlatform } from "../context";
import { AndroidCanvasWorkspace } from "./canvas/AndroidCanvasWorkspace";

export function AndroidShell({
  fullscreen,
  isPad,
  isExpandedPad,
  androidView,
  onChangeView,
}: {
  fullscreen: boolean;
  isPad: boolean;
  isExpandedPad: boolean;
  androidView: AndroidView;
  onChangeView: (value: AndroidView) => void;
}) {
  const { androidOrientation } = usePlatform();
  const isLandscape = androidOrientation === "landscape";
  const showRail = (isPad || isLandscape) && !fullscreen;
  const showBottomNav = !isPad && !isLandscape && !fullscreen;
  const usePadWorkspace = isPad && androidView === "compose" && isExpandedPad && !isLandscape;

  const handleViewChange = (view: AndroidView) => {
    if (view !== androidView) {
      vibrateForPlatform(10);
      onChangeView(view);
    }
  };

  return (
    <>
      <div
        className={`studio ${fullscreen ? "fullscreen" : ""} ${isPad ? "android-pad" : "android-phone"}`}
        data-android-view={androidView}
        data-android-target={isPad ? "android-pad" : "android"}
        data-android-pad-layout={usePadWorkspace ? "workspace" : undefined}
        data-android-pad-density={isPad ? (isExpandedPad ? "expanded" : "medium") : undefined}
      >
        {showRail ? <AndroidRail active={androidView} onChange={handleViewChange} /> : null}
        <ControlPanel
          onAndroidSubmitStart={() => {
            if (androidView !== "canvas") onChangeView("canvas");
          }}
        />
        <div className="canvas-shell">
          <AndroidCanvasWorkspace />
        </div>
        <HistoryRail />
      </div>
      {showBottomNav ? <AndroidBottomNav active={androidView} onChange={handleViewChange} /> : null}
    </>
  );
}

function AndroidRail({
  active,
  onChange,
}: {
  active: AndroidView;
  onChange: (value: AndroidView) => void;
}) {
  return (
    <nav className="android-rail" style={{ paddingLeft: "env(safe-area-inset-left, 12px)" }} aria-label="Android Pad navigation">
      <AndroidNavButton icon={<SlidersHorizontal />} label="参数" active={active === "compose"} onClick={() => onChange("compose")} />
      <AndroidNavButton icon={<ImageIcon />} label="画布" active={active === "canvas"} onClick={() => onChange("canvas")} />
      <AndroidNavButton icon={<History />} label="历史" active={active === "history"} onClick={() => onChange("history")} />
    </nav>
  );
}

function AndroidBottomNav({
  active,
  onChange,
}: {
  active: AndroidView;
  onChange: (value: AndroidView) => void;
}) {
  return (
    <nav className="android-bottom-nav" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)", paddingLeft: "env(safe-area-inset-left, 12px)", paddingRight: "env(safe-area-inset-right, 12px)" }} aria-label="Android navigation">
      <AndroidNavButton icon={<SlidersHorizontal />} label="参数" active={active === "compose"} onClick={() => onChange("compose")} />
      <AndroidNavButton icon={<ImageIcon />} label="画布" active={active === "canvas"} onClick={() => onChange("canvas")} />
      <AndroidNavButton icon={<History />} label="历史" active={active === "history"} onClick={() => onChange("history")} />
    </nav>
  );
}

function AndroidNavButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: ReactElement;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`android-nav-button ${active ? "active" : ""}`} onClick={onClick} aria-current={active ? "page" : undefined}>
      <span className="android-nav-icon">{icon}</span>
      <span className="android-nav-label">{label}</span>
    </button>
  );
}
