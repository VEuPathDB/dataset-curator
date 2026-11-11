import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
    return execFileSync(cmd, args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
  };
  return { exec, calls };
}

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'stage-'));
  const file = join(root, 'products.tsv');
  writeFileSync(file, 'a\tb\n');
  mkdirSync(join(root, 'dataStaging'));
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
  const { exec, calls } = localExec();
  stageFile({ host: null, root, proposalId: 'p1', localPath: file, exec });
  assert.equal(stageFile({ host: null, root, proposalId: 'p1', localPath: file, exec }).alreadyStaged, true);
  writeFileSync(file, 'changed\n');
  const before = calls.length;
  assert.throws(() => stageFile({ host: null, root, proposalId: 'p1', localPath: file, exec }), /already holds products\.tsv with a different sha256/);
  assert.equal(calls.slice(before).some((c) => c[0] === 'rsync'), false);
  assert.equal(readFileSync(join(root, 'p1', 'products.tsv'), 'utf-8'), 'a\tb\n');
});

test('stageFile refuses when the staging root does not exist and does not create it', () => {
  const { root, file } = setup();
  const missing = join(root, 'nope');
  assert.throws(() => stageFile({ host: null, root: missing, proposalId: 'p1', localPath: file, exec: localExec().exec }), /staging root .* does not exist on this machine/);
  assert.equal(existsSync(missing), false);
});

test('stageFile refuses a file name that is not plain', () => {
  const { root } = setup();
  const odd = join(root, 'my file.tsv');
  writeFileSync(odd, 'x\n');
  assert.throws(() => stageFile({ host: null, root, proposalId: 'p1', localPath: odd, exec: localExec().exec }), /plain file name/);
});

test('stageFile over a host runs ssh checks, then rsync with -- and --ignore-existing, then verifies', () => {
  const { root, file } = setup();
  const sha = createHash('sha256').update('a\tb\n').digest('hex');
  const dir = join(root, 'p1');
  const calls = [];
  let uploaded = false;
  const exec = (cmd, args) => {
    calls.push([cmd, ...args]);
    if (cmd === 'rsync') uploaded = true;
    return cmd === 'ssh' && uploaded && args.at(-1).includes('sha256sum') ? `__dataset-curator-present__\n${sha}  ${join(dir, 'products.tsv')}\n` : '';
  };
  const out = stageFile({ host: 'yew', root, proposalId: 'p1', localPath: file, exec });
  assert.equal(out.alreadyStaged, false);
  const sshOpts = ['-o', 'BatchMode=yes', '-o', 'ClearAllForwardings=yes'];
  assert.deepEqual(calls.map((c) => c[0]), ['ssh', 'ssh', 'rsync', 'ssh']);
  assert.deepEqual(calls[0].slice(0, 6), ['ssh', ...sshOpts, 'yew']);
  assert.match(calls[0][6], /\[ -d '.*dataStaging' \]/);
  assert.deepEqual(calls[1].slice(0, 6), ['ssh', ...sshOpts, 'yew']);
  assert.equal(calls[1][6], `mkdir -p '${dir}'`);
  assert.deepEqual(calls[2], ['rsync', '-rt', '--copy-links', '--chmod=F644', '--ignore-existing', '-e', `ssh ${sshOpts.join(' ')}`, '--', file, `yew:${dir}/`]);
});

test('stageFile throws when the file is missing or different after the upload', () => {
  const { root, file } = setup();
  assert.throws(() => stageFile({ host: null, root, proposalId: 'p1', localPath: file, exec: (cmd, args) => (cmd === 'rsync' ? '' : execFileSync(cmd, args, { encoding: 'utf-8' })) }), /lacks products\.tsv after upload/);
  const { exec } = localExec();
  const tampering = (cmd, args) => {
    const out = exec(cmd, args);
    if (cmd === 'rsync') writeFileSync(join(root, 'p2', 'products.tsv'), 'other\n');
    return out;
  };
  assert.throws(() => stageFile({ host: null, root, proposalId: 'p2', localPath: file, exec: tampering }), /after upload, expected .*re-run once your file is final; a data loader must remove .*p2.products\.tsv/);
});

test('stageFile names the host and the ssh requirement when ssh fails', () => {
  const { root, file } = setup();
  const failing = (status) => () => { throw Object.assign(new Error('denied'), { stderr: 'Permission denied', status }); };
  assert.throws(() => stageFile({ host: 'yew', root, proposalId: 'p1', localPath: file, exec: failing(255) }), /yew:.*Permission denied; needs passwordless ssh to yew; ask the data loaders/);
  assert.throws(() => stageFile({ host: 'yew', root, proposalId: 'p1', localPath: file, exec: failing(3) }), (e) => /Permission denied/.test(e.message) && !/passwordless/.test(e.message));
});

test('stageFile refuses a proposal id that is not a plain name', () => {
  const { root, file } = setup();
  assert.throws(() => stageFile({ host: null, root, proposalId: '../x', localPath: file, exec: localExec().exec }), /plain directory name/);
  assert.equal(existsSync(join(root, 'x')), false);
});
