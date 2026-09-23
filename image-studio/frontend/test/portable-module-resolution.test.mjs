import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

// Vite 6 tries .mjs before .tsx for extensionless imports. Model both
// filesystem case modes, so Linux CI also catches macOS/Windows ambiguity.
const extensions = ['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json'];
const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url));
function runtimeFiles(root) {
  return readdirSync(root, {withFileTypes: true}).flatMap(entry => {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) return runtimeFiles(file);
    return entry.isFile() && extensions.includes(path.extname(file)) &&
      !/\.d\.(?:ts|mts)$/.test(file) ? [file] : [];
  });
}
function collisions(files) {
  const groups = new Map();
  for (const file of files) {
    const stem = file.slice(0, -path.extname(file).length).toLowerCase();
    groups.set(stem, [...(groups.get(stem) ?? []), file]);
  }
  return [...groups.values()].filter(group => group.length > 1);
}
function resolveImport(importer, specifier, files, ignoreCase) {
  const target = path.resolve(path.dirname(importer), specifier);
  const fold = value => ignoreCase ? value.toLowerCase() : value;
  const candidates = [target, ...extensions.map(ext => target + ext),
    ...extensions.map(ext => path.join(target, 'index' + ext))];
  for (const candidate of candidates) {
    const found = files.find(file => fold(file) === fold(candidate));
    if (found) return found;
  }
  return undefined;
}

test('portable imports: reproduces the PublicCatalog TSX/MJS case collision', () => {
  const importer = path.join(sourceRoot, 'fixture/PromptCenter.tsx');
  const ui = path.join(sourceRoot, 'fixture/PublicCatalog.tsx');
  const data = path.join(sourceRoot, 'fixture/publicCatalog.mjs');
  const files = [ui, data];
  assert.deepEqual(collisions(files), [[ui, data]]);
  assert.equal(resolveImport(importer, './PublicCatalog', files, false), ui);
  assert.equal(resolveImport(importer, './PublicCatalog', files, true), data);
});

test('portable imports: distinct component and data stems resolve identically', () => {
  const importer = path.join(sourceRoot, 'fixture/PromptCenter.tsx');
  const ui = path.join(sourceRoot, 'fixture/PublicPromptCatalog.tsx');
  const data = path.join(sourceRoot, 'fixture/publicCatalog.mjs');
  const files = [ui, data];
  assert.deepEqual(collisions(files), []);
  for (const ignoreCase of [false, true]) {
    assert.equal(resolveImport(importer, './PublicPromptCatalog', files, ignoreCase), ui);
    assert.equal(resolveImport(importer, './publicCatalog.mjs', files, ignoreCase), data);
  }
});

test('portable imports: declaration files do not shadow runtime modules', () => {
  const files = runtimeFiles(path.join(sourceRoot, 'studio'));
  assert.ok(files.some(file => file.endsWith('publicCatalog.mjs')));
  assert.ok(files.every(file => !/\.d\.(?:ts|mts)$/.test(file)));
});

test('portable imports: production source has no case-folded runtime stem collisions', () => {
  const conflicts = collisions(runtimeFiles(sourceRoot))
    .map(group => group.map(file => path.relative(sourceRoot, file)));
  assert.deepEqual(conflicts, [],
    'Rename ambiguous runtime modules; changing only letter case is not portable');
});

test('portable imports: PromptCenter selects the UI exports on every filesystem', () => {
  const importer = path.join(sourceRoot, 'studio/PromptCenter.tsx');
  const source = readFileSync(importer, 'utf8');
  const specifier = source.match(/import\s*\{[^}]*\bSourcePreview\b[^}]*\}\s*from\s*['"]([^'"]+)['"]/s)?.[1];
  assert.ok(specifier, 'PromptCenter must import its preview component');
  const files = runtimeFiles(sourceRoot);
  const sensitive = resolveImport(importer, specifier, files, false);
  const insensitive = resolveImport(importer, specifier, files, true);
  assert.ok(sensitive, 'The component import must exist');
  assert.equal(insensitive, sensitive, 'Case-insensitive builds must choose the same module');
  assert.equal(path.extname(sensitive), '.tsx', 'The component must not resolve to a data helper');
  const component = readFileSync(sensitive, 'utf8');
  assert.match(component, /export function SourcePreview\b/);
  assert.match(component, /export function PublicCatalog\b/);
});
