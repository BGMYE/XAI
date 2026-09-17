import { hasDesktopSettingsHost, invokeDesktopHost } from "./desktop";

type Preferences = { dark?: boolean; reduceTransparency?: boolean; reduceMotion?: boolean; highContrast?: boolean };

export function installDesktopAppearance() {
  const root = document.documentElement;
  const platform = root.dataset.platform ?? "";
  if (platform.startsWith("android") || /Android/i.test(navigator.userAgent)) return;
  root.dataset.desktopStudio = "true";
  const queries = {
    reduceTransparency: matchMedia("(prefers-reduced-transparency: reduce)"),
    reduceMotion: matchMedia("(prefers-reduced-motion: reduce)"),
    highContrast: matchMedia("(prefers-contrast: more)"),
  };
  let system: Preferences = {};
  const apply = () => {
    root.classList.remove("dark");
    root.dataset.theme = "light";
    root.dataset.appearance = "light";
    root.style.colorScheme = "light";
    root.style.backgroundColor = "#F5F5F7";
    root.dataset.reduceTransparency = String(system.reduceTransparency === true || queries.reduceTransparency.matches);
    root.dataset.reduceMotion = String(system.reduceMotion === true || queries.reduceMotion.matches);
    root.dataset.highContrast = String(system.highContrast === true || queries.highContrast.matches);
  };
  let reading = false;
  const refresh = async () => {
    if (!hasDesktopSettingsHost() || reading) return;
    reading = true;
    try { system = await invokeDesktopHost<Preferences>("GetSystemPreferences"); apply(); }
    catch { apply(); }
    finally { reading = false; }
  };
  Object.values(queries).forEach((query) => query.addEventListener("change", () => { apply(); void refresh(); }));
  window.addEventListener("focus", () => { void refresh(); });
  apply(); void refresh();
  // Some WebViews do not issue media-query changes for accessibility settings.
  if (hasDesktopSettingsHost()) window.setInterval(() => { if (!document.hidden) void refresh(); }, 5000);
}
