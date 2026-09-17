import { expect, test, type Page, type Locator } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const evidence = resolve('../../.tmp/hig-evidence');
const fixtureImage = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#b8cbd8"/><circle cx="128" cy="128" r="70" fill="#5c778c"/></svg>');

async function studio(page: Page) {
  await page.addInitScript(() => { (window as any)._wails = { invoke() {} }; });
  await page.route(/@wailsio_runtime\.js/, route => route.fulfill({ contentType: 'text/javascript', body: `
const listeners=new Map(); window.__calls=[]; window.__requests=[];
window.__emit=(name,data)=>(listeners.get(name)||[]).forEach(cb=>cb({data}));
const on=(name,cb)=>{const list=listeners.get(name)||[];listeners.set(name,[...list,cb]);return()=>listeners.set(name,(listeners.get(name)||[]).filter(entry=>entry!==cb));};
export const Events={On:on,OnMultiple:on,Off:(...names)=>names.forEach(name=>listeners.delete(name))};
export const Window={Close:async()=>{},IsFullscreen:async()=>false}; export const Application={Quit:async()=>{}};
export const Call={ByName:async(name,...args)=>{
const method=name.split('.').pop();window.__calls.push(method);
if(method==='GetSystemPreferences')return {};
if(method==='OpenImageDialog')return {path:'/test/reference.png',size:1024,previewWidth:256,previewHeight:256,previewUrl:${JSON.stringify(fixtureImage)}};
if(method==='RegisterImportedImageAsset'||method==='RegisterMediaAsset')return {savedPath:args[0],previewWidth:256,previewHeight:256,previewUrl:${JSON.stringify(fixtureImage)},fullUrl:${JSON.stringify(fixtureImage)}};
if(method==='ReadTextFile')return '{"model":"fixture-model","result":"ok"}';
if(method==='GetStoredAPIKey')return 'synthetic-test-credential';
if(method==='GetOutputDir')return '/test/output';
if(method==='Generate'||method==='Edit'){const p=args[0];window.__requests.push({method,model:p.imageModelID,size:p.size,quality:p.quality,jobId:p.requestedJobId});return {jobId:p.requestedJobId};}
return null;
}};
` }));
  await page.goto('/?preview=windows-right-rail');
  await expect(page.getByRole('heading', { name: '创作', exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const { useStudioStore } = await import('/src/state/studioStore.ts');
    (window as any).__studio = useStudioStore;
    const current = useStudioStore.getState();
    useStudioStore.setState({ apiKey: 'synthetic-test-credential', batchCount: 1, savePromptSuppressed: true, completionSound: { ...current.completionSound, enabled: false }, profiles: current.profiles.map(profile => ({ ...profile, modelIDs: [profile.imageModelID, 'custom-model'] })) });
  });
}

async function value(page: Page, key: string) { return page.evaluate(key => (window as any).__studio.getState()[key], key); }
async function appearance(page: Page, dark: boolean, scale: number) {
  await page.evaluate(({ dark, scale }) => {
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
    document.documentElement.style.backgroundColor = dark ? '#1C1C1E' : '#F5F5F7';
    (window as any).__studio.getState().setFontScale(scale);
  }, { dark, scale });
}

// Sample the rendered backdrop after hiding only the foreground glyphs. This includes
// translucent surfaces, blur, and sidebar tint instead of assuming a solid CSS token.
async function contrast(page: Page, target: Locator) {
  const original=await target.evaluate(element=>{
    const node=element as HTMLElement; const css=getComputedStyle(node); const rect=node.getBoundingClientRect();
    const original={color:css.color,style:node.getAttribute('style'),x:rect.x,y:rect.y,width:rect.width,height:rect.height};
    node.style.setProperty('color','transparent','important'); node.dataset.contrastSample='true'; return original;
  });
  const hideGlyphs=await page.addStyleTag({content:'[data-contrast-sample="true"] *, [data-contrast-sample="true"]::before, [data-contrast-sample="true"]::after {color:transparent!important;text-shadow:none!important;}'});
  const shot=(await page.screenshot()).toString('base64');
  await target.evaluate((element,style)=>{element.removeAttribute('data-contrast-sample');if(style===null)element.removeAttribute('style');else element.setAttribute('style',style);},original.style);
  await hideGlyphs.evaluate(element=>element.remove());
  return page.evaluate(async({shot,original})=>{
    const image=new Image(); image.src=`data:image/png;base64,${shot}`; await image.decode();
    const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height; const ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0);
    const foreground=original.color.match(/[\d.]+/g)!.slice(0,3).map(Number);
    const luminance=(rgb:number[])=>rgb.map(channel=>channel/255).map(channel=>channel<=0.04045?channel/12.92:((channel+0.055)/1.055)**2.4).reduce((sum,channel,index)=>sum+channel*[0.2126,0.7152,0.0722][index],0);
    const foregroundLuminance=luminance(foreground); let minimum=Infinity;let backdrop:number[]=[];
    for(const fx of [.25,.5,.75])for(const fy of [.3,.5,.7]){
      const pixel=Array.from(ctx.getImageData(Math.floor(original.x+original.width*fx),Math.floor(original.y+original.height*fy),1,1).data).slice(0,3);const backgroundLuminance=luminance(pixel);
      const ratio=(Math.max(foregroundLuminance,backgroundLuminance)+.05)/(Math.min(foregroundLuminance,backgroundLuminance)+.05);
      if(ratio<minimum){minimum=ratio;backdrop=pixel;}
    }
    return {foreground,backdrop,minimumRatio:Number(minimum.toFixed(2))};
  },{shot,original});
}

