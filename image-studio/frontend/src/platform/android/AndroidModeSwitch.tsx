import { ImageIcon, PenSquare } from "lucide-react";
import type { Mode } from "../../types/domain";

export function AndroidModeSwitch({
  mode,
  onChange,
  variant,
}: {
  mode: Mode;
  onChange: (next: Mode) => void;
  variant: "phone" | "pad";
}) {
  return (
    <div className={`android-mode-switch android-mode-switch-${variant}`}>
      {([
        { value: "generate" as Mode, label: "文生图", icon: PenSquare },
        { value: "edit" as Mode, label: "图生图", icon: ImageIcon },
      ]).map((item) => {
        const active = mode === item.value;
        const Icon = item.icon;
        return (
          <button
            key={item.value}
            type="button"
            onClick={() => onChange(item.value)}
            className={`android-mode-switch-button ${active ? "active" : ""}`}
          >
            <Icon className="h-3.5 w-3.5" />
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
