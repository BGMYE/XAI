import type { BatchInputImageLike } from "../../platform/runtime/hostTypes";

export type DesktopDroppedImages = { images: BatchInputImageLike[]; errors: string[] };

export async function acceptDesktopDroppedImages(
  result: DesktopDroppedImages,
  accept: (image: BatchInputImageLike, name: string, size: number) => Promise<void>,
  reportError: (message: string) => void,
): Promise<void> {
  for (const image of result.images) await accept(image, image.name, image.size);
  if (result.errors.length) reportError(result.errors.join("\n"));
}