test('simple controls, reference import/removal, generation and cancellation use real store state', async ({ page }) => {
  await studio(page);
  await page.getByLabel('提示词', { exact: true }).fill('清晨的静物摄影');
  await page.getByLabel('图像模型', { exact: true }).selectOption({ label: 'custom-model' });
  await expect.poll(() => value(page, 'imageModelID')).toBe('custom-model');
  await page.getByLabel('图像比例').selectOption('16:9');
  expect(await value(page, 'size')).not.toBe('1024x1024');
  await page.getByLabel('生成张数').selectOption('3');
  expect(await value(page, 'batchCount')).toBe(3);
  await page.getByRole('button', { name: '参数', exact: true }).click();
  await page.getByRole('combobox', { name: '输出格式', exact: true }).selectOption('webp');
  await page.getByRole('combobox', { name: '背景', exact: true }).selectOption('transparent');
  expect(await value(page, 'outputFormat')).toBe('webp');
  const initialSources=(await value(page,'sources')).length;
  await page.getByRole('button', { name: '添加参考图', exact: true }).click();
  await expect.poll(async () => (await value(page,'sources')).length).toBe(initialSources+1);
  await page.getByRole('button', { name: `删除参考图 ${initialSources+1}`, exact: true }).click();
  await expect.poll(async () => (await value(page,'sources')).length).toBe(initialSources);
  await page.getByLabel('生成张数').selectOption('1');
  await page.getByRole('button', { name: '生成图片', exact: true }).click();
  await expect(page.getByRole('button', { name: '停止生成', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__requests.length)).toBe(1);
  await page.getByRole('button', { name: '停止生成', exact: true }).click();
  await expect(page.getByRole('button', { name: '生成图片', exact: true })).toBeVisible();
  expect(await value(page,'isRunning')).toBe(false);
  expect(await page.evaluate(() => (window as any).__calls)).toContain('Cancel');
});

test('workspace keyboard menu, rename dialog and switching retain the prompt', async ({ page }) => {
  await studio(page);
  const original=await page.getByLabel('当前工作区').inputValue();
  await page.getByLabel('提示词', { exact:true }).fill('保留在原工作区的提示词');
  await page.getByRole('button',{name:'工作区操作'}).click();
  await expect(page.getByRole('menuitem',{name:'新建工作区'})).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('提示词',{exact:true})).toHaveValue('');
  await page.getByRole('button',{name:'工作区操作'}).click();
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  const dialog=page.getByRole('dialog',{name:'重命名工作区'});
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('工作区名称').fill('第二工作区');
  await dialog.getByRole('button',{name:'保存名称'}).click();
  await expect(page.getByLabel('当前工作区')).toContainText('第二工作区');
  await page.getByLabel('当前工作区').selectOption(original);
  await expect(page.getByLabel('提示词',{exact:true})).toHaveValue('保留在原工作区的提示词');
  await page.getByRole('button',{name:'工作区操作'}).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button',{name:'工作区操作'})).toBeFocused();
});

