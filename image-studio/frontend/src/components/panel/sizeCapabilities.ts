import {
  classifyImageModel,
  MAX_OPENAI_IMAGE_ASPECT_RATIO,
  MAX_OPENAI_IMAGE_PIXELS,
  MAX_OPENAI_IMAGE_SIDE,
  MIN_OPENAI_IMAGE_SIDE,
  normalizeImageModel,
  normalizeOpenAIImageSize,
  OPENAI_IMAGE_SIZE_ALIGNMENT,
} from "../../../../../shared/kernel/requestModel.js";
import {
  buildCustomAspectRatioId,
  reduceAspectRatio,
} from "../../lib/customAspectRatios.ts";
import type { APIMode, CustomAspectRatio, RequestPolicy, SizeValue } from "../../types/domain";

export type BuiltinAspectPreset = "auto" | "1:1" | "3:2" | "2:3" | "16:9" | "9:16" | "7:4" | "4:7";
export type AspectPreset = BuiltinAspectPreset | `custom:${string}`;
export type ResolutionPreset = "auto" | "256" | "512" | "1k" | "2k" | "4k";
export type ExactSizeSelection = {
  value: SizeValue;
  width: number;
  height: number;
  label: string;
};

export type ReferenceDimensions = {
  width: number;
  height: number;
};

export interface AspectPresetOption {
  value: AspectPreset;
  label: string;
  w: number;
  h: number;
  auto?: boolean;
  custom?: boolean;
}

type SizeCapabilityInput = {
  apiMode: APIMode;
  requestPolicy: RequestPolicy;
  imageModelID?: string;
};

export {
  MAX_OPENAI_IMAGE_ASPECT_RATIO,
  MAX_OPENAI_IMAGE_PIXELS,
  MAX_OPENAI_IMAGE_SIDE,
  MIN_OPENAI_IMAGE_SIDE,
};

export const ASPECT_PRESETS: AspectPresetOption[] = [
  { value: "auto", label: "Auto", w: 18, h: 18, auto: true },
  { value: "1:1", label: "1:1", w: 18, h: 18 },
  { value: "3:2", label: "3:2", w: 22, h: 14 },
  { value: "2:3", label: "2:3", w: 14, h: 20 },
  { value: "16:9", label: "16:9", w: 24, h: 13 },
  { value: "9:16", label: "9:16", w: 12, h: 22 },
  { value: "7:4", label: "7:4", w: 24, h: 14 },
  { value: "4:7", label: "4:7", w: 14, h: 24 },
];

export const RESOLUTION_PRESETS: Array<{ value: ResolutionPreset; label: string }> = [
  { value: "auto", label: "自动" },
  { value: "256", label: "256" },
  { value: "512", label: "512" },
  { value: "1k", label: "1K" },
  { value: "2k", label: "2K" },
  { value: "4k", label: "4K" },
];

type FlexibleCustomResolution = "1k" | "2k" | "4k";

type SizeLimitConfig = {
  maxSide: number;
  maxPixels: number;
  maxAspectRatio: number;
  alignment: number;
};

type CustomResolutionReference = SizeLimitConfig & {
  area: number;
};

const MIN_OPENAI_IMAGE_ASPECT_RATIO = 1 / MAX_OPENAI_IMAGE_ASPECT_RATIO;

const BUILTIN_ASPECT_DIMENSIONS: Record<Exclude<BuiltinAspectPreset, "auto">, { width: number; height: number }> = {
  "1:1": { width: 1, height: 1 },
  "3:2": { width: 3, height: 2 },
  "2:3": { width: 2, height: 3 },
  "16:9": { width: 16, height: 9 },
  "9:16": { width: 9, height: 16 },
  "7:4": { width: 7, height: 4 },
  "4:7": { width: 4, height: 7 },
};

