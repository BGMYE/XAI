import { useState } from "react";
import { client, isDesktop } from "./client";
import type { Snapshot } from "./types";

export function LibraryMaintenance({
  snapshot,
  refresh,
  report,
}: {
  snapshot: Snapshot;
  refresh(): Promise<void>;
  report(error: unknown): void;
}) {
  const [project, setProject] = useState("");
  const [asset, setAsset] = useState("");
  const [days, setDays] = useState(30);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      await refresh();
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="studio-settings-note library-maintenance">
      <h3>历史归档与回收站</h3>
      <p>画布和素材移入回收站后保留 30 天。仍被画布、任务或提示词引用的素材会保留。</p>
      <fieldset disabled={busy || !isDesktop()}>
        <label>
          归档多少天前的已结束任务
          <input
            type="number"
            min={1}
            max={36500}
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          />
        </label>
        <button
          className="studio-secondary"
          onClick={() =>
            void run(async () => {
              const path = await client.archiveJobs(days);
              setNotice(path ? `已归档：${path}` : "没有符合条件的任务");
            })
          }
        >
          导出并归档历史
        </button>
        <label>
          画布
          <select value={project} onChange={(e) => setProject(e.target.value)}>
            <option value="">选择画布</option>
            {snapshot.projects
              .filter((p) => p.id !== "classic" && !p.deletedAt)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </label>
        <button
          className="studio-secondary"
          disabled={!project}
          onClick={() =>
            void run(async () => {
              await client.libraryAction("TrashProject", project);
              setProject("");
            })
          }
        >
          将画布移入回收站
        </button>
        <label>
          素材
          <select value={asset} onChange={(e) => setAsset(e.target.value)}>
            <option value="">选择素材</option>
            {snapshot.assets
              .filter((a) => !a.deletedAt)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {a.id.slice(0, 8)}
                </option>
              ))}
          </select>
        </label>
        <button
          className="studio-secondary"
          disabled={!asset}
          onClick={() =>
            void run(async () => {
              await client.libraryAction("TrashAsset", asset);
              setAsset("");
            })
          }
        >
          将素材移入回收站
        </button>
        {snapshot.projects
          .filter((p) => p.deletedAt)
          .map((p) => (
            <p key={p.id}>
              {p.name}{" "}
              <button onClick={() => void run(() => client.libraryAction("RestoreProject", p.id))}>
                恢复画布
              </button>
            </p>
          ))}
        {snapshot.assets
          .filter((a) => a.deletedAt)
          .map((a) => (
            <p key={a.id}>
              {a.name}{" "}
              <button onClick={() => void run(() => client.libraryAction("RestoreAsset", a.id))}>
                恢复素材
              </button>
            </p>
          ))}
      </fieldset>
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
