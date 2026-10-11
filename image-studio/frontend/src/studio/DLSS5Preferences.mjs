import { defaultDLSS5Options, validateDLSS5Options } from "./DLSS5Options.mjs";
const key = "xai-studio-dlss5-options-v1";
const presets = {
  natural: { style: 1, intensity: 0.45, localTone: 0.35, localStructure: 0.4, skinStructure: 0.25, outputMix: 0.75, autoMask: true },
  detail: { style: 0, intensity: 0.8, localTone: 0.5, localStructure: 0.85, skinStructure: 0.4, outputMix: 0.9, autoMask: true },
  cinematic: { style: 2, intensity: 0.65, localTone: 0.7, localStructure: 0.55, skinStructure: 0.35, outputMix: 0.8, autoMask: true },
};
/** Presets only change existing appearance controls, never flow or dimensions. */
export function applyDLSS5Preset(options, preset) {
  return { ...options, ...(presets[preset] ?? {}) };
}
export function selectedDLSS5Preset(options) {
  return Object.entries(presets).find(([, preset]) => Object.entries(preset).every(([name, value]) => options[name] === value))?.[0] ?? "custom";
}
function cleanOptions(options) {
  const clean = Object.fromEntries(Object.keys(defaultDLSS5Options()).map(name => [name, options[name]]));
  for (const name of ["previewResolution", "exportResolution"]) {
    const value = options[name];
    clean[name] = { mode: value?.mode, width: value?.width, height: value?.height };
  }
  return clean;
}
export function loadDLSS5Preferences(storage) {
  try {
    const value = JSON.parse((storage ?? globalThis.localStorage)?.getItem(key) ?? "null");
    if (!value || typeof value.enabled !== "boolean" || validateDLSS5Options({ ...value, enabled: true })) return defaultDLSS5Options();
    return cleanOptions(value);
  } catch { return defaultDLSS5Options(); }
}
export function saveDLSS5Preferences(options, storage) {
  // Incomplete numeric edits must not replace the last valid settings.
  if (typeof options?.enabled !== "boolean" || validateDLSS5Options({ ...options, enabled: true })) return false;
  try {
    const destination = storage ?? globalThis.localStorage;
    if (!destination) return false;
    destination.setItem(key, JSON.stringify(cleanOptions(options)));
    return true;
  } catch { return false; }
}
