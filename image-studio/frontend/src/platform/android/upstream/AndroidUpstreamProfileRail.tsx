import { Copy, Plus, RadioTower, Trash2 } from "lucide-react";
import type { UpstreamProfile } from "../../../types/domain";

export function AndroidUpstreamProfileRail({
  profiles,
  selectedId,
  activeProfileId,
  onCreate,
  onDuplicate,
  onDelete,
  onSelect,
}: {
  profiles: UpstreamProfile[];
  selectedId: string;
  activeProfileId: string;
  onCreate: () => void | Promise<void>;
  onDuplicate: () => void | Promise<void>;
  onDelete: () => void | Promise<void>;
  onSelect: (id: string) => void;
}) {
  return (
    <section className="android-upstream-profiles" aria-label="创作源头列表">
      <div className="android-upstream-section-head">
        <span>已存的上游</span>
        <div className="android-upstream-icon-actions">
          <button type="button" onClick={onCreate} title="添入上游">
            <Plus className="h-4 w-4" />
          </button>
          <button type="button" onClick={onDuplicate} disabled={!selectedId} title="复制选中的上游配置">
            <Copy className="h-4 w-4" />
          </button>
          <button type="button" onClick={onDelete} disabled={!selectedId} className="danger" title="删除选中的配置及 API Key 凭据">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="android-upstream-profile-list">
        {profiles.map((profile) => {
          const selected = profile.id === selectedId;
          const active = profile.id === activeProfileId;
          return (
            <button
              key={profile.id}
              type="button"
              className={`android-upstream-profile-item ${selected ? "selected" : ""}`}
              onClick={() => onSelect(profile.id)}
              aria-current={selected ? "true" : undefined}
            >
              <span className={`android-upstream-profile-dot ${active ? "active" : ""}`} />
              <span className="android-upstream-profile-main">
                <strong>{profile.name || "尚未命名的上游"}</strong>
                <small>
                  {profile.apiMode === "responses" ? "Responses" : "Images"}
                  {profile.baseURL ? ` · ${profile.baseURL}` : " · 尚待填写地址"}
                </small>
              </span>
              <span className="android-upstream-profile-mode">
                <RadioTower className="h-3.5 w-3.5" />
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
