import { expect, test, type BrowserContext, type Page } from '@playwright/test';

// The Wails boundary is mocked; React/Zustand, IndexedDB, reload and the two
// browser pages are real. These tests are not evidence of native window behavior.
const fixturePNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC1sAAAAASUVORK5CYII=';
const credential = 'synthetic-persistence-credential';

async function mockDesktopHost(context: BrowserContext) {
  let snapshot: any = {
    revision: 1,
    profiles: [{ id: 'fixture', name: '持久化测试连接', apiMode: 'images', responsesTransport: 'sse', requestPolicy: 'openai', baseURL: 'https://first.example.invalid', imageModelID: 'gpt-image-2.5-sunburst', modelIDs: ['gpt-image-2.5-sunburst'], textModelID: '', reasoningEffort: 'xhigh', concurrencyLimit: 1, createdAt: 1, hasAPIKey: true }],
    activeProfileId: 'fixture', aiProfileId: '',
    preferences: { fontScale: 1, theme: 'light', kernelRuntimeMode: 'local', savePromptSuppressed: true, autoRetryEnabled: false, completionSound: { enabled: false }, completionNotification: { enabled: false } },
  };
  const calls: { method: string; page: Page; args: any[] }[] = [];
  const requests: { method: string; model: string; baseURL: string; jobID: string }[] = [];
  let compatibility: any = null;
  let holdCompatibility = false;
  let failCompatibility = false;
  const pendingCompatibility: (() => void)[] = [];
  const emit = async (page: Page, name: string, data?: any) => page.evaluate(({ name, data }) => (window as any).__emit(name, data), { name, data });
  await context.addInitScript(() => { (window as any)._wails = { invoke() {} }; });
  await context.route(/@wailsio_runtime\.js/, route => route.fulfill({ contentType: 'text/javascript', body: `
const listeners = new Map();
const on = (name, callback) => { listeners.set(name, [...(listeners.get(name) || []), callback]); return () => listeners.set(name, (listeners.get(name) || []).filter(item => item !== callback)); };
window.__emit = (name, data) => (listeners.get(name) || []).forEach(callback => callback({ data }));
export const Events = { On: on, OnMultiple: on, Off: (...names) => names.forEach(name => listeners.delete(name)) };
export const Window = { Close: async () => {}, IsFullscreen: async () => false, SetTitle: async title => { document.title = title; } };
export const Application = { Quit: async () => {} };
export const Call = { ByName: (name, ...args) => window.__hostCall(name.split('.').pop(), args) };
` }));
  await context.route('**/media/**', route => route.fulfill({ contentType: 'image/png', body: Buffer.from(fixturePNG, 'base64') }));
  await context.exposeBinding('__hostCall', async ({ page }, method: string, args: any[]) => {
    // Keep request credentials out of diagnostic call records even in fixtures.
    calls.push({ method, page, args: ['Generate', 'Edit', 'SetStoredAPIKey'].includes(method) ? [] : structuredClone(args) });
    if (method === 'GetSystemPreferences') return {};
    if (method === 'GetSnapshot' || method === 'Initialize') return structuredClone(snapshot);
    if (method === 'GetStoredAPIKey') return args[0] === 'profile:fixture' ? credential : '';
    if (method === 'GetOutputDir') return '/test/output';
    if (method === 'LoadCompatibilityState') return structuredClone(compatibility);
    if (method === 'SaveCompatibilityState') {
      if (holdCompatibility) await new Promise<void>(resolve => pendingCompatibility.push(resolve));
      if (failCompatibility) throw new Error('Fixture disk write failed');
      compatibility = structuredClone(args[0]);
      return null;
    }
    if (method === 'RegisterImportedImageAsset' || method === 'RegisterMediaAsset') {
      return { savedPath: args[0], imageId: 'test-image', previewUrl: '/media/preview/test-image', fullUrl: '/media/full/test-image', previewWidth: 1, previewHeight: 1 };
    }
    if (method === 'ImportImageFromB64') return { path: '/test/imports/reference.png' };
    if (method === 'ReadImageAsBase64') return fixturePNG;
    if (method === 'SaveProfile') {
      const request = args[0];
      if (request.expectedRevision !== snapshot.revision) throw new Error('配置版本冲突');
      snapshot = { ...snapshot, revision: snapshot.revision + 1, profiles: snapshot.profiles.map((profile: any) => profile.id === request.profile.id ? { ...request.profile, hasAPIKey: true } : profile) };
      await Promise.all(context.pages().filter(target => !target.isClosed()).map(target => emit(target, 'desktop-settings-changed', { revision: snapshot.revision })));
      return structuredClone(snapshot);
    }
    if (method === 'PatchPreferences') {
      snapshot = { ...snapshot, revision: snapshot.revision + 1, preferences: { ...snapshot.preferences, ...args[1] } };
      return structuredClone(snapshot);
    }
    if (method === 'Generate' || method === 'Edit') {
      const input = args[0];
      requests.push({ method, model: input.imageModelID, baseURL: input.baseURL, jobID: input.requestedJobId });
      return { jobId: input.requestedJobId };
    }
    return null;
  });
  return {
    calls, requests, emit,
    compatibility: () => compatibility,
    holdCompatibility: () => { holdCompatibility = true; },
    pendingCompatibility: () => pendingCompatibility.length,
    releaseCompatibility: () => { holdCompatibility = false; pendingCompatibility.splice(0).forEach(resolve => resolve()); },
    failCompatibility: (value: boolean) => { failCompatibility = value; },
  };
}