const SIZE_MATRIX: Record<Exclude<BuiltinAspectPreset, "auto">, Partial<Record<Exclude<ResolutionPreset, "auto">, SizeValue>>> = {
  "1:1": {
    "256": "256x256",
    "512": "512x512",
    "1k": "1024x1024",
    "2k": "2048x2048",
    "4k": "2880x2880",
  },
  "3:2": {
    "1k": "1536x1024",
    "2k": "2048x1360",
    "4k": "3520x2352",
  },
  "2:3": {
    "1k": "1024x1536",
    "2k": "1360x2048",
    "4k": "2352x3520",
  },
  "16:9": {
    "1k": "1536x864",
    "2k": "2048x1152",
    "4k": "3840x2160",
  },
  "9:16": {
    "1k": "864x1536",
    "2k": "1152x2048",
    "4k": "2160x3840",
  },
  "7:4": {
    "1k": "1792x1024",
  },
  "4:7": {
    "1k": "1024x1792",
  },
};

const SIZE_TO_ASPECT: Record<string, BuiltinAspectPreset> = {
  auto: "auto",
  "256x256": "1:1",
  "512x512": "1:1",
  "1024x1024": "1:1",
  "2048x2048": "1:1",
  "2880x2880": "1:1",
  "1536x1024": "3:2",
  "2048x1360": "3:2",
  "3520x2352": "3:2",
  "1024x1536": "2:3",
  "1360x2048": "2:3",
  "2352x3520": "2:3",
  "1536x864": "16:9",
  "2048x1152": "16:9",
  "3840x2160": "16:9",
  "864x1536": "9:16",
  "1152x2048": "9:16",
  "2160x3840": "9:16",
  "1792x1024": "7:4",
  "1024x1792": "4:7",
};

const SIZE_TO_RESOLUTION: Record<string, ResolutionPreset> = {
  auto: "auto",
  "256x256": "256",
  "512x512": "512",
  "1024x1024": "1k",
  "1536x1024": "1k",
  "1024x1536": "1k",
  "1536x864": "1k",
  "864x1536": "1k",
  "1792x1024": "1k",
  "1024x1792": "1k",
  "2048x2048": "2k",
  "2048x1360": "2k",
  "1360x2048": "2k",
  "2048x1152": "2k",
  "1152x2048": "2k",
  "2880x2880": "4k",
  "3520x2352": "4k",
  "2352x3520": "4k",
  "3840x2160": "4k",
  "2160x3840": "4k",
};

const FLEXIBLE_RESOLUTION_PRESETS: ResolutionPreset[] = ["auto", "1k", "2k", "4k"];
const LARGE_RESOLUTION_PRESETS = new Set<ResolutionPreset>(["2k", "4k"]);
const DEFAULT_ASPECT_FROM_AUTO: Exclude<BuiltinAspectPreset, "auto"> = "1:1";
const DEFAULT_RESOLUTION_FROM_AUTO: Exclude<ResolutionPreset, "auto"> = "1k";
const DEFAULT_FLEXIBLE_CUSTOM_RESOLUTION: FlexibleCustomResolution = "1k";
const EXACT_SIZE_LIMITS: SizeLimitConfig = {
  maxSide: MAX_OPENAI_IMAGE_SIDE,
  maxPixels: MAX_OPENAI_IMAGE_PIXELS,
  maxAspectRatio: MAX_OPENAI_IMAGE_ASPECT_RATIO,
  alignment: OPENAI_IMAGE_SIZE_ALIGNMENT,
};
const CUSTOM_RESOLUTION_REFERENCES: Record<FlexibleCustomResolution, CustomResolutionReference> = {
  "1k": { area: 1536 * 1024, maxSide: 1536, maxPixels: MAX_OPENAI_IMAGE_PIXELS, maxAspectRatio: MAX_OPENAI_IMAGE_ASPECT_RATIO, alignment: OPENAI_IMAGE_SIZE_ALIGNMENT },
  "2k": { area: 2048 * 1360, maxSide: 2048, maxPixels: MAX_OPENAI_IMAGE_PIXELS, maxAspectRatio: MAX_OPENAI_IMAGE_ASPECT_RATIO, alignment: OPENAI_IMAGE_SIZE_ALIGNMENT },
  "4k": { area: 3840 * 2160, maxSide: 3840, maxPixels: MAX_OPENAI_IMAGE_PIXELS, maxAspectRatio: MAX_OPENAI_IMAGE_ASPECT_RATIO, alignment: OPENAI_IMAGE_SIZE_ALIGNMENT },
};
const CUSTOM_ASPECT_TOLERANCE = 0.035;
const BUILTIN_ASPECT_TOLERANCE = 0.08;
export const MIN_EXACT_SIZE = 64;
export const MAX_EXACT_SIZE = MAX_OPENAI_IMAGE_SIDE;

