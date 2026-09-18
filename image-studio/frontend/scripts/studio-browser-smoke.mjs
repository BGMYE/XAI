import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir, writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';

// Exercise the production build with no credentials or paid API requests.
const out = new URL('../studio-evidence/', import.meta.url);
await mkdir(out, {recursive: true});
const server = spawn(process.execPath, [
  'node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1',
  '--port', '4173', '--strictPort',
], {stdio: 'inherit'});
let browser;
const checks = [], errors = [], external = [];
const pass = name => { checks.push(name); console.log('PASS:', name); };

try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch('http://127.0.0.1:4173/')).ok) { ready = true; break; }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, 'Preview server must start');
  browser = await chromium.launch({headless: true});
  const context = await browser.newContext({viewport: {width: 1440, height: 900}, locale: 'zh-CN'});
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (['http:', 'https:'].includes(url.protocol) && url.hostname !== '127.0.0.1') {
      external.push(url.origin);
      await route.abort();
    } else {
      await route.continue();
    }
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());

  try {
    await page.goto('http://127.0.0.1:4173/', {waitUntil: 'networkidle'});
    await page.getByRole('heading', {name: '用 AI，创造无限可能'}).waitFor();
    assert.equal(await page.locator('.studio-stats strong').first().textContent(), '0');
    assert.equal(await page.locator('.studio-asset-tile').count(), 0);
    const fonts = await page.locator('.studio-welcome h1,.studio-sidebar button,.studio-search input')
      .evaluateAll(elements => elements.map(element => getComputedStyle(element).fontFamily));
    assert.equal(new Set(fonts).size, 1);
    assert.ok(fonts[0].includes('Noto Sans CJK SC'), 'Complete CJK fallback is available');
    await page.screenshot({path: new URL('home-1440.png', out).pathname});
    pass('Homepage uses actual empty data and unified CJK typography');

    await page.locator('.studio-quick-grid button').filter({hasText: '新建工作流'}).click();
    await page.getByRole('region', {name: '无限画布'}).waitFor();
    const heading = await page.locator('.studio-page-heading.compact').boundingBox();
    assert.ok(heading.height < 100, 'Desktop canvas header stays compact');
    await page.getByRole('button', {name: '添加第一个节点'}).click();
    await page.locator('.studio-inspector textarea').fill('清晨的雪山与湖泊，柔和自然光。');
    await page.getByTitle('添加图像生成节点', {exact: true}).click();
    await page.locator('.studio-inspector textarea').fill('细腻的写实摄影。');
    await page.getByTitle('添加视频生成节点', {exact: true}).click();
    await page.locator('.studio-inspector textarea').fill('镜头缓慢向前，湖面泛起涟漪。');
    await page.getByTitle('适配全部', {exact: true}).click();
    assert.equal(await page.locator('.studio-node').count(), 3);
    await page.getByRole('button', {name: '从提示词连线', exact: true}).click();
    await page.getByRole('button', {name: '连接到图像生成', exact: true}).click();
    await page.getByRole('button', {name: '从图像生成连线', exact: true}).click();
    await page.getByRole('button', {name: '连接到视频生成', exact: true}).click();
    assert.equal(await page.locator('.studio-edge-hit').count(), 2);
    pass('Prompt to image to video workflow can be connected');

    const node = page.locator('.studio-node.kind-video');
    const before = await node.getAttribute('style');
    const box = await node.locator('header').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 55, {steps: 8});
    await page.mouse.up();
    assert.notEqual(await node.getAttribute('style'), before);
    await page.locator('.studio-board').focus();
    await page.keyboard.press('Delete');
    assert.equal(await page.locator('.studio-node').count(), 2);
    assert.equal(await page.locator('.studio-edge-hit').count(), 1);
    await page.keyboard.press('Control+z');
    assert.equal(await page.locator('.studio-node').count(), 3);
    assert.equal(await page.locator('.studio-edge-hit').count(), 2);
    const zoom = await page.locator('.studio-zoom span').textContent();
    const board = await page.locator('.studio-board').boundingBox();
    await page.mouse.move(board.x + board.width / 2, board.y + board.height / 2);
    await page.mouse.wheel(0, -120);
    await page.waitForTimeout(200);
    assert.notEqual(await page.locator('.studio-zoom span').textContent(), zoom);
    await page.getByTitle('适配全部', {exact: true}).click();
    pass('Canvas drag, delete, undo, fit and pointer zoom');
    await page.waitForTimeout(1800);
    assert.equal(await page.locator('.studio-error-banner').count(), 0);
    await page.screenshot({path: new URL('canvas-1440.png', out).pathname});

    const downloading = page.waitForEvent('download');
    await page.getByRole('button', {name: '导出无密钥模板'}).click();
    const download = await downloading;
    const stream = await download.createReadStream();
    let text = '';
    for await (const chunk of stream) text += chunk;
    const template = JSON.parse(text);
    assert.equal(template.schemaVersion, 1);
    assert.equal(template.nodes.length, 3);
    assert.equal(template.edges.length, 2);
    assert.ok(!text.includes('apiKey'));
    assert.ok(!text.includes('credentialId'));
    await page.reload({waitUntil: 'networkidle'});
    await page.locator('.studio-mode-switch button').filter({hasText: '专业模式'}).click();
    await page.locator('.studio-node').first().waitFor();
    assert.equal(await page.locator('.studio-node').count(), 3);
    assert.equal(await page.locator('.studio-edge-hit').count(), 2);
    pass('Autosave survives reload and export excludes credentials');

    const chooser = page.waitForEvent('filechooser');
    await page.getByTitle('导入参考图', {exact: true}).click();
    await (await chooser).setFiles({
      name: 'local-reference.png', mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5v8AAAAASUVORK5CYII=', 'base64'),
    });
    await page.locator('.studio-node.kind-asset').waitFor();
    assert.equal(await page.locator('.studio-node').count(), 4);
    await page.waitForTimeout(1000);
    pass('Local import attaches an image node');

    // A saved classic-editor dark setting must not make light controls unreadable.
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    const canvasSelectColor = await page.getByRole('combobox', {name: '选择画布'})
      .evaluate(element => getComputedStyle(element).color);
    assert.equal(canvasSelectColor, 'rgb(37, 60, 98)');
    await page.locator('.studio-sidebar button').filter({hasText: '设置'}).click();
    await page.getByRole('heading', {name: '工作室设置'}).waitFor();
    assert.ok(await page.getByRole('button', {name: '保存配置', exact: true}).isDisabled());
    const colors = await page.locator('.studio-provider-form input,.studio-provider-form select')
      .evaluateAll(elements => elements.map(element => getComputedStyle(element).color));
    assert.ok(colors.length > 0 && colors.every(color => color === 'rgb(37, 60, 98)'));
    await page.screenshot({path: new URL('settings-1440.png', out).pathname});
    pass('Browser preview blocks key persistence; classic dark mode cannot leak into controls');

    await page.locator('.studio-sidebar button').filter({hasText: '首页'}).click();
    for (const size of [{width: 1100, height: 780}, {width: 760, height: 900}]) {
      await page.setViewportSize(size);
      await page.waitForTimeout(150);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({path: new URL(`home-${size.width}.png`, out).pathname});
    }
    pass('Responsive layout at 1100 and 760 pixels');
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    pass('No uncaught errors or external network calls');
  } catch (error) {
    await page.screenshot({path: new URL('failure.png', out).pathname}).catch(() => {});
    throw error;
  }
} finally {
  await writeFile(new URL('report.json', out), JSON.stringify({checks, errors, external}, null, 2));
  await browser?.close();
  server.kill('SIGTERM');
}
