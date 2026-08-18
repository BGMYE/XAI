import { AppHeader } from "../components/layout/AppHeader";
import { WorkspaceBar } from "../components/layout/WorkspaceBar";
import { FooterBar } from "../components/layout/FooterBar";
import { ToastContainer } from "../components/common/ToastContainer";
import { usePlatform } from "../platform/context";
import { useStudioStore } from "../state/studioStore";
import { DropImportOverlay } from "./components/DropImportOverlay";
import { PlatformWorkspace } from "./components/PlatformWorkspace";
import { HistoryTimelineModal } from "../components/history/HistoryTimelineModal";
import { CustomAspectRatioGate } from "./gates/CustomAspectRatioGate";
import { CustomSizeGate } from "./gates/CustomSizeGate";
import { ResultDetailGate } from "./gates/ResultDetailGate";
import { SavePromptGate } from "./gates/SavePromptGate";
import { SettingsPanelGate } from "./gates/SettingsPanelGate";
import { StarPromptGate } from "./gates/StarPromptGate";
import { AppUpdateGate } from "./gates/AppUpdateGate";
import { PromptImportGate } from "./gates/PromptImportGate";
import { UpstreamConfigGate } from "./gates/UpstreamConfigGate";
import { useAndroidView } from "./hooks/useAndroidView";
import { useDesktopPromptImport } from "./hooks/useDesktopPromptImport";
import { useGlobalImageImport } from "./hooks/useGlobalImageImport";
import { useGlobalShortcuts } from "./hooks/useGlobalShortcuts";
import { useStudioBootstrap } from "./hooks/useStudioBootstrap";

export default function App() {
  const fullscreen = useStudioStore((state) => state.fullscreen);
  const importImageFile = useStudioStore((state) => state.importImageFile);
  const reuseAsSource = useStudioStore((state) => state.reuseAsSource);
  const settingsOpen = useStudioStore((state) => state.settingsOpen);
  const openSettings = useStudioStore((state) => state.openSettings);
  const closeSettings = useStudioStore((state) => state.closeSettings);
  const { isMac } = usePlatform();
  const { androidView, setAndroidView } = useAndroidView();
  const { dragHover } = useGlobalImageImport(importImageFile, reuseAsSource);
  const promptImportDialog = useDesktopPromptImport();

  useStudioBootstrap();
  useGlobalShortcuts({ isMac });

  return (
    <div className="app-root relative">
      <div className="liquid-ambient" aria-hidden="true" />

      <AppHeader onOpenSettings={openSettings} />
      <WorkspaceBar />
      <PlatformWorkspace
        fullscreen={fullscreen}
        androidView={androidView}
        onChangeAndroidView={setAndroidView}
      />
      <ToastContainer />
      {dragHover ? <DropImportOverlay /> : null}
      <FooterBar />
      <CustomAspectRatioGate />
      <CustomSizeGate />
      <UpstreamConfigGate />
      <SettingsPanelGate open={settingsOpen} onClose={closeSettings} />
      <HistoryTimelineModal />
      <ResultDetailGate />
      <SavePromptGate />
      <StarPromptGate />
      <AppUpdateGate />
      <PromptImportGate dialog={promptImportDialog} />
    </div>
  );
}