function modelFamily(input: { imageModelID?: string }): ReturnType<typeof classifyImageModel> {
  return classifyImageModel(input.imageModelID || "");
}

function normalizedImageModelID(input: { imageModelID?: string }): string {
  return normalizeImageModel(input.imageModelID || "").toLowerCase();
}

function isFlexibleGPTImageModel(input: { imageModelID?: string }): boolean {
  return normalizedImageModelID(input).startsWith("gpt-image-2");
}

function isLegacyGPTImageModel(input: { imageModelID?: string }): boolean {
  const normalized = normalizedImageModelID(input);
  if (normalized.startsWith("gpt-image-2")) return false;
  return normalized.startsWith("gpt-image-1") || normalized.startsWith("chatgpt-image-latest");
}

export function supportsAutomaticSizing(input: SizeCapabilityInput): boolean {
  return isFlexibleGPTImageModel(input) || isLegacyGPTImageModel(input);
}

export function supportsCustomAspectRatios(input: SizeCapabilityInput): boolean {
  return isFlexibleGPTImageModel(input) || (modelFamily(input) === "other" && input.requestPolicy === "compat");
}

export function supportsPreciseSizeControl(input: SizeCapabilityInput): boolean {
  return supportsCustomAspectRatios(input);
}

export function supportsExplicitLargeSizes(input: SizeCapabilityInput): boolean {
  if (isFlexibleGPTImageModel(input)) return true;
  return modelFamily(input) === "other" && input.requestPolicy === "compat";
}

export function availableResolutionPresets(input: SizeCapabilityInput): ResolutionPreset[] {
  const family = modelFamily(input);
  if (family === "dalle2") return ["256", "512", "1k"];
  if (family === "dalle3") return ["1k"];
  if (isLegacyGPTImageModel(input)) return ["auto", "1k"];
  if (supportsExplicitLargeSizes(input)) return FLEXIBLE_RESOLUTION_PRESETS;
  return FLEXIBLE_RESOLUTION_PRESETS.filter((value) => !LARGE_RESOLUTION_PRESETS.has(value));
}

export function buildCustomAspectValue(id: string): AspectPreset {
  return `custom:${id}` as AspectPreset;
}

export function customAspectIdFromValue(aspect: AspectPreset): string | null {
  return aspect.startsWith("custom:") ? aspect.slice("custom:".length) : null;
}

export function aspectPresetLabel(aspect: AspectPreset, customRatios: CustomAspectRatio[] = []): string {
  if (aspect === "auto") return "Auto";
  const customId = customAspectIdFromValue(aspect);
  if (customId) {
    return customRatios.find((item) => item.id === customId)?.label ?? customId;
  }
  return ASPECT_PRESETS.find((item) => item.value === aspect)?.label ?? aspect;
}

export function listAspectPresetOptions(input: SizeCapabilityInput, customRatios: CustomAspectRatio[] = []): AspectPresetOption[] {
  const allowed = new Set<AspectPreset>(allowedBuiltinAspectPresets(input));
  const base = ASPECT_PRESETS.filter((item) => allowed.has(item.value));

  if (!supportsCustomAspectRatios(input)) {
    return base;
  }

  return [
    ...base,
    ...customRatios.map((ratio) => {
      const shape = aspectShapeFromRatio(ratio.width, ratio.height);
      return {
        value: buildCustomAspectValue(ratio.id),
        label: ratio.label,
        w: shape.w,
        h: shape.h,
        custom: true,
      };
    }),
  ];
}

export function deriveAspectPreset(size: SizeValue, customRatios: CustomAspectRatio[] = []): AspectPreset {
  if (size === "auto") return "auto";
  const exact = SIZE_TO_ASPECT[size];
  if (exact) return exact;
  const parsed = parseSizeValue(size);
  if (!parsed) return DEFAULT_ASPECT_FROM_AUTO;
  const customMatch = findMatchingCustomAspect(parsed.width, parsed.height, customRatios);
  if (customMatch) return buildCustomAspectValue(customMatch.id);
  const builtinMatch = nearestBuiltinAspect(parsed.width, parsed.height);
  return builtinMatch.distance <= BUILTIN_ASPECT_TOLERANCE ? builtinMatch.value : DEFAULT_ASPECT_FROM_AUTO;
}

