import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { sha256File } from '../shared/scripts/lib/file-hash.js';

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

test('sha256File equals an in-memory hash for empty, small and multi-chunk files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'file-hash-'));
  const big = Buffer.alloc((1 << 20) * 2 + 17);
  for (let i = 0; i < big.length; i++) big[i] = i % 251;
  for (const [name, content] of [['empty', Buffer.alloc(0)], ['small', Buffer.from('>c1\nACGT\n')], ['big', big]]) {
    writeFileSync(join(dir, name), content);
    assert.equal(sha256File(join(dir, name)), sha(content), name);
  }
});

test('sha256File throws for a missing file', () => {
  assert.throws(() => sha256File(join(tmpdir(), 'no-such-file-for-file-hash')), /ENOENT/);
});
