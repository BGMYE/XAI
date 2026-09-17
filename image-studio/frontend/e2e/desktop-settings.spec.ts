import { expect, test, type Page } from '@playwright/test';

async function settings(page: Page, scale = 1) {
  await page.addInitScript(() => { (window as any)._wails = { invoke() {} }; });
  await page.route(/@wailsio_runtime\.js/, (route) => route.fulfill({ contentType: 'text/javascript', body: `
const listeners = new Map();
const snapshot = { revision: 1, profiles: [{ id: 'fixture', name: '测试连接', apiMode: 'images', responsesTransport: 'sse', requestPolicy: 'openai', baseURL: 'https://example.invalid', imageModelID: 'gpt-image-2.5-sunburst', modelIDs: ['gpt-image-2.5-sunburst'], textModelID: '', reasoningEffort: 'xhigh', concurrencyLimit: 1, createdAt: 1, hasAPIKey: true }], activeProfileId: 'fixture', aiProfileId: '', preferences: { fontScale: ${scale}, theme: 'system' } };
window.__snapshot = snapshot; window.__calls = [];
const emit = (name, data) => (listeners.get(name) || []).forEach(cb => cb({ data }));
const on = (name, cb) => { const all = listeners.get(name) || []; listeners.set(name, [...all,cb]); return () => listeners.set(name,(listeners.get(name)||[]).filter(item=>item!==cb)); };
window.__emit = emit;
export const Events = { On: on, OnMultiple: on, Off: name => listeners.delete(name) };
export const Window = { Close: async()=>{}, IsFullscreen: async()=>false, SetTitle: async title=>{document.title=title;} }; export const Application = { Quit: async()=>{} };
export const Call = { ByName: async (name, ...args) => {
 const method = name.split('.').pop(); window.__calls.push(method);
 if (method === 'GetSystemPreferences') return {};
 if (method === 'GetSnapshot') return structuredClone(snapshot);
 if (method === 'ProbeProfile') { window.__probeDraft = args[0].draft; if (window.__probeFail) throw new Error('模拟上游不可用'); return {modelCount:3,models:[{id:'gpt-image-2.5-sunburst'},{id:'custom-image-v2'},{id:'custom-image-v2'}]}; }
 if (method === 'PatchPreferences') { Object.assign(snapshot.preferences,args[1]); snapshot.revision++; emit('desktop-settings-changed',{revision:snapshot.revision}); return structuredClone(snapshot); }
 if (method === 'SaveProfile') { const req=args[0]; if(req.expectedRevision!==snapshot.revision)throw new Error('配置版本冲突'); const existing=snapshot.profiles.find(p=>p.id===req.profile.id); const saved={...req.profile,hasAPIKey:req.credential.action==='replace'||existing?.hasAPIKey||false}; snapshot.profiles=existing?snapshot.profiles.map(p=>p.id===saved.id?saved:p):[...snapshot.profiles,saved]; snapshot.revision++; emit('desktop-settings-changed',{revision:snapshot.revision}); return structuredClone(snapshot); }
 return null;
}};
` }));
  await page.goto('/?window=settings');
  await expect(page.getByRole('heading', { name: '连接与模型', exact: true })).toBeVisible();
  await expect(page.getByLabel('名称', { exact: true })).toHaveValue('测试连接');
}

async function calls(page: Page) { return page.evaluate(() => (window as any).__calls as string[]); }