export function deriveResolutionPreset(size: SizeValue): ResolutionPreset {
  if (size === "auto") return "auto";
  const exact = SIZE_TO_RESOLUTION[size];
  if (exact) return exact;
  const parsed = parseSizeValue(size);
  if (!parsed) return DEFAULT_RESOLUTION_FROM_AUTO;
  const aspect = parsed.width / parsed.height;
  let best: FlexibleCustomResolution = DEFAULT_FLEXIBLE_CUSTOM_RESOLUTION;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const resolution of Object.keys(CUSTOM_RESOLUTION_REFERENCES) as FlexibleCustomResolution[]) {
    const expected = buildCustomDimensionsForResolution(aspect, resolution);
    const distance = customSizeDistance(parsed.width, parsed.height, expected.width, expected.height);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = resolution;
    }
  }
  return best;
}

export function formatSizeValue(size: SizeValue): string {
  if (size === "auto") return "Auto";
  const parsed = parseSizeValue(size);
  return parsed ? `${parsed.width}×${parsed.height}` : size;
}

export function buildExactSizeValue(width: number, height: number): SizeValue | null {
  const normalized = normalizeExactSizeDimensions(width, height);
  if (!normalized) return null;
  return `${normalized.width}x${normalized.height}` as SizeValue;
}

export function normalizeExactSizeDimensions(
  width: unknown,
  height: unknown,
): { width: number; height: number } | null {
  const safeWidth = normalizeExactSizeDimension(width);
  const safeHeight = normalizeExactSizeDimension(height);
  if (!safeWidth || !safeHeight) return null;
  return normalizeOpenAIImageSize({ width: safeWidth, height: safeHeight });
}

export function deriveExactSizeSelection(
  size: SizeValue,
  input: SizeCapabilityInput,
  customRatios: CustomAspectRatio[] = [],
): ExactSizeSelection | null {
  if (size === "auto" || !supportsPreciseSizeControl(input)) return null;
  const parsed = parseSizeValue(size);
  if (!parsed) return null;
  const canonical = sizeValueFromDimensions(parsed.width, parsed.height);
  if (!isExactSizeValue(canonical, input, customRatios)) return null;
  return {
    value: canonical,
    width: parsed.width,
    height: parsed.height,
    label: formatSizeValue(canonical),
  };
}

export function buildSizeSelection(
  aspect: AspectPreset,
  resolution: ResolutionPreset,
  input: SizeCapabilityInput,
  customRatios: CustomAspectRatio[] = [],
): SizeValue {
  if (aspect === "auto" || resolution === "auto") {
    return supportsAutomaticSizing(input) ? "auto" : defaultModelSize(input);
  }
  const normalizedResolution = normalizeResolutionSelection(resolution, input);
  if (normalizedResolution === "auto") {
    return supportsAutomaticSizing(input) ? "auto" : defaultModelSize(input);
  }
  const custom = customAspectIdFromValue(aspect);
  if (custom) {
    if (!supportsCustomAspectRatios(input)) return defaultModelSize(input);
    const ratio = customRatios.find((item) => item.id === custom);
    return ratio
      ? buildCustomSizeSelection(ratio, normalizeFlexibleCustomResolution(normalizedResolution))
      : (SIZE_MATRIX[DEFAULT_ASPECT_FROM_AUTO][normalizedResolution] ?? defaultModelSize(input));
  }
  if (!allowedBuiltinAspectPresets(input).includes(aspect as BuiltinAspectPreset)) {
    return defaultModelSize(input);
  }
  const size = SIZE_MATRIX[aspect as Exclude<BuiltinAspectPreset, "auto">]?.[normalizedResolution];
  return size ?? defaultModelSize(input);
}