test('library filters, inline diagnostics, delete confirmation and prompt reuse are accessible', async ({ page }) => {
  await studio(page);
  await page.getByRole('button',{name:'查看全部',exact:true}).click();
  await page.getByRole('searchbox',{name:'搜索作品'}).fill('小猫');
  const cards=page.locator('.studio-library-list .studio-result-card');
  await expect(cards).toHaveCount(3);
  await page.getByLabel('作品类型').selectOption('edit');
  await expect(cards).toHaveCount(1);
  await cards.getByRole('button',{name:'作品操作'}).click();
  await page.getByRole('menuitem',{name:/删除/}).click();
  const dialog=page.getByRole('dialog',{name:'删除作品'});
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible();
  await cards.getByRole('button',{name:/查看作品/}).click();
  await expect(page.getByRole('heading',{name:'作品详情',exact:true})).toBeVisible();
  await page.getByText('诊断信息',{exact:true}).click();
  await expect(page.getByLabel('原始上游响应')).toContainText('fixture-model');
  await page.getByRole('button',{name:'应用提示词',exact:true}).click();
  await expect(page.getByRole('main',{name:'无限画布'})).toBeVisible();
  expect(await value(page,'prompt')).toContain('小猫');
});

for(const dark of [false,true]) test(`composited ${dark?'dark':'light'} functional surfaces meet text contrast`,async({page})=>{
  await page.setViewportSize({width:1440,height:980}); await studio(page);await appearance(page,dark,1);await mkdir(evidence,{recursive:true});
  const measurements:Record<string,Awaited<ReturnType<typeof contrast>>>={};
  measurements.title=await contrast(page,page.locator('.studio-window-name'));
  measurements.sidebar=await contrast(page,page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'作品',exact:true}));
  measurements.contentSecondary=await contrast(page,page.locator('.studio-page-header p').first());
  await page.getByRole('button',{name:'工作区操作'}).click();
  measurements.menu=await contrast(page,page.getByRole('menuitem',{name:'新建工作区'}));
  await page.screenshot({path:resolve(evidence,`${dark?'dark':'light'}-workspace-menu.png`)});
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'工作区操作'}).click(); await page.getByRole('menuitem',{name:'重命名工作区'}).click();
  await page.screenshot({path:resolve(evidence,`${dark?'dark':'light'}-rename-dialog.png`)});
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'查看全部',exact:true}).click();
  await page.locator('.studio-library-list .studio-result-card').first().getByRole('button',{name:'作品操作'}).click();
  await page.getByRole('menuitem',{name:'查看 raw 响应'}).click();
  await expect(page.getByRole('heading',{name:'作品详情',exact:true})).toBeVisible();await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByText('诊断信息',{exact:true}).click();await expect(page.getByLabel('原始上游响应')).toContainText('fixture-model');
  await page.screenshot({path:resolve(evidence,`${dark?'dark':'light'}-library-detail.png`)});
  await writeFile(resolve(evidence,`${dark?'dark':'light'}-contrast.json`),JSON.stringify(measurements,null,2));
  for(const [surface,measurement] of Object.entries(measurements))expect(measurement.minimumRatio,surface).toBeGreaterThanOrEqual(4.5);
});

