import assert from 'node:assert/strict';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5v8AAAAASUVORK5CYII=';

export async function testReferenceImports(context) {
  const page = await context.newPage();
  const checks = [];
  const reference = page.getByRole('combobox', {name: '参考图片', exact: true});
  const dropzone = page.getByRole('button', {name: '导入参考图', exact: true});
  const selected = async name => {
    await page.getByAltText(name, {exact: true}).waitFor();
    assert.equal(await reference.locator('option:checked').textContent(), name);
    await page.waitForFunction(() => {
      const image = document.querySelector('.studio-reference-dropzone img');
      return image?.complete && image.naturalWidth > 0;
    });
    return reference.inputValue();
  };
  const transfer = async (name, type = 'image/png', bytes = 0) => page.evaluateHandle(({name, type, bytes, png}) => {
    const data = new DataTransfer();
    const content = bytes ? new Uint8Array(bytes) : Uint8Array.from(atob(png), c => c.charCodeAt(0));
    data.items.add(new File([content], name, {type}));
    return data;
  }, {name, type, bytes, png});
  const paste = async data => page.evaluate(data => {
    const event = new ClipboardEvent('paste', {bubbles: true, cancelable: true, clipboardData: data});
    document.activeElement.dispatchEvent(event);
    return event.defaultPrevented;
  }, data);
  try {
    await page.goto('http://127.0.0.1:4173/');
    await page.getByRole('navigation', {name: '主导航'}).getByRole('button', {name: '创作', exact: true}).click();
    const chooser = page.waitForEvent('filechooser');
    await dropzone.click();
    await (await chooser).setFiles({name: 'reference-picked.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64')});
    const pickedID = await selected('reference-picked.png');
    checks.push('Clicking the reference area opens the local picker, selects the imported asset, and shows its preview');

    const prompt = page.getByRole('textbox', {name: '创作描述'});
    await prompt.fill('保留这段描述');
    const clipboardImage = await transfer('reference-pasted.png');
    assert.equal(await paste(clipboardImage), true);
    await clipboardImage.dispose();
    const pastedID = await selected('reference-pasted.png');
    assert.notEqual(pastedID, pickedID);
    assert.equal(await prompt.inputValue(), '保留这段描述');
    const text = await page.evaluateHandle(() => {
      const data = new DataTransfer();
      data.setData('text/plain', '这是普通文本');
      return data;
    });
    assert.equal(await paste(text), false, 'Plain text remains available to the focused input');
    await text.dispose();
    checks.push('Pasted images become the reference without replacing the prompt or consuming plain-text paste');

    const drag = await transfer('reference-dropped.png');
    await dropzone.dispatchEvent('dragenter', {dataTransfer: drag});
    assert.match(await dropzone.getAttribute('class'), /is-dragging/);
    await dropzone.locator('strong').dispatchEvent('dragenter', {dataTransfer: drag});
    await dropzone.locator('strong').dispatchEvent('dragleave', {dataTransfer: drag});
    assert.match(await dropzone.getAttribute('class'), /is-dragging/, 'Nested children do not clear the drop highlight');
    await dropzone.dispatchEvent('dragover', {dataTransfer: drag});
    await dropzone.dispatchEvent('drop', {dataTransfer: drag});
    await drag.dispose();
    const droppedID = await selected('reference-dropped.png');
    assert.notEqual(droppedID, pastedID);
    assert.doesNotMatch(await dropzone.getAttribute('class'), /is-dragging/);
    assert.equal(new URL(page.url()).pathname, '/');
    checks.push('Dragging a local image selects it, clears the highlight, and keeps the application open');

    for (const [name, type, bytes] of [['not-an-image.txt', 'text/plain', 0], ['too-large.png', 'image/png', 20 * 1024 * 1024 + 1]]) {
      const invalid = await transfer(name, type, bytes);
      await dropzone.dispatchEvent('drop', {dataTransfer: invalid});
      await invalid.dispose();
      await page.getByRole('alert').waitFor();
      assert.match(await page.getByRole('alert').textContent(), /20 MB/);
      assert.equal(await reference.inputValue(), droppedID, 'Invalid imports keep the current reference');
      await page.getByRole('button', {name: '关闭错误提示'}).click();
    }
    const multiple = await transfer('first.png');
    await multiple.evaluate(data => data.items.add(new File(['second'], 'second.png', {type: 'image/png'})));
    await dropzone.dispatchEvent('drop', {dataTransfer: multiple});
    await multiple.dispose();
    await page.getByRole('alert').waitFor();
    assert.match(await page.getByRole('alert').textContent(), /一次导入一张/);
    assert.equal(await reference.inputValue(), droppedID);
    await page.getByRole('button', {name: '关闭错误提示'}).click();
    await reference.selectOption(pickedID);
    await selected('reference-picked.png');
    checks.push('Invalid, oversized, and ambiguous multiple-file imports preserve the selected reference; saved assets remain selectable');

    // A cancelled canvas picker leaves a pending target in the shared file input.
    // Pasting into classic mode must explicitly ignore that target.
    await page.getByRole('button', {name: '专业模式', exact: true}).click();
    await page.getByRole('region', {name: '无限画布'}).waitFor();
    const nodes = await page.locator('.studio-node').count();
    const cancelled = page.waitForEvent('filechooser');
    await page.getByTitle('导入参考图', {exact: true}).click();
    await (await cancelled).setFiles([]);
    const outsideImage = await transfer('must-not-import.png');
    assert.equal(await paste(outsideImage), false, 'Classic paste listener is removed in professional mode');
    await outsideImage.dispose();
    await page.getByRole('button', {name: '简洁模式', exact: true}).click();
    const classicImage = await transfer('reference-after-cancel.png');
    assert.equal(await paste(classicImage), true);
    await classicImage.dispose();
    await selected('reference-after-cancel.png');
    await page.getByRole('button', {name: '专业模式', exact: true}).click();
    assert.equal(await page.locator('.studio-node').count(), nodes, 'Classic paste must not add a canvas node');
    checks.push('Classic imports cannot reuse a cancelled canvas destination, and other pages keep their clipboard behavior');
    return checks;
  } finally {
    await page.close();
  }
}