export function buildAspectSizeSelection(
  aspect: AspectPreset,
  currentResolution: ResolutionPreset,
  input: SizeCapabilityInput,
  customRatios: CustomAspectRatio[] = [],
): SizeValue {
  if (aspect === "auto") {
    return supportsAutomaticSizing(input) ? "auto" : defaultModelSize(input);
  }
  const normalizedResolution = normalizeResolutionSelection(currentResolution, input);
  return buildSizeSelection(
    aspect,
    normalizedResolution === "auto" ? DEFAULT_RESOLUTION_FROM_AUTO : normalizedResolution,
    input,
    customRatios,
  );
}

export function buildResolutionSizeSelection(
  currentAspect: AspectPreset,
  resolution: ResolutionPreset,
  input: SizeCapabilityInput,
  customRatios: CustomAspectRatio[] = [],
  referenceAspect: AspectPreset | null = null,
): SizeValue {
  if (resolution === "auto") {
    return supportsAutomaticSizing(input) ? "auto" : defaultModelSize(input);
  }
  return buildSizeSelection(
    currentAspect === "auto"
      ? (referenceAspect ?? DEFAULT_ASPECT_FROM_AUTO)
      : currentAspect,
    normalizeResolutionSelection(resolution, input),
    input,
    customRatios,
  );
}

export function buildReferenceResolutionSizeSelection(
  resolution: Exclude<ResolutionPreset, "auto">,
  reference: { width: number; height: number } | null,
  input: SizeCapabilityInput,
  customRatios: CustomAspectRatio[] = [],
): SizeValue {
  if (!reference || !Number.isFinite(reference.width) || !Number.isFinite(reference.height) || reference.width <= 0 || reference.height <= 0) {
    return buildResolutionSizeSelection("auto", resolution, input, customRatios);
  }
  if (supportsCustomAspectRatios(input)) {
    const customReference = buildReferenceAspectRatio(reference.width, reference.height, customRatios);
    if (customReference) {
      const ratios = customRatios.some((item) => item.id === customReference.id)
        ? customRatios
        : [...customRatios, customReference];
      return buildSizeSelection(buildCustomAspectValue(customReference.id), resolution, input, ratios);
    }
  }
  return buildSizeSelection(
    nearestBuiltinAspect(reference.width, reference.height).value,
    resolution,
    input,
    customRatios,
  );
}

export function normalizeResolutionSelection(resolution: ResolutionPreset, input: SizeCapabilityInput): ResolutionPreset {
  const allowed = availableResolutionPresets(input);
  if (allowed.includes(resolution)) return resolution;
  return allowed.find((value) => value !== "auto") ?? allowed[0] ?? DEFAULT_RESOLUTION_FROM_AUTO;
}

export function normalizeSizeSelection(
  size: SizeValue,
  input: SizeCapabilityInput,
  customRatios: CustomAspectRatio[] = [],
): SizeValue {
  if (size === "auto") {
    return supportsAutomaticSizing(input) ? "auto" : defaultModelSize(input);
  }
  const parsed = parseSizeValue(size);
  if (!parsed) return defaultModelSize(input);
  const canonical = sizeValueFromDimensions(parsed.width, parsed.height);
  if (supportsPreciseSizeControl(input) && isExactSizeValue(canonical, input, customRatios)) {
    return buildExactSizeValue(parsed.width, parsed.height) ?? defaultModelSize(input);
  }
  const aspect = deriveAspectPreset(canonical, customRatios);
  const resolution = deriveResolutionPreset(canonical);
  return buildSizeSelection(aspect, resolution, input, customRatios);
}

export function sizeCapabilityHint(input: SizeCapabilityInput): string {
  const family = modelFamily(input);
  if (family === "dalle2") {
    return "当前模型仅支持 256 / 512 / 1024 的正方形尺寸。";
  }
  if (family === "dalle3") {
    return "当前模型仅支持 1024×1024、1792×1024、1024×1792。";
  }
  if (supportsExplicitLargeSizes(input)) {
    return "";
  }
  return "当前链路只保证基础尺寸稳定可用。";
}

function buildCustomSizeSelection(
  ratio: CustomAspectRatio,
  resolution: FlexibleCustomResolution,
): SizeValue {
  const { width, height } = buildCustomDimensionsForResolution(ratio.width / ratio.height, resolution);
  return `${width}x${height}` as SizeValue;
}

