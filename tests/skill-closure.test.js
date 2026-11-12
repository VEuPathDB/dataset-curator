import { test } from 'node:test';
import assert from 'node:assert/strict';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeSkill, skillDirs, unreachableFiles } from '../bin/lib/skill-closure.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Files a skill carries that nothing in it reaches. Today this is empty; the dependency refactor
// (see docs) removes copies from sharedFiles, so any entry added here is a copy to trim, not a norm.
const KNOWN_UNREACHABLE = {};

for (const dir of skillDirs(ROOT)) {
  const skill = basename(dir);

  test(`${skill}: every relative import resolves to a file the skill carries`, () => {
    assert.deepEqual(analyzeSkill(dir).unresolved, []);
  });

  test(`${skill}: carries no file that nothing in it reaches`, () => {
    assert.deepEqual(unreachableFiles(dir), KNOWN_UNREACHABLE[skill] ?? []);
  });
}
