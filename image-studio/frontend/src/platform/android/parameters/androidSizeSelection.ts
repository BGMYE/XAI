import {
  buildAspectSizeSelection,
  buildResolutionSizeSelection,
  type AspectPreset,
  type ResolutionPreset,
} from "../../../components/panel/sizeCapabilities.ts";
import type { APIMode, CustomAspectRatio, RequestPolicy, SizeValue } from "../../../types/domain.ts";

type AndroidSizeSelectionInput = {
  apiMode: APIMode;
  requestPolicy: RequestPolicy;
  imageModelID?: string;
};

export function buildAndroidAspectSizeSelection(
  aspect: AspectPreset,
  currentResolution: ResolutionPreset,
  input: AndroidSizeSelectionInput,
  customRatios: CustomAspectRatio[] = [],
): SizeValue {
  return buildAspectSizeSelection(
    aspect,
    currentResolution,
    input,
    customRatios,
  );
}

export function buildAndroidResolutionSizeSelection(
  currentAspect: AspectPreset,
  resolution: ResolutionPreset,
  input: AndroidSizeSelectionInput,
  customRatios: CustomAspectRatio[] = [],
  referenceAspect: AspectPreset | null = null,
): SizeValue {
  return buildResolutionSizeSelection(
    currentAspect,
    resolution,
    input,
    customRatios,
    referenceAspect,
  );
}
