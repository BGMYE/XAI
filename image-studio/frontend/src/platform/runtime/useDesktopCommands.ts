import { useEffect } from "react";
import { EventsOn } from "./host";
import { getRuntime } from "./hostBindings";
import { useStudioStore } from "../../state/studioStore";

/** Only mounted in the main entrypoint; native menu actions reuse store actions. */
export function useDesktopCommands() {
  useEffect(() => {
    const dispatch = ({ command }: { command: string }) => {
      const state = useStudioStore.getState();
      if (command === "new-workspace") { state.newWorkspace(); return; }
      if (command === "add-material") { void state.selectSourceImage(); return; }
      if (command === "undo") { state.undo(); return; }
      if (command === "redo") { state.redo(); return; }
      if (["simple", "pro", "library"].includes(command)) {
        window.dispatchEvent(new CustomEvent("studio:navigate", { detail: { view: command } })); return;
      }
      window.dispatchEvent(new CustomEvent("studio:navigate", { detail: { view: "pro" } }));
      requestAnimationFrame(() => requestAnimationFrame(() => window.dispatchEvent(new CustomEvent("studio:canvas-command", { detail: { command } }))));
    };
    const stop = EventsOn("desktop-command", dispatch);
    const edit = (event: Event) => dispatch((event as CustomEvent<{ command: string }>).detail);
    window.addEventListener("studio:edit-command", edit);
    const keydown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === ",") { event.preventDefault(); getRuntime()?.OpenSettings?.(); }
    };
    window.addEventListener("keydown", keydown);
    return () => { stop?.(); window.removeEventListener("keydown", keydown); window.removeEventListener("studio:edit-command", edit); };
  }, []);
}
