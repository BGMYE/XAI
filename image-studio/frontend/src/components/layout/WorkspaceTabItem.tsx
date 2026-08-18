import type { Workspace } from "../../types/domain";
import { usePlatform } from "../../platform/context";
import { X } from "lucide-react";

export function WorkspaceTabItem({
  workspace,
  active,
  editingName,
  isEditing,
  onChangeEditingName,
  onClose,
  onCommitRename,
  onSelect,
  onStartRename,
  onStopEditing,
}: {
  workspace: Workspace;
  active: boolean;
  editingName: string;
  isEditing: boolean;
  onChangeEditingName: (value: string) => void;
  onClose: () => void;
  onCommitRename: () => void;
  onSelect: () => void;
  onStartRename: () => void;
  onStopEditing: () => void;
}) {
  const { isMac, isWindows, usesFluentUI } = usePlatform();

  return (
    <div
      onClick={() => !isEditing && onSelect()}
      onDoubleClick={onStartRename}
      title="双击重命名"
      className={
        `${isWindows ? "workspace-tab" : ""} platform-tab no-drag group flex shrink-0 items-center gap-2 text-[12px] transition-all cursor-pointer ${usesFluentUI ? "h-8 rounded-[10px] px-3" : isMac ? "min-h-[32px] rounded-full px-3.5" : "h-7.5 rounded-full px-3"} ` +
        (active
          ? "active bg-white/90 text-zinc-900 shadow-sm ring-1 ring-black/[0.05] dark:bg-zinc-900/90 dark:text-zinc-100 dark:ring-white/[0.08]"
          : "text-zinc-500 hover:bg-white/55 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/[0.05] dark:hover:text-zinc-200")
      }
    >
      {isEditing ? (
        <input
          className="no-drag w-24 bg-transparent text-[12px] outline-none"
          value={editingName}
          autoFocus
          onChange={(e) => onChangeEditingName(e.target.value)}
          onBlur={onCommitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") onCommitRename();
            if (e.key === "Escape") onStopEditing();
          }}
        />
      ) : (
        <>
          <span className="max-w-[132px] truncate">{workspace.name}</span>
          {workspace.runningJobIds.length > 0 ? (
            <span
              title={`运行中 ${workspace.runningJobIds.length}`}
              className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] shadow-[0_0_6px_rgb(0_122_255_/_0.55)]"
            />
          ) : null}
        </>
      )}
      {!isEditing ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          title="关闭"
          className={`no-drag opacity-0 transition-opacity group-hover:opacity-100 -mr-1 p-1 hover:bg-black/[0.06] dark:hover:bg-white/[0.08] ${usesFluentUI ? "rounded-[6px]" : "rounded-full"}`}
        >
          <X className="h-3 w-3" />
        </button>
      ) : null}
    </div>
  );
}
