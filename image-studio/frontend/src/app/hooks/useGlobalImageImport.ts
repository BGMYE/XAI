import { useEffect, useState } from "react";
import type { HistoryItem } from "../../types/domain";
import { INTERNAL_HISTORY_ITEM_MIME, readInternalHistoryItemDragData } from "../../lib/dragExport.ts";
import { hasDesktopSettingsHost } from "../../platform/runtime/desktop";
import { EventsOn } from "../../platform/runtime/host";
import { useStudioStore } from "../../state/studioStore";
import { acceptDesktopDroppedImages, type DesktopDroppedImages } from "./desktopDrop";

function hasTransferType(types: readonly string[] | DOMStringList | undefined, expected: string): boolean {
  if (!types) return false;
  return Array.from(types).includes(expected);
}

export function useGlobalImageImport(
  importImageFile: (file: File) => Promise<void>,
  importHistoryItem: (item: HistoryItem) => Promise<void>,
) {
  const [dragHover, setDragHover] = useState(false);

  useEffect(() => {
    let depth = 0;
    const nativeDesktop = hasDesktopSettingsHost();
    // Wails' own target highlighting also covers native macOS/Linux drag events.
    if (nativeDesktop) document.documentElement.setAttribute("data-file-drop-target", "");
    const nativeHover = nativeDesktop ? new MutationObserver(() => {
      setDragHover(document.documentElement.classList.contains("file-drop-target-active"));
    }) : null;
    nativeHover?.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    let nativeImports = Promise.resolve();
    const stopNativeDrop = nativeDesktop ? EventsOn("desktop-images-dropped", (result: DesktopDroppedImages) => {
      depth = 0;
      setDragHover(false);
      nativeImports = nativeImports.then(() => acceptDesktopDroppedImages(result,
        (image, name, size) => useStudioStore.getState().acceptImportedImage(image, name, size),
        (errorMessage) => useStudioStore.setState({ errorMessage, errorCanRetry: false, errorRawPath: null }),
      ));
    }) : () => {};

    const onDragEnter = (event: DragEvent) => {
      const types = event.dataTransfer?.types;
      if (hasTransferType(types, INTERNAL_HISTORY_ITEM_MIME)) {
        event.preventDefault();
        return;
      }
      if (!hasTransferType(types, "Files")) return;
      event.preventDefault();
      depth += 1;
      setDragHover(true);
    };

    const onDragOver = (event: DragEvent) => {
      const types = event.dataTransfer?.types;
      if (hasTransferType(types, INTERNAL_HISTORY_ITEM_MIME)) {
        event.preventDefault();
        return;
      }
      if (!hasTransferType(types, "Files")) return;
      event.preventDefault();
    };

    const onDragLeave = (event: DragEvent) => {
      const types = event.dataTransfer?.types;
      if (!hasTransferType(types, "Files") && !hasTransferType(types, INTERNAL_HISTORY_ITEM_MIME)) return;
      event.preventDefault();
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragHover(false);
    };

    const onDrop = (event: DragEvent) => {
      event.preventDefault();
      depth = 0;
      setDragHover(false);

      const internalItem = readInternalHistoryItemDragData(event.dataTransfer);
      if (internalItem) {
        void importHistoryItem(internalItem);
        return;
      }

      // Wails resolves native paths, including Windows drops which also reach
      // this DOM listener. Importing their File objects here would duplicate it.
      if (nativeDesktop) return;

      const files = event.dataTransfer?.files;
      if (!files?.length) return;

      void (async () => {
        for (const file of Array.from(files)) {
          await importImageFile(file);
        }
      })();
    };

    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;

      const items = event.clipboardData?.items;
      if (!items) return;

      for (const item of items) {
        if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
        const file = item.getAsFile();
        if (!file) continue;
        event.preventDefault();
        void importImageFile(file);
        return;
      }
    };

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    document.addEventListener("paste", onPaste);

    return () => {
      stopNativeDrop();
      nativeHover?.disconnect();
      if (nativeDesktop) document.documentElement.removeAttribute("data-file-drop-target");
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
      document.removeEventListener("paste", onPaste);
    };
  }, [importHistoryItem, importImageFile]);

  return { dragHover };
}
