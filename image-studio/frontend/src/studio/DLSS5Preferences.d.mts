import type { DLSS5Options } from "./types";
export type DLSS5Preset = "natural" | "detail" | "cinematic" | "custom";
export function applyDLSS5Preset(options: DLSS5Options, preset: DLSS5Preset): DLSS5Options;
export function selectedDLSS5Preset(options: DLSS5Options): DLSS5Preset;
export function loadDLSS5Preferences(storage?: Pick<Storage, "getItem">): DLSS5Options;
export function saveDLSS5Preferences(options: DLSS5Options, storage?: Pick<Storage, "setItem">): boolean;
