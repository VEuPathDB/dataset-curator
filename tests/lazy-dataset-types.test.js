import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { loadLazy } from '../shared/scripts/dataset-types/lazy.js';

const dir = mkdtempSync(join(tmpdir(), 'lazy-'));
const importer = join(dir, 'loader.mjs');
writeFileSync(importer, 'export const load = (spec) => import(spec);\n');

test('a module this skill does not carry gives a plain "does not include" error', async () => {
  // loader.mjs imports './absent.mjs' itself, as a registry imports a type module
  writeFileSync(importer, "export const load = () => import('./absent.mjs');\n");
  const loader = await import(`${pathToFileURL(importer).href}?absent`);
  await assert.rejects(loadLazy(loader.load, pathToFileURL(importer).href, 'dataset type x'), /This skill does not include dataset type x/);
});

test('a module missing from inside a carried module is a real fault and propagates', async () => {
  writeFileSync(join(dir, 'type.mjs'), "import './gone.mjs';\n");
  writeFileSync(importer, "export const load = () => import('./type.mjs');\n");
  const loader = await import(`${pathToFileURL(importer).href}?nested`);
  await assert.rejects(loadLazy(loader.load, pathToFileURL(importer).href, 'dataset type x'), (e) => e.code === 'ERR_MODULE_NOT_FOUND' && !/does not include/.test(e.message));
});

test('a carried module loads', async () => {
  writeFileSync(join(dir, 'ok.mjs'), 'export const v = 7;\n');
  writeFileSync(importer, "export const load = () => import('./ok.mjs');\n");
  const loader = await import(`${pathToFileURL(importer).href}?ok`);
  assert.equal((await loadLazy(loader.load, pathToFileURL(importer).href, 'dataset type x')).v, 7);
  rmSync(dir, { recursive: true, force: true });
});