test('settings probes the current draft and merges custom models without saving or bootstrapping a workspace', async ({ page }) => {
  await settings(page);
  await page.getByLabel('服务地址', { exact: false }).fill('https://draft.example.invalid');
  await page.getByRole('button', { name: '测试连接并获取模型' }).click();
  await expect(page.getByRole('status')).toContainText('连接成功');
  await expect(page.getByRole('button', { name: 'custom-image-v2', exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'custom-image-v2', exact: true }).click();
  await expect(page.getByLabel('图像模型', { exact: true })).toHaveValue('custom-image-v2');
  await page.getByLabel('自定义模型', { exact: true }).fill('my-model-one');
  await page.getByRole('button', { name: '添加', exact: true }).click();
  await page.getByLabel('自定义模型', { exact: true }).fill('my-model-two');
  await page.getByRole('button', { name: '添加', exact: true }).click();
  await page.getByRole('button', { name: 'my-model-two', exact: true }).click();
  await expect(page.getByLabel('图像模型', { exact: true })).toHaveValue('my-model-two');
  const before = await calls(page);
  expect(before).not.toContain('SaveProfile'); expect(before).not.toContain('Initialize'); expect(before).not.toContain('Generate');
  expect(await page.evaluate(() => (window as any).__probeDraft.baseURL)).toBe('https://draft.example.invalid');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('配置已保存');
  expect((await calls(page)).filter(name => name === 'SaveProfile')).toHaveLength(1);
});

test('failed models request and external edits preserve an unsaved draft', async ({ page }) => {
  await settings(page);
  await page.getByLabel('名称', { exact: true }).fill('我的未保存草稿');
  await page.evaluate(() => { (window as any).__probeFail=true; });
  await page.getByRole('button', { name: '测试连接并获取模型' }).click();
  await expect(page.getByRole('alert')).toContainText('模拟上游不可用');
  await expect(page.getByLabel('图像模型', { exact: true })).toHaveValue('gpt-image-2.5-sunburst');
  await page.evaluate(() => { const w=window as any; w.__snapshot.profiles[0].name='另一窗口的更改'; w.__snapshot.revision++; w.__emit('desktop-settings-changed',{revision:w.__snapshot.revision}); });
  await expect(page.getByLabel('名称', { exact: true })).toHaveValue('我的未保存草稿');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('另一窗口更改');
  expect(await calls(page)).not.toContain('SaveProfile');
});

test('settings closes through save/discard/edit choices and traps dialog keyboard focus', async ({ page }) => {
  await settings(page);
  await page.getByLabel('名称', { exact: true }).fill('未保存名称');
  await page.getByRole('button', { name: '关闭设置' }).click();
  const dialog=page.getByRole('dialog'); await expect(dialog).toBeVisible();
  await page.getByRole('button', { name: '继续编辑', exact: true }).focus();
  await page.keyboard.press('Shift+Tab'); await expect(dialog.getByRole('button', { name: '保存', exact: true })).toBeFocused();
  await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: '关闭设置' })).toBeFocused();
  expect(await calls(page)).not.toContain('CloseSettingsWindow');
  expect(await calls(page)).toContain('CancelSettingsCloseRequest');
  await page.getByRole('button', { name: '关闭设置' }).click();
  await dialog.getByRole('button', { name: '不保存' }).click();
  await expect.poll(async () => (await calls(page)).includes('CloseSettingsWindow')).toBe(true);
});

for (const colorScheme of ['light','dark'] as const) {
  for (const scale of [1,2]) {
    test(`settings ${colorScheme} ${scale*100}% preserves readable layout and single-click navigation`, async ({ page }, info) => {
      await page.setViewportSize({width:960,height:640}); await page.emulateMedia({colorScheme}); await settings(page,scale);
      // Product default is light even on a dark OS. Exercise the retained dark palette explicitly.
      expect(await page.evaluate(()=>document.documentElement.dataset.theme)).toBe('light');
      if (colorScheme === 'dark') await page.evaluate(() => {
        document.documentElement.classList.add('dark'); document.documentElement.dataset.theme='dark';
        document.documentElement.style.colorScheme='dark'; document.documentElement.style.backgroundColor='#1C1C1E';
      });
      for(const label of ['通用','文件','通知','显示','数据','关于','连接与模型']) {
        await page.getByRole('navigation',{name:'设置分类'}).getByRole('button',{name:label,exact:true}).click();
        await expect(page.getByRole('heading',{name:label,exact:true})).toBeVisible();
        await expect(page).toHaveTitle(label+' · 设置');
      }
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      expect(await page.evaluate(()=>document.documentElement.dataset.theme)).toBe(colorScheme);
      expect(await page.locator('.desktop-settings-window').evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(14 * scale - 0.1);
      await page.screenshot({path:info.outputPath(`settings-${colorScheme}-${scale*100}.png`),fullPage:true});
    });
  }
}