test('professional canvas panels, masks, annotation undo/redo and zoom remain operable', async ({ page }) => {
  await page.setViewportSize({width:1440,height:980}); await studio(page);
  await page.getByRole('radio',{name:'专业模式',exact:true}).check();
  await page.getByRole('button',{name:'添加素材',exact:true}).click();
  await expect.poll(async()=> (await value(page,'sources')).some((item:any)=>item.path==='/test/reference.png')).toBe(true);
  await page.getByRole('combobox',{name:'生成质量',exact:true}).selectOption('high');
  await page.getByRole('combobox',{name:'参考图保真',exact:true}).selectOption('high');
  expect(await value(page,'quality')).toBe('high'); expect(await value(page,'inputFidelity')).toBe('high');
  await page.getByRole('button',{name:'局部绘制',exact:true}).click();
  await expect(page.getByRole('group',{name:'蒙版选项'})).toBeVisible();
  await page.getByRole('button',{name:'擦除',exact:true}).click(); expect(await value(page,'brushMode')).toBe('erase');
  await page.getByRole('button',{name:'标注',exact:true}).click();
  await expect(page.getByRole('group',{name:'标注选项'})).toBeVisible();
  const canvas=page.locator('.konvajs-content canvas').first(); const bounds=await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds!.x+bounds!.width/2-40,bounds!.y+bounds!.height/2-40); await page.mouse.down();
  await page.mouse.move(bounds!.x+bounds!.width/2+40,bounds!.y+bounds!.height/2+40,{steps:5}); await page.mouse.up();
  await expect.poll(async()=> (await value(page,'annotations')).length).toBe(1);
  await page.getByRole('button',{name:'撤销',exact:true}).click(); await expect.poll(async()=> (await value(page,'annotations')).length).toBe(0);
  await page.getByRole('button',{name:'重做',exact:true}).click(); await expect.poll(async()=> (await value(page,'annotations')).length).toBe(1);
  await page.getByLabel('画布缩放').selectOption('2'); expect((await value(page,'canvasViewport')).scale).toBe(2);
  await page.setViewportSize({width:960,height:640});
  await expect(page.getByRole('button',{name:'展开属性',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'展开属性',exact:true}).click(); await expect(page.getByRole('complementary',{name:'所选图层属性'})).toBeVisible();
  await page.getByRole('button',{name:'收起属性',exact:true}).last().click();
  await expect(page.getByRole('button',{name:'展开属性',exact:true})).toBeVisible();
});

for(const dark of [false,true]) for(const [width,height,scale] of [[960,640,1],[1440,980,1],[1920,1080,1],[960,640,2],[1440,980,2]]) {
  test(`visual ${dark?'dark':'light'} ${width}x${height} ${scale*100}%`,async({page})=>{
    await page.setViewportSize({width,height}); await studio(page); await appearance(page,dark,scale); await mkdir(evidence,{recursive:true});
    expect(await page.locator('.xai-app').evaluate(element=>parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(14*scale-0.1);
    const prefix=`${dark?'dark':'light'}-${width}x${height}-${scale*100}`;
    for(const mode of ['simple','pro','library']) {
      if(mode==='pro')await page.getByRole('radio',{name:'专业模式',exact:true}).check();
      if(mode==='library')await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'作品',exact:true}).click();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${mode} document width`).toBe(true);
      const titlebar=page.locator('.studio-titlebar');
      expect(await titlebar.evaluate(element=>element.scrollWidth<=element.clientWidth),`${mode} titlebar width`).toBe(true);
      await page.screenshot({path:resolve(evidence,`${prefix}-${mode}.png`)});
    }
  });
}

test('reduced transparency, motion and contrast preferences apply to functional glass',async({page})=>{
  await studio(page); await page.emulateMedia({reducedMotion:'reduce',contrast:'more'});
  await page.evaluate(()=> {document.documentElement.dataset.reduceTransparency='true'; document.documentElement.dataset.highContrast='true';});
  const styles=await page.locator('.studio-titlebar').evaluate(element=>{const css=getComputedStyle(element);return{backdrop:css.backdropFilter,transition:css.transitionDuration,background:css.backgroundColor};});
  expect(styles.backdrop).toBe('none'); expect(styles.transition).toBe('0s'); expect(styles.background).toBe('rgb(255, 255, 255)');
  await mkdir(evidence,{recursive:true}); await page.screenshot({path:resolve(evidence,'accessible-high-contrast.png')});
  await writeFile(resolve(evidence,'accessibility.json'),JSON.stringify(styles,null,2));
});