function aspectShapeFromRatio(width: number, height: number): { w: number; h: number } {
  const maxWidth = 24;
  const maxHeight = 22;
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const scale = Math.min(maxWidth / safeWidth, maxHeight / safeHeight);
  return {
    w: Math.max(10, Math.round(safeWidth * scale)),
    h: Math.max(10, Math.round(safeHeight * scale)),
  };
}

export function parseSizeValue(size: SizeValue): { width: number; height: number } | null {
  const match = /^(\d+)x(\d+)$/.exec(size);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return { width, height };
}

function findMatchingCustomAspect(width: number, height: number, customRatios: CustomAspectRatio[]): CustomAspectRatio | null {
  for (const ratio of customRatios) {
    for (const resolution of Object.keys(CUSTOM_RESOLUTION_REFERENCES) as FlexibleCustomResolution[]) {
      const expected = buildCustomDimensionsForResolution(ratio.width / ratio.height, resolution);
      if (expected.width === width && expected.height === height) {
        return ratio;
      }
    }
  }
  let best: CustomAspectRatio | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const ratio of customRatios) {
    const distance = aspectRatioDistance(width, height, ratio.width, ratio.height);
    if (distance < bestDistance) {
      best = ratio;
      bestDistance = distance;
    }
  }
  return best && bestDistance <= CUSTOM_ASPECT_TOLERANCE ? best : null;
}

function nearestBuiltinAspect(width: number, height: number): {
  value: Exclude<BuiltinAspectPreset, "auto">;
  distance: number;
} {
  let bestValue: Exclude<BuiltinAspectPreset, "auto"> = DEFAULT_ASPECT_FROM_AUTO;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const [value, dims] of Object.entries(BUILTIN_ASPECT_DIMENSIONS) as Array<[Exclude<BuiltinAspectPreset, "auto">, { width: number; height: number }]>) {
    const distance = aspectRatioDistance(width, height, dims.width, dims.height);
    if (distance < bestDistance) {
      bestValue = value;
      bestDistance = distance;
    }
  }
  return { value: bestValue, distance: bestDistance };
}

function aspectRatioDistance(width: number, height: number, targetWidth: number, targetHeight: number): number {
  const left = width / height;
  const right = targetWidth / targetHeight;
  return Math.abs(left - right) / right;
}

function buildCustomDimensionsForResolution(
  aspect: number,
  resolution: FlexibleCustomResolution,
): { width: number; height: number } {
  const reference = CUSTOM_RESOLUTION_REFERENCES[resolution] ?? CUSTOM_RESOLUTION_REFERENCES["1k"];
  const normalizedAspect = normalizeCustomAspectRatio(aspect, reference.maxAspectRatio);
  let width = Math.sqrt(reference.area * normalizedAspect);
  let height = Math.sqrt(reference.area / normalizedAspect);
  return enforceSizeLimits(width, height, reference) ?? {
    width: Math.max(MIN_EXACT_SIZE, Math.min(reference.maxSide, roundDimension(width, reference.alignment))),
    height: Math.max(MIN_EXACT_SIZE, Math.min(reference.maxSide, roundDimension(height, reference.alignment))),
  };
}

function normalizeCustomAspectRatio(aspect: number, maxAspectRatio?: number): number {
  if (!Number.isFinite(aspect) || aspect <= 0) return 1;
  if (!maxAspectRatio || maxAspectRatio <= 1) return aspect;
  const minAspectRatio = 1 / maxAspectRatio;
  if (aspect > maxAspectRatio) return maxAspectRatio;
  if (aspect < minAspectRatio) return minAspectRatio;
  return aspect;
}

function enforceSizeLimits(
  width: number,
  height: number,
  limits: SizeLimitConfig,
): { width: number; height: number } | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const normalizedAspect = normalizeCustomAspectRatio(width / height, limits.maxAspectRatio);
  let limitedWidth = width;
  let limitedHeight = height;

  if (width / height !== normalizedAspect) {
    if (width >= height) {
      limitedWidth = height * normalizedAspect;
    } else {
      limitedHeight = width / normalizedAspect;
    }
  }

  const maxSide = Math.max(limitedWidth, limitedHeight);
  if (maxSide > limits.maxSide) {
    const scale = limits.maxSide / maxSide;
    limitedWidth *= scale;
    limitedHeight *= scale;
  }

  const pixelCount = limitedWidth * limitedHeight;
  if (pixelCount > limits.maxPixels) {
    const scale = Math.sqrt(limits.maxPixels / pixelCount);
    limitedWidth *= scale;
    limitedHeight *= scale;
  }

  const snapped = snapToNearestValidSize(limitedWidth, limitedHeight, limits);
  if (!snapped) {
    return null;
  }
  return snapped;
}

