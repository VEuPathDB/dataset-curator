import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generator } from '../shared/scripts/genome/record.js';

const repoVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8')).version;

const copyRecordTo = (root) => {
  const copy = join(root, 'a/b/c/d');
  mkdirSync(copy, { recursive: true });
  cpSync(fileURLToPath(new URL('../shared/scripts/genome/record.js', import.meta.url)), join(copy, 'record.js'));
  return pathToFileURL(join(copy, 'record.js')).href;
};

test('importing record.js reads no package.json; asking for the generator with none reachable says so', async () => {
  const record = await import(copyRecordTo(mkdtempSync(join(tmpdir(), 'no-package-'))));
  assert.equal(record.SCHEMA_VERSION, 1);
  assert.throws(() => record.generator(), /Cannot read package\.json/);
  assert.throws(() => record.recordHeader(), /Cannot read package\.json/);
});

test('a package.json without a version string is not a version', async () => {
  const noVersion = mkdtempSync(join(tmpdir(), 'no-version-'));
  writeFileSync(join(noVersion, 'package.json'), JSON.stringify({ name: 'x', type: 'module' }));
  const record = await import(copyRecordTo(noVersion));
  assert.throws(() => record.generator(), /Cannot read package\.json/);
});

test('the generator version is the package version, from shared/scripts and from a skill copy', async () => {
  assert.equal(generator().version, repoVersion);
  const root = mkdtempSync(join(tmpdir(), 'plugin-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '9.9.9', type: 'module' }));
  const copy = join(root, 'skills/verify-genome/scripts/genome');
  mkdirSync(copy, { recursive: true });
  cpSync(fileURLToPath(new URL('../shared/scripts/genome/record.js', import.meta.url)), join(copy, 'record.js'));
  const { generator: fromSkill } = await import(pathToFileURL(join(copy, 'record.js')).href);
  assert.equal(fromSkill().version, '9.9.9');
});
