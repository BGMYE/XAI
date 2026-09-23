import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Offline structural regression guard. Real compilation, provider HTTP mocks,
// key-storage tests and browser interactions remain separate CI steps.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Git checkouts can use CRLF on Windows. Normalize text before line-based
// parsing; the same workspace and release dependencies must pass on every OS.
const read = name => readFileSync(path.join(root, name), 'utf8').replace(/\r\n?/g, '\n');
const exists = name => existsSync(path.join(root, name));
const checks = [];
function check(name, fn) {fn(); checks.push(name); console.log(`PASS: ${name}`);}

check('Retired client and its dedicated launcher are absent', () => {
  for (const name of ['gio-client', 'android-shell', 'scripts/register-gio-linux-scheme.sh', 'scripts/verify-local-android-shell.mjs']) {
    assert.equal(exists(name), false, `${name} must not return to the desktop distribution`);
  }
});
check('Go workspace retains the Wails app and both shared modules', () => {
  const body = read('go.work').match(/^use\s*\(([\s\S]*?)^\)/m)?.[1];
  assert.ok(body, 'Expected an explicit Go workspace');
  const modules = body.split('\n').map(line => line.replace(/\/\/.*$/, '').trim()).filter(Boolean).sort();
  assert.deepEqual(modules, ['./go-cli', './image-studio', './shared/compat-go']);
  for (const module of modules) {
    const mod = read(`${module}/go.mod`);
    assert.doesNotMatch(mod, /gioui\.org|image-studio\/gio-client|\.\.\/gio-client/);
  }
  assert.match(read('image-studio/go.mod'), /github\.com\/wailsapp\/wails\/v2/);
});
check('Image/video generation, credentials and infinite canvas entry points remain', () => {
  for (const file of [
    'image-studio/main.go', 'image-studio/backend/credentials.go',
    'image-studio/backend/studio_v2.go', 'image-studio/backend/studio/engine.go',
    'image-studio/backend/studio/provider.go', 'image-studio/backend/studio/profiles.go',
    'image-studio/backend/studio/workflow_http_test.go',
    'image-studio/frontend/src/studio/StudioRoot.tsx',
    'image-studio/frontend/src/studio/Canvas.tsx',
    'image-studio/frontend/src/studio/useStudio.ts',
    'image-studio/frontend/scripts/studio-browser-smoke.mjs',
    'image-studio/frontend/src/app/App.tsx',
    'go-cli/pkg/client/images_api.go', 'shared/compat-go/go.mod',
  ]) assert.ok(exists(file), `Required entry missing: ${file}`);
  assert.match(read('image-studio/main.go'), /backend\.NewStudioV2\(svc\)/);
});
check('Release retains maintained targets and has no retired build dependency', () => {
  const release = read('.github/workflows/release.yml');
  assert.doesNotMatch(release, /build-gio-desktop|gio-client|image-studio-gio|gioui\.org|build-android-apk|android-shell|setup-android|setup-java/);
  const jobs = new Set([...release.matchAll(/^  ([\w-]+):\s*$/gm)].map(match => match[1]));
  const required = ['prepare-version', 'build-desktop', 'build-windows-installer',
    'build-windows-msix', 'build-windows-msixbundle', 'publish-release'];
  for (const job of required) assert.ok(jobs.has(job), `Required release job missing: ${job}`);
  // Check literal scalar/list dependencies in this workflow. Expressions are
  // deliberately rejected rather than guessed; extend this guard if introduced.
  for (const match of release.matchAll(/^    needs:(.*)((?:\n      - [^\n]+)*)/gm)) {
    const inline = match[1].trim();
    const needs = inline ? inline.replace(/^\[|\]$/g, '').split(',').map(x => x.trim())
      : [...match[2].matchAll(/\n      - ([^\n]+)/g)].map(x => x[1].trim());
    assert.ok(needs.length, 'Empty needs declaration');
    for (const need of needs) assert.ok(jobs.has(need), `Dangling release dependency: ${need}`);
  }
});
console.log(JSON.stringify({checks, failures: 0}, null, 2));
