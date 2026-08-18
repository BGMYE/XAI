import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import { useStudioStore } from "../../state/studioStore";
import { usePlatform } from "../../platform/context";
import { WorkspaceTabItem } from "./WorkspaceTabItem";

// Browser-tab style strip. 每个 tab = 独立 workspace,历史栏共享。
// 单 workspace 时不显示。
export function WorkspaceBar() {
  const { workspaces, activeWorkspaceId, newWorkspace, switchWorkspace, closeWorkspace, renameWorkspace, fullscreen } = useStudioStore();
  const { isAndroidPhone, isMac, isWindows, usesFluentUI, usesAppleUI } = usePlatform();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const barRef = useRef<HTMLDivElement | null>(null);

  if (fullscreen) return null;
  if (isAndroidPhone) return null;
  if (workspaces.length <= 1) return null;

  function startRename(id: string, currentName: string) {
    setEditingId(id);
    setEditingName(currentName);
  }
  function commitRename() {
    if (editingId) {
      renameWorkspace(editingId, editingName.trim() || "未命名");
    }
    setEditingId(null);
  }

  function handleWheel(event: React.WheelEvent<HTMLDivElement>) {
    if (event.defaultPrevented || event.ctrlKey) return;
    const container = barRef.current;
    if (!container) return;
    if (container.scrollWidth <= container.clientWidth + 1) return;
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    event.preventDefault();
    container.scrollLeft += event.deltaY;
  }

  return (
    <div
      ref={barRef}
      onWheel={handleWheel}
      className={`${isWindows ? "workspace-bar" : ""} drag-region flex items-center overflow-x-auto border-b border-[var(--border)] bg-[var(--toolbar)] backdrop-blur-2xl ${usesAppleUI ? "liquid-glass-bar" : ""} ${usesFluentUI ? "gap-1 px-3 py-1.5" : isMac ? "mac-workspace-bar gap-1.5 py-1.5" : "gap-1 px-4 py-1.5"}`}
    >
      {workspaces.map((w) => {
        const active = w.id === activeWorkspaceId;
        const isEditing = editingId === w.id;
        return (
          <WorkspaceTabItem
            key={w.id}
            workspace={w}
            active={active}
            editingName={editingName}
            isEditing={isEditing}
            onChangeEditingName={setEditingName}
            onClose={() => closeWorkspace(w.id)}
            onCommitRename={commitRename}
            onSelect={() => switchWorkspace(w.id)}
            onStartRename={() => startRename(w.id, w.name)}
            onStopEditing={() => setEditingId(null)}
          />
        );
      })}
      <button
        type="button"
        onClick={() => newWorkspace()}
        title="新建标签页"
        className={`platform-icon-btn no-drag flex shrink-0 items-center justify-center text-zinc-500 transition-colors hover:bg-white/55 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/[0.05] dark:hover:text-zinc-200 ${usesFluentUI ? "h-7.5 w-7.5 rounded-[8px]" : isMac ? "h-8 w-8 rounded-full" : "h-7.5 w-7.5 rounded-full"}`}
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
