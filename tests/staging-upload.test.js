import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { stageFile } from '../shared/scripts/lib/staging-upload.js';

/** Local "host": sh runs for real, rsync copies the file into the target directory; every call is recorded. */
function localExec() {
  const calls = [];
  const exec = (cmd, args) => {
    calls.push([cmd, ...args]);
    if (cmd === 'rsync') {
      const [src, dest] = args.slice(-2);
      mkdirSync(dest, { recursive: true });
      copyFileSync(src, join(dest, basename(src)));
      return '';
    }
    return execFileSync(cmd, args, { encoding: 'utf-8' });
  };
  return { exec, calls };
}

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'stage-'));
  const file = join(root, 'products.tsv');
  writeFileSync(file, 'a\tb\n');
  return { root: join(root, 'dataStaging'), file };
}

test('stageFile copies the file into <root>/<proposal>/ and reports its digest', () => {
  const { root, file } = setup();
  const { exec, calls } = localExec();
  const out = stageFile({ host: null, root, proposalId: 'tfakST1_productNames_20261111', localPath: file, exec });
  assert.equal(readFileSync(join(root, 'tfakST1_productNames_20261111', 'products.tsv'), 'utf-8'), 'a\tb\n');
  assert.equal(out.file, 'products.tsv');
  assert.equal(out.path, join(root, 'tfakST1_productNames_20261111', 'products.tsv'));
  assert.match(out.sha256, /^[0-9a-f]{64}$/);
  assert.equal(out.alreadyStaged, false);
  assert.ok(calls.some((c) => c[0] === 'rsync'));
});

test('stageFile is a no-op for the same file and refuses a different one already there', () => {
  const { root, file } = setup();
  const { exec } = localExec();
  stageFile({ host: null, root, proposalId: 'p1', localPath: file, exec });
  assert.equal(stageFile({ host: null, root, proposalId: 'p1', localPath: file, exec }).alreadyStaged, true);
  writeFileSync(file, 'changed\n');
  assert.throws(() => stageFile({ host: null, root, proposalId: 'p1', localPath: file, exec }), /already holds products\.tsv with a different sha256/);
});

test('stageFile refuses a proposal id that is not a plain name', () => {
  const { root, file } = setup();
  assert.throws(() => stageFile({ host: null, root, proposalId: '../x', localPath: file, exec: localExec().exec }), /plain directory name/);
  assert.equal(existsSync(join(root, 'x')), false);
});
