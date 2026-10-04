import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'vite';

// Bundle the real save hook with a test-only in-memory Wails host. Inline
// execution needs no network or IndexedDB origin and allows deterministic
// in-flight writes and disk errors, rather than arbitrary sleep-based tests.
async function bundleHarness(file) {
  const result = await build({
    configFile: false,
    root: fileURLToPath(new URL('../', import.meta.url)),
    logLevel: 'silent',
    define: {'process.env.NODE_ENV': '"production"'},
    esbuild: {jsx: 'automatic'},
    build: {
      write: false,
      minify: false,
      lib: {
        entry: fileURLToPath(new URL(`../test/fixtures/${file}`, import.meta.url)),
        name: 'StudioRegression',
        formats: ['iife'],
      },
    },
  });
  const bundle = (Array.isArray(result) ? result[0] : result).output.find(item => item.type === 'chunk');
  assert.ok(bundle, `${file} must build`);
  return bundle;
}

export async function testDraftSaves(context) {
  const bundle = await bundleHarness('studio-save-harness.tsx');
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.setContent('<html><body><div id="root"></div></body></html>');
    await page.addScriptTag({content: bundle.code});
    await page.waitForFunction(() => window.__studio?.ready);
    // The snapshot deliberately lags creation. Navigation must flush the draft
    // map, not enumerate a snapshot that does not yet contain this project.
    await page.evaluate(async () => {
      window.__saveControl.staleSnapshot = true;
      await window.__studio.create({id: 'save-regression', name: '新画布', revision: 0, updatedAt: '', viewport: {x: 0, y: 0, zoom: 1}, nodes: [], edges: []});
    });
    await page.waitForFunction(() => Boolean(window.__studio.project));
    assert.equal(await page.evaluate(() => window.__studio.snapshot.projects.length), 0);
    await page.evaluate(async () => {
      const studio = window.__studio;
      studio.edit({...studio.project, name: '快照尚未包含的新草稿'});
      await studio.flushAll();
    });
    assert.equal(await page.evaluate(() => [...window.__saveControl.stored.values()][0].name), '快照尚未包含的新草稿');

    // A second edit made during an actual pending save must be persisted too.
    await page.evaluate(() => {
      const studio = window.__studio;
      window.__saveControl.holdNext = true;
      studio.edit({...studio.getProject(studio.activeID), name: '第一版'});
      window.__saving = studio.flushAll();
    });
    await page.waitForFunction(() => Boolean(window.__saveControl.release));
    await page.evaluate(async () => {
      const studio = window.__studio;
      studio.edit({...studio.getProject(studio.activeID), name: '保存期间继续编辑'});
      window.__saveControl.release();
      await window.__saving;
    });
    assert.equal(await page.evaluate(() => [...window.__saveControl.stored.values()][0].name), '保存期间继续编辑');

    // The navigation callback stays blocked after failure; the same draft can
    // be retried successfully without losing the user's changes.
    const failure = await page.evaluate(async () => {
      const studio = window.__studio;
      window.__saveControl.fail = true;
      studio.edit({...studio.getProject(studio.activeID), name: '磁盘失败后保留的草稿'});
      let navigated = false, message = '';
      try {await studio.flushAll(); navigated = true;} catch (error) {message = String(error);}
      return {navigated, message, draft: studio.getProject(studio.activeID).name};
    });
    assert.equal(failure.navigated, false);
    assert.match(failure.message, /模拟磁盘写入失败/);
    assert.equal(failure.draft, '磁盘失败后保留的草稿');
    await page.evaluate(async () => {window.__saveControl.fail = false; await window.__studio.flushAll();});
    assert.equal(await page.evaluate(() => [...window.__saveControl.stored.values()][0].name), '磁盘失败后保留的草稿');
    assert.deepEqual(errors, []);
    return ['Drafts missing from stale snapshots are flushed', 'Edits during in-flight saves survive', 'Save failure blocks navigation and retains the retryable draft'];
  } finally {
    await page.close();
  }
}

// The desktop host announces changes with runtime events and serves deltas.
// The window must follow them without polling or reloading whole snapshots.
export async function testChangeFeed(context) {
  const bundle = await bundleHarness('studio-sync-harness.tsx');
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const calls = () => page.evaluate(() => ({...window.__sync.backend.calls}));
  const job = id => ({
    id, state: 'running', progress: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    request: {id, profileId: 'p', projectId: 'feed', kind: 'image', prompt: '雪山', parameters: {}},
    profile: {id: 'p', name: 'Mock', baseUrl: '', protocol: 'openai', imageModel: 'm', videoModel: '', hasKey: true, allowLocal: false, updatedAt: ''},
  });
  try {
    await page.setContent('<html><body><div id="root"></div></body></html>');
    await page.addScriptTag({content: bundle.code});
    await page.waitForFunction(() => window.__studio?.ready);
    assert.equal((await calls()).snapshot, 1, 'The first load reads the whole snapshot');

    await page.evaluate(async () => {
      await window.__studio.create({id: 'feed', name: '画布', revision: 0, updatedAt: '', viewport: {x: 0, y: 0, zoom: 1}, nodes: [], edges: []});
    });
    assert.equal(await page.evaluate(() => window.__studio.snapshot.projects.length), 1);
    await page.evaluate(job => {
      window.__sync.addJob(job);
      window.__sync.emit('studio:changed', window.__sync.backend.revision);
    }, job('job-1'));
    await page.waitForFunction(() => window.__studio.snapshot.jobs.some(j => j.id === 'job-1'), null, {timeout: 3000});
    assert.equal((await calls()).snapshot, 1, 'Events are followed by deltas, not snapshots');
    // With events the window does not poll every few seconds.
    const settled = (await calls()).changes;
    await page.waitForTimeout(3000);
    assert.equal((await calls()).changes, settled, 'No polling while events arrive');

    const before = (await calls()).changes;
    await page.evaluate(() => window.__sync.emit('studio:progress', {jobId: 'job-1', percent: 42}));
    await page.waitForFunction(() => window.__studio.snapshot.jobs[0]?.progress === 42, null, {timeout: 3000});
    assert.equal((await calls()).changes, before, 'Progress events need no request');

    await page.evaluate(() => {
      window.__sync.touchProject('feed', '后台改名');
      window.__sync.emit('studio:changed');
    });
    await page.waitForFunction(() => window.__studio.getProject('feed')?.name === '后台改名', null, {timeout: 3000});

    await page.evaluate(job => {
      window.__sync.restart();
      window.__sync.addJob(job);
      window.__sync.emit('studio:changed');
    }, job('job-2'));
    await page.waitForFunction(
      () => window.__studio.snapshot.epoch === 'second-run' && window.__studio.snapshot.jobs.some(j => j.id === 'job-2'),
      null, {timeout: 3000},
    );
    assert.deepEqual(errors, []);
    return [
      'Change events refresh by delta without polling',
      'Progress events update running jobs without requests',
      'A restarted backend is reloaded in full',
    ];
  } finally {
    await page.close();
  }
}
