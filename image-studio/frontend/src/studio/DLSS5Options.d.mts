import type { DLSS5Options } from "./types";

export function defaultDLSS5Options(): DLSS5Options;
export function validateDLSS5Options(options: DLSS5Options): string | null;
export function validateDLSS5Clip(positionSeconds: number, durationSeconds: number): string | null;
/** Returns the reduced width:height ratio, or an em dash for invalid dimensions. */
export function dlss5AspectRatio(width: number, height: number): string;
export function generationParameters(kind: import("./types").Kind, parameters: import("./types").Parameters): import("./types").Parameters;
