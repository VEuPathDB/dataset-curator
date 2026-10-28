import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRemote, PRESENT } from '../shared/scripts/lib/remote.js';

test('a local remote lists, reads and pulls; missing paths are null', () => {
  const root = mkdtempSync(join(tmpdir(), 'remote-'));
  mkdirSync(join(root, 'd/sub'), { recursive: true });
  writeFileSync(join(root, 'd/b.txt'), 'b');
  writeFileSync(join(root, 'd/sub/a.txt'), 'a');
  const r = createRemote({ host: null });
  assert.deepEqual(r.list(join(root, 'd')), ['b.txt', 'sub']);
  assert.equal(r.list(join(root, 'nope')), null);
  assert.equal(r.readText(join(root, 'd/b.txt')), 'b');
  assert.equal(r.readText(join(root, 'd/none')), null);
  const dest = join(mkdtempSync(join(tmpdir(), 'pull-')), 'x');
  r.pull(join(root, 'd'), dest);
  assert.equal(readFileSync(join(dest, 'sub/a.txt'), 'utf-8'), 'a');
});

test('a host remote runs ssh with batch mode and no forwardings, and rsync over that ssh', () => {
  const calls = [];
  const exec = (cmd, args) => { calls.push([cmd, ...args]); return cmd === 'ssh' && args.at(-1).includes('[ -d') ? `${PRESENT}\nb\na\n` : ''; };
  const r = createRemote({ host: 'yew', exec });
  assert.deepEqual(r.list("/x/it's"), ['a', 'b']);
  assert.deepEqual(calls[0].slice(0, 6), ['ssh', '-o', 'BatchMode=yes', '-o', 'ClearAllForwardings=yes', 'yew']);
  assert.match(calls[0][6], /'\/x\/it'\\''s'/);
  const dest = join(mkdtempSync(join(tmpdir(), 'pull-')), 'dest');
  r.pull('/s/PRJ1', dest);
  assert.deepEqual(calls[1], ['rsync', '-a', '-e', 'ssh -o BatchMode=yes -o ClearAllForwardings=yes', 'yew:/s/PRJ1/', `${dest}/`]);
});

test('login banner text before the presence line is ignored; without the line the path is missing', () => {
  const banner = 'Welcome to yew\n+\nmaintenance Friday\n';
  const present = createRemote({ host: 'yew', exec: () => `${banner}${PRESENT}\nb\na\n` });
  assert.deepEqual(present.list('/x'), ['a', 'b']);
  assert.equal(present.readText('/x/f'), 'b\na\n');
  const absent = createRemote({ host: 'yew', exec: () => banner });
  assert.equal(absent.list('/x'), null);
  assert.equal(absent.readText('/x/f'), null);
});
