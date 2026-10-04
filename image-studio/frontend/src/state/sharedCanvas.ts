type MediaReference = { assetId?: string; src?: string };
type CanvasReferences = {
  canvasNodes?: MediaReference[];
  workspaces?: Array<{ canvasNodes?: MediaReference[] }>;
  currentImage?: MediaReference | null;
  compareB?: MediaReference | null;
  resultDetail?: MediaReference | null;
  batchResults?: MediaReference[];
};

export function collectClassicAssets(state: CanvasReferences): string[] {
  const ids = new Set<string>();
  const items = [
    ...(state.canvasNodes ?? []),
    ...(state.workspaces ?? []).flatMap((workspace) => workspace.canvasNodes ?? []),
    state.currentImage,
    state.compareB,
    state.resultDetail,
    ...(state.batchResults ?? []),
  ];
  for (const item of items) {
    if (item?.assetId) ids.add(item.assetId);
    const video = item?.src?.match(/^\/studio-media\/([a-zA-Z0-9_-]+)$/);
    if (video) ids.add(video[1]);
  }
  return [...ids].sort();
}

export function createClassicReferenceSync(
  save: (ids: string[]) => Promise<void>,
  warn: (error: unknown) => void,
) {
  let desired: string[] = [],
    saved: string | null = null;
  let running: Promise<void> | null = null;
  return (state: CanvasReferences): Promise<void> => {
    desired = collectClassicAssets(state);
    if (running) return running;
    if (JSON.stringify(desired) === saved) return Promise.resolve();
    running = Promise.resolve().then(async () => {
      try {
        while (JSON.stringify(desired) !== saved) {
          const ids = desired;
          await save(ids);
          saved = JSON.stringify(ids);
        }
      } catch (error) {
        warn(error);
      } finally {
        running = null;
      }
    });
    return running;
  };
}