async function openMain(page: Page, calls: { method: string; page: Page }[]) {
  const before = calls.filter(call => call.method === 'WorkspacePersistenceReady' && call.page === page).length;
  await page.goto('/');
  await expect.poll(() => calls.filter(call => call.method === 'WorkspacePersistenceReady' && call.page === page).length).toBe(before + 1);
  await page.evaluate(async () => { (window as any).__studio = (await import('/src/state/studioStore.ts')).useStudioStore; });
  await expect(page.getByLabel('图像模型', { exact: true })).toHaveValue(JSON.stringify(['fixture', 'gpt-image-2.5-sunburst']));
}

async function readArchive(page: Page) {
  return page.evaluate(() => new Promise<any>((resolve, reject) => {
    const opening = indexedDB.open('image-studio-desktop-workspaces');
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const database = opening.result;
      const read = database.transaction('snapshots').objectStore('snapshots').get('current');
      read.onsuccess = () => { database.close(); resolve(read.result); };
      read.onerror = () => { database.close(); reject(read.error); };
    };
  }));
}

test('real desktop bootstrap restores workspace, source Blob, canvas and local edits after browser reload', async ({ context, page }) => {
  const host = await mockDesktopHost(context);
  await openMain(page, host.calls);
  const ids = await page.evaluate(async () => {
    const store = (window as any).__studio;
    const firstID = store.getState().activeWorkspaceId;
    await store.getState().acceptImportedImage({ path: '/test/imports/reference.png' }, 'reference.png', 68);
    const image = store.getState().currentImage;
    store.getState().setField('prompt', '保留第一张画布的提示词');
    store.getState().addCanvasNode({ id: image.id, type: 'image', src: image.previewUrl, mediaId: image.imageId, label: '素材图层', x: -80, y: 45, width: 320, height: 240, createdAt: 10 });
    store.getState().setCanvasViewport({ x: 27, y: -19, scale: 1.75 });
    store.getState().pushStroke({ points: [1, 2, 30, 40], size: 18, erase: false });
    store.getState().setField('maskDataURL', 'data:image/png;base64,bWFza19maXh0dXJl');
    store.getState().setField('annotations', [{ id: 'annotation-a', kind: 'rect', x: 8, y: 12, width: 20, height: 30, color: '#0062CC' }]);
    store.getState().newWorkspace('第二画布');
    const secondID = store.getState().activeWorkspaceId;
    store.getState().setField('prompt', '另一张画布的独立提示词');
    store.getState().switchWorkspace(firstID);
    return { firstID, secondID, sourceID: image.id };
  });
  await host.emit(page, 'desktop-workspace-flush-request');
  await expect.poll(() => host.calls.filter(call => call.method === 'CompleteWorkspaceFlush').map(call => call.args[0])).toEqual([true]);
  const archive = await readArchive(page);
  expect(archive.workspaces).toHaveLength(2);
  expect(JSON.stringify(archive)).not.toContain(credential);
  expect(await page.evaluate(async () => {
    const request = indexedDB.open('image-studio-desktop-workspaces');
    return new Promise<number>((resolve, reject) => {
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result, read = db.transaction('snapshots').objectStore('snapshots').get('current');
        read.onsuccess = () => { const size = read.result.workspaces[0].sources[0].imageBlob.size; db.close(); resolve(size); };
      };
    });
  })).toBeGreaterThan(0);
  await openMain(page, host.calls);
  const restored = await page.evaluate(() => {
    const state = (window as any).__studio.getState();
    return { count: state.workspaces.length, id: state.activeWorkspaceId, prompt: state.prompt, source: state.sources[0]?.path, current: state.currentImage?.id, nodes: state.canvasNodes, viewport: state.canvasViewport, strokes: state.strokes, mask: state.maskDataURL, annotations: state.annotations, running: state.runningJobs, undo: state.undoStack.length };
  });
  expect(restored).toMatchObject({ count: 2, id: ids.firstID, prompt: '保留第一张画布的提示词', source: '/test/imports/reference.png', current: ids.sourceID, viewport: { x: 27, y: -19, scale: 1.75 }, strokes: [{ points: [1, 2, 30, 40], size: 18, erase: false }], mask: 'data:image/png;base64,bWFza19maXh0dXJl', annotations: [{ id: 'annotation-a', kind: 'rect' }], running: [], undo: 0 });
  expect(restored.nodes[0]).toMatchObject({ id: ids.sourceID, x: -80, y: 45, width: 320, height: 240 });
  await page.evaluate(id => (window as any).__studio.getState().switchWorkspace(id), ids.secondID);
  await expect(page.getByLabel('提示词', { exact: true })).toHaveValue('另一张画布的独立提示词');
  expect(await page.evaluate(() => (window as any).__studio.getState().strokes)).toEqual([]);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(credential);
  expect(JSON.stringify(host.compatibility())).not.toContain(credential);
});

