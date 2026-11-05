import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncShared } from '../bin/sync-shared.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const quiet = { log: () => {}, error: () => {} };

function tree() {
  const root = mkdtempSync(join(tmpdir(), 'sync-shared-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ sharedFiles: { 'resources/a.md': ['s1', 's2'] } }));
  mkdirSync(join(root, 'shared/resources'), { recursive: true });
  writeFileSync(join(root, 'shared/resources/a.md'), 'A\n');
  return root;
}

test('sync then check finds nothing to report', () => {
  const root = tree();
  assert.equal(syncShared({ rootDir: root, ...quiet }).errors, 0);
  assert.deepEqual(syncShared({ rootDir: root, check: true, ...quiet }).problems, []);
});

test('check names a differing and a missing copy and writes nothing', () => {
  const root = tree();
  syncShared({ rootDir: root, ...quiet });
  writeFileSync(join(root, 'skills/s1/resources/a.md'), 'edited\n');
  rmSync(join(root, 'skills/s2/resources/a.md'));
  const { problems } = syncShared({ rootDir: root, check: true, ...quiet });
  assert.deepEqual(problems, ['skills/s1/resources/a.md differs from shared/resources/a.md', 'skills/s2/resources/a.md is missing']);
  assert.equal(readFileSync(join(root, 'skills/s1/resources/a.md'), 'utf-8'), 'edited\n');
});

test('every skills/ copy in this repository matches shared/', () => {
  assert.deepEqual(syncShared({ rootDir: repoRoot, check: true, ...quiet }).problems, []);
});
