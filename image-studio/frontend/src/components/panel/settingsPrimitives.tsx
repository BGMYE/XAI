import { usePlatform } from "../../platform/context";

export function SettingsRow({
  label,
  children,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
}) {
  const { usesFluentUI } = usePlatform();
  return (
    <div className={`platform-card border border-black/[0.05] bg-white/72 px-4 py-3.5 shadow-[var(--shadow-card)] dark:border-white/[0.06] dark:bg-[rgb(29_32_40_/_0.88)] ${usesFluentUI ? "rounded-[12px]" : "rounded-[20px]"}`}>
      <label className="mb-2.5 block text-[11px] font-semibold tracking-[0.04em] text-zinc-700 dark:text-zinc-200">{label}</label>
      {children}
    </div>
  );
}

export function SettingsSegButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const { usesFluentUI } = usePlatform();
  return (
    <button
      type="button"
      onClick={onClick}
      className={`platform-chip inline-flex min-h-[32px] min-w-0 flex-1 items-center justify-center gap-1 px-3 py-2 text-center text-[12px] font-medium leading-tight break-words [overflow-wrap:anywhere] transition-colors ${
        active
          ? "active bg-white text-zinc-900 shadow-sm dark:bg-zinc-900 dark:text-zinc-100"
          : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
      } ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
    >
      {children}
    </button>
  );
}

export function SettingsFact({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-[14px] border border-black/[0.08] bg-[var(--surface)] px-3 py-2 text-left dark:border-white/[0.08]">
      <div className="text-[9px] uppercase tracking-[0.12em] text-zinc-400 dark:text-zinc-500">{label}</div>
      <div className="mt-1 text-[11px] font-medium text-zinc-800 dark:text-zinc-100">{value}</div>
    </div>
  );
}

export type SettingsAnchorItem = {
  id: string;
  title: string;
};

export function SettingsAnchorNav({
  sections,
  activeId,
  onSelect,
}: {
  sections: ReadonlyArray<SettingsAnchorItem>;
  activeId: string;
  onSelect: (id: string) => void;
}) {
  const { usesFluentUI } = usePlatform();

  return (
    <aside className="settings-category-nav" aria-label="设置分类">
      <div className={`settings-anchor-panel px-3.5 py-3.5 ${usesFluentUI ? "rounded-[12px]" : "rounded-[24px]"}`}>
        <div className="settings-anchor-list grid gap-1.5 sm:grid-cols-2 lg:grid-cols-1">
          {sections.map((section, index) => {
            const active = section.id === activeId;
            return (
              <button
                key={section.id}
                type="button"
                aria-pressed={active}
                aria-current={active ? "true" : undefined}
                aria-controls={`settings-${section.id}`}
                onClick={() => onSelect(section.id)}
                className={`settings-anchor-item group w-full px-4 py-3 text-left ${
                  active ? "is-active text-zinc-900 dark:text-zinc-100" : "text-zinc-600 dark:text-zinc-300"
                } ${usesFluentUI ? "rounded-[10px]" : "rounded-[18px]"}`}
                style={{ transitionDelay: `${index * 18}ms` }}
              >
                <span className="flex items-start gap-3">
                  <span
                    className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full border transition-all duration-300 ${
                      active
                        ? "border-[color:var(--accent)] bg-[var(--accent)] shadow-[0_0_0_6px_var(--accent-soft)]"
                        : "border-black/[0.08] bg-white/36 group-hover:border-[color:var(--accent)]/45 group-hover:bg-[var(--accent)]/55 dark:border-white/[0.12] dark:bg-white/[0.08]"
                    }`}
                  />
                  <span className="min-w-0">
                    <span className="block text-[12px] font-semibold leading-5">{section.title}</span>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
}

export function SettingsSection({
  id,
  title,
  active,
  children,
}: {
  id: string;
  title: string;
  active: boolean;
  children: React.ReactNode;
}) {
  if (!active) return null;
  return (
    <section id={id} aria-labelledby={`${id}-title`}>
      <div className="px-1">
        <h4 id={`${id}-title`} className="text-[14px] font-semibold tracking-[-0.01em] text-zinc-900 dark:text-zinc-100">{title}</h4>
      </div>
      <div className="mt-3 flex flex-col gap-3">
        {children}
      </div>
    </section>
  );
}