test('settings entry remains isolated while configuration changes affect only subsequent generation requests', async ({ context, page }) => {
  const host = await mockDesktopHost(context);
  await openMain(page, host.calls);
  await page.getByLabel('提示词', { exact: true }).fill('一张用于任务快照验证的静物');
  await page.getByRole('button', { name: '生成图片', exact: true }).click();
  await expect.poll(() => host.requests.length).toBe(1);
  const originalRequest = structuredClone(host.requests[0]);
  const settings = await context.newPage();
  await settings.goto('/?window=settings');
  await expect(settings.getByLabel('名称', { exact: true })).toHaveValue('持久化测试连接');
  await settings.getByLabel('服务地址', { exact: false }).fill('https://next.example.invalid');
  await settings.getByLabel('图像模型', { exact: true }).fill('custom-model-next');
  await settings.getByRole('button', { name: '保存', exact: true }).click();
  await expect(settings.getByRole('status')).toContainText('配置已保存');
  await expect(page.getByLabel('图像模型', { exact: true })).toHaveValue(JSON.stringify(['fixture', 'custom-model-next']));
  expect(host.requests).toEqual([originalRequest]);
  expect(await page.evaluate(() => (window as any).__studio.getState().runningJobs)).toEqual([originalRequest.jobID]);
  const settingsMethods = host.calls.filter(call => call.page === settings).map(call => call.method);
  expect(settingsMethods).toContain('SettingsWindowReady');
  for (const forbidden of ['Initialize', 'WorkspacePersistenceReady', 'LoadCompatibilityState', 'SaveCompatibilityState', 'Generate', 'Edit']) expect(settingsMethods).not.toContain(forbidden);
  await settings.close();
  expect(await page.evaluate(() => (window as any).__studio.getState().workspaces.length)).toBe(1);
  await page.evaluate(() => (window as any).__studio.getState().cancel());
  await page.getByRole('button', { name: '生成图片', exact: true }).click();
  await expect.poll(() => host.requests.length).toBe(2);
  expect(host.requests[1]).toMatchObject({ model: 'custom-model-next', baseURL: 'https://next.example.invalid' });
  await page.evaluate(() => (window as any).__studio.getState().cancel());
});

test('close handshake waits for outstanding compatibility writes and persists the latest workspace state', async ({ context, page }) => {
  const host = await mockDesktopHost(context);
  await openMain(page, host.calls);
  await expect.poll(() => host.compatibility() !== null).toBe(true);
  host.holdCompatibility();
  await page.evaluate(() => {
    const state = (window as any).__studio.getState();
    state.setField('outputFormat', 'webp');
    state.setField('prompt', '关闭前最后一笔更改');
  });
  await host.emit(page, 'desktop-workspace-flush-request');
  await expect.poll(host.pendingCompatibility).toBeGreaterThan(0);
  expect(host.calls.filter(call => call.method === 'CompleteWorkspaceFlush')).toEqual([]);
  host.releaseCompatibility();
  await expect.poll(() => host.calls.filter(call => call.method === 'CompleteWorkspaceFlush').map(call => call.args[0])).toEqual([true]);
  const archive = await readArchive(page);
  expect(archive.workspaces[0]).toMatchObject({ prompt: '关闭前最后一笔更改', outputFormat: 'webp' });
  expect(host.compatibility().settings.outputFormat).toBe('webp');
});