function snapToNearestValidSize(
  targetWidth: number,
  targetHeight: number,
  limits: SizeLimitConfig,
): { width: number; height: number } | null {
  const widthCandidates = alignedDimensionCandidates(targetWidth, limits.alignment, MIN_EXACT_SIZE, limits.maxSide);
  const heightCandidates = alignedDimensionCandidates(targetHeight, limits.alignment, MIN_EXACT_SIZE, limits.maxSide);
  let best: { width: number; height: number } | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestAspectDistance = Number.POSITIVE_INFINITY;
  let bestAreaDistance = Number.POSITIVE_INFINITY;

  for (const width of widthCandidates) {
    for (const height of heightCandidates) {
      if (!isWithinSizeLimits(width, height, limits)) continue;
      const distance = customSizeDistance(width, height, targetWidth, targetHeight);
      const aspectDistance = Math.abs((width / height) - (targetWidth / targetHeight));
      const areaDistance = Math.abs((width * height) - (targetWidth * targetHeight)) / Math.max(targetWidth * targetHeight, 1);
      if (
        distance < bestDistance
        || (distance === bestDistance && aspectDistance < bestAspectDistance)
        || (distance === bestDistance && aspectDistance === bestAspectDistance && areaDistance < bestAreaDistance)
      ) {
        best = { width, height };
        bestDistance = distance;
        bestAspectDistance = aspectDistance;
        bestAreaDistance = areaDistance;
      }
    }
  }

  if (best) return best;

  let roundedWidth = widthCandidates[0] ?? Math.min(limits.maxSide, roundDimension(targetWidth, limits.alignment));
  let roundedHeight = heightCandidates[0] ?? Math.min(limits.maxSide, roundDimension(targetHeight, limits.alignment));

  while (!isWithinSizeLimits(roundedWidth, roundedHeight, limits)) {
    const options: Array<{ width: number; height: number; distance: number; aspectDistance: number; areaDistance: number }> = [];
    if (roundedWidth - limits.alignment >= MIN_EXACT_SIZE) {
      const width = roundedWidth - limits.alignment;
      const height = roundedHeight;
      options.push({
        width,
        height,
        distance: customSizeDistance(width, height, targetWidth, targetHeight),
        aspectDistance: Math.abs((width / height) - (targetWidth / targetHeight)),
        areaDistance: Math.abs((width * height) - (targetWidth * targetHeight)) / Math.max(targetWidth * targetHeight, 1),
      });
    }
    if (roundedHeight - limits.alignment >= MIN_EXACT_SIZE) {
      const width = roundedWidth;
      const height = roundedHeight - limits.alignment;
      options.push({
        width,
        height,
        distance: customSizeDistance(width, height, targetWidth, targetHeight),
        aspectDistance: Math.abs((width / height) - (targetWidth / targetHeight)),
        areaDistance: Math.abs((width * height) - (targetWidth * targetHeight)) / Math.max(targetWidth * targetHeight, 1),
      });
    }
    const next = options
      .filter((option) => option.width >= MIN_EXACT_SIZE && option.height >= MIN_EXACT_SIZE)
      .sort((left, right) => (
        left.distance - right.distance
        || left.aspectDistance - right.aspectDistance
        || left.areaDistance - right.areaDistance
      ))[0];
    if (!next) break;
    roundedWidth = next.width;
    roundedHeight = next.height;
  }

  if (!isWithinSizeLimits(roundedWidth, roundedHeight, limits)) {
    return null;
  }
  return { width: roundedWidth, height: roundedHeight };
}

