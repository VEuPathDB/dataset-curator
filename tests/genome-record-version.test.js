import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { GENERATOR } from '../shared/scripts/genome/record.js';

const repoVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8')).version;

test('the generator version is the package version, from shared/scripts and from a skill copy', async () => {
  assert.equal(GENERATOR.version, repoVersion);
  const root = mkdtempSync(join(tmpdir(), 'plugin-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '9.9.9', type: 'module' }));
  const copy = join(root, 'skills/verify-genome/scripts/genome');
  mkdirSync(copy, { recursive: true });
  cpSync(fileURLToPath(new URL('../shared/scripts/genome/record.js', import.meta.url)), join(copy, 'record.js'));
  const { GENERATOR: fromSkill } = await import(pathToFileURL(join(copy, 'record.js')).href);
  assert.equal(fromSkill.version, '9.9.9');
});