test('close handshake also saves canvas edits made while compatibility export is still pending', async ({ context, page }) => {
  const host = await mockDesktopHost(context);
  await openMain(page, host.calls);
  await expect.poll(() => host.compatibility() !== null).toBe(true);
  host.holdCompatibility();
  await page.evaluate(() => {
    const state = (window as any).__studio.getState();
    state.setField('outputFormat', 'webp');
    state.setField('prompt', '开始关闭');
  });
  await host.emit(page, 'desktop-workspace-flush-request');
  await expect.poll(host.pendingCompatibility).toBeGreaterThan(0);
  await page.evaluate(() => {
    const state = (window as any).__studio.getState();
    state.setField('prompt', '等待磁盘期间继续编辑');
    state.setCanvasViewport({ x: 91, y: -23, scale: 2 });
  });
  host.releaseCompatibility();
  await expect.poll(() => host.calls.filter(call => call.method === 'CompleteWorkspaceFlush').map(call => call.args[0])).toEqual([true]);
  const archive = await readArchive(page);
  expect(archive.workspaces[0]).toMatchObject({ prompt: '等待磁盘期间继续编辑', canvasViewport: { x: 91, y: -23, scale: 2 } });
});

test('a failed compatibility write rejects close and retains changes for the next close attempt', async ({ context, page }) => {
  const host = await mockDesktopHost(context);
  await openMain(page, host.calls);
  await expect.poll(() => host.compatibility() !== null).toBe(true);
  host.failCompatibility(true);
  await page.evaluate(() => (window as any).__studio.getState().setField('outputFormat', 'webp'));
  await host.emit(page, 'desktop-workspace-flush-request');
  await expect.poll(() => host.calls.filter(call => call.method === 'CompleteWorkspaceFlush').map(call => call.args[0])).toEqual([false]);
  await expect(page.getByText('作品记录暂未保存，请检查可用空间后再关闭。')).toBeVisible();
  host.failCompatibility(false);
  await host.emit(page, 'desktop-workspace-flush-request');
  await expect.poll(() => host.calls.filter(call => call.method === 'CompleteWorkspaceFlush').map(call => call.args[0])).toEqual([false, true]);
  expect(host.compatibility().settings.outputFormat).toBe('webp');
});

test('IndexedDB quota failure preserves the last archive and prevents close until a successful retry', async ({ context, page }) => {
  const host = await mockDesktopHost(context);
  await openMain(page, host.calls);
  await page.evaluate(() => (window as any).__studio.getState().setField('prompt', '上一份有效存档'));
  await host.emit(page, 'desktop-workspace-flush-request');
  await expect.poll(() => host.calls.filter(call => call.method === 'CompleteWorkspaceFlush').map(call => call.args[0])).toEqual([true]);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    (window as any).__failWorkspaceWrite = true;
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) {
      if (this.transaction.db.name === 'image-studio-desktop-workspaces' && (window as any).__failWorkspaceWrite) throw new DOMException('Fixture quota exceeded', 'QuotaExceededError');
      return original.apply(this, args);
    };
    (window as any).__studio.getState().setField('prompt', '等待重试的编辑');
  });
  await host.emit(page, 'desktop-workspace-flush-request');
  await expect.poll(() => host.calls.filter(call => call.method === 'CompleteWorkspaceFlush').map(call => call.args[0])).toEqual([true, false]);
  expect((await readArchive(page)).workspaces[0].prompt).toBe('上一份有效存档');
  await page.evaluate(() => { (window as any).__failWorkspaceWrite = false; });
  await host.emit(page, 'desktop-workspace-flush-request');
  await expect.poll(() => host.calls.filter(call => call.method === 'CompleteWorkspaceFlush').map(call => call.args[0])).toEqual([true, false, true]);
  expect((await readArchive(page)).workspaces[0].prompt).toBe('等待重试的编辑');
});
