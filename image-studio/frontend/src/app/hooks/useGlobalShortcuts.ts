import { useEffect } from "react";
import { useStudioStore } from "../../state/studioStore";

export function useGlobalShortcuts({ isMac }: { isMac: boolean }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const meta = event.ctrlKey || event.metaKey;
      if (!meta) return;

      const target = event.target as HTMLElement | null;
      const inField = !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      const key = event.key.toLowerCase();
      const state = useStudioStore.getState();

      if (key === "enter") {
        event.preventDefault();
        state.submit();
        return;
      }

      if (inField) return;

      if (key === "n") {
        event.preventDefault();
        state.newWorkspace();
      } else if (key === "w") {
        event.preventDefault();
        if (state.workspaces.length > 1) state.closeWorkspace(state.activeWorkspaceId);
      } else if (isMac && event.ctrlKey && event.metaKey && key === "f") {
        event.preventDefault();
        void state.toggleFullscreen();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isMac]);
}