function alignedDimensionCandidates(
  value: number,
  alignment: number,
  min: number,
  max: number,
): number[] {
  const clamped = Math.max(min, Math.min(max, value));
  const floor = Math.max(min, Math.min(max, Math.floor(clamped / alignment) * alignment));
  const ceil = Math.max(min, Math.min(max, Math.ceil(clamped / alignment) * alignment));
  return Array.from(new Set([floor, ceil].filter((candidate) => candidate >= min && candidate <= max)))
    .sort((left, right) => Math.abs(left - clamped) - Math.abs(right - clamped) || right - left);
}

function isWithinSizeLimits(width: number, height: number, limits: SizeLimitConfig): boolean {
  if (width < MIN_EXACT_SIZE || height < MIN_EXACT_SIZE) return false;
  if (width > limits.maxSide || height > limits.maxSide) return false;
  if (width * height > limits.maxPixels) return false;
  const aspect = width / height;
  return aspect <= limits.maxAspectRatio && aspect >= MIN_OPENAI_IMAGE_ASPECT_RATIO;
}

function customSizeDistance(
  width: number,
  height: number,
  targetWidth: number,
  targetHeight: number,
): number {
  return Math.abs(width - targetWidth) / Math.max(targetWidth, 1)
    + Math.abs(height - targetHeight) / Math.max(targetHeight, 1);
}

function normalizeFlexibleCustomResolution(
  resolution: Exclude<ResolutionPreset, "auto">,
): FlexibleCustomResolution {
  if (resolution === "2k" || resolution === "4k") return resolution;
  return "1k";
}

function roundDimension(value: number, alignment = OPENAI_IMAGE_SIZE_ALIGNMENT): number {
  return Math.max(64, Math.round(value / alignment) * alignment);
}

function normalizeExactSizeDimension(value: unknown): number {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return 0;
  const rounded = Math.floor(num);
  if (rounded < MIN_EXACT_SIZE) return 0;
  return rounded;
}

function sizeValueFromDimensions(width: number, height: number): SizeValue {
  return `${width}x${height}` as SizeValue;
}

function isExactSizeValue(
  size: SizeValue,
  input: SizeCapabilityInput,
  customRatios: CustomAspectRatio[],
): boolean {
  const aspect = deriveAspectPreset(size, customRatios);
  const resolution = deriveResolutionPreset(size);
  return buildSizeSelection(aspect, resolution, input, customRatios) !== size;
}

export function builtInAspectId(width: number, height: number): string {
  return buildCustomAspectRatioId(width, height);
}

export function isBuiltInAspectRatio(width: number, height: number): boolean {
  const id = buildCustomAspectRatioId(width, height);
  return id === "1:1" || id === "3:2" || id === "2:3" || id === "16:9" || id === "9:16" || id === "7:4" || id === "4:7";
}

export function reduceAspectRatioLabel(width: number, height: number): string {
  const reduced = reduceAspectRatio(width, height);
  return reduced.width > 0 && reduced.height > 0 ? `${reduced.width}:${reduced.height}` : "";
}

export function buildReferenceAspectRatio(
  width: number,
  height: number,
  customRatios: CustomAspectRatio[] = [],
): CustomAspectRatio | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  if (isBuiltInAspectRatio(width, height)) return null;
  const id = buildCustomAspectRatioId(width, height);
  const existing = customRatios.find((item) => item.id === id);
  if (existing) return existing;
  const reduced = reduceAspectRatio(width, height);
  if (reduced.width <= 0 || reduced.height <= 0) return null;
  return {
    id,
    label: `参考图 ${reduced.width}:${reduced.height}`,
    width: reduced.width,
    height: reduced.height,
    createdAt: 0,
  };
}

function defaultModelSize(input: SizeCapabilityInput): SizeValue {
  const family = modelFamily(input);
  if (family === "dalle2" || family === "dalle3") return "1024x1024";
  if (isLegacyGPTImageModel(input)) return "1024x1024";
  return "1024x1024";
}

function allowedBuiltinAspectPresets(input: SizeCapabilityInput): BuiltinAspectPreset[] {
  const family = modelFamily(input);
  if (family === "dalle2") return ["1:1"];
  if (family === "dalle3") return ["1:1", "7:4", "4:7"];
  if (isLegacyGPTImageModel(input)) return ["auto", "1:1", "3:2", "2:3"];
  return ["auto", "1:1", "3:2", "2:3", "16:9", "9:16"];
}
