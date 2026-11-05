import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { readFastaIndex, writeFastaSubset } from '../shared/scripts/genome/fasta.js';
import { ECUN_FASTA, tempDir } from './genome-helpers.js';

const FASTA = '>chr1 first\nACGTACGTAC\nACGT\n>chr2 second\nAAAA\n>chr3\nCC\n';

test('readFastaIndex lists IDs and lengths from plain or gzipped FASTA', async () => {
  const dir = tempDir('fasta-');
  writeFileSync(join(dir, 'a.fna'), FASTA);
  writeFileSync(join(dir, 'a.fna.gz'), gzipSync(FASTA));
  const expected = [{ id: 'chr1', length: 14 }, { id: 'chr2', length: 4 }, { id: 'chr3', length: 2 }];
  assert.deepEqual(await readFastaIndex(join(dir, 'a.fna')), expected);
  assert.deepEqual(await readFastaIndex(join(dir, 'a.fna.gz')), expected);
});

test('CRLF FASTA reads as lines', async () => {
  const dir = tempDir('fasta-');
  writeFileSync(join(dir, 'crlf.fna'), '>a x\r\nAC\r\nGT\r\n');
  assert.deepEqual(await readFastaIndex(join(dir, 'crlf.fna')), [{ id: 'a', length: 4 }]);
});

test('writeFastaSubset keeps the chosen sequences, renamed in place', async () => {
  const dir = tempDir('fasta-');
  writeFileSync(join(dir, 'a.fna.gz'), gzipSync(FASTA));
  await writeFastaSubset(join(dir, 'a.fna.gz'), join(dir, 'out.fna'), new Set(['chr1', 'seq3']), new Map([['chr3', 'seq3']]));
  assert.equal(readFileSync(join(dir, 'out.fna'), 'utf-8'), '>chr1 first\nACGTACGTAC\nACGT\n>seq3\nCC\n');
});

test('writeFastaSubset resolves with the IDs it wrote', async () => {
  const dir = tempDir('fasta-');
  writeFileSync(join(dir, 'a.fna'), FASTA);
  const written = await writeFastaSubset(join(dir, 'a.fna'), join(dir, 'out.fna'), new Set(['chr2', 'seq3']), new Map([['chr3', 'seq3']]));
  assert.deepEqual(written, ['chr2', 'seq3']);
});

test('writeFastaSubset rejects on a duplicate written ID', async () => {
  const dir = tempDir('fasta-');
  writeFileSync(join(dir, 'dup.fna'), '>a\nAC\n>a\nGT\n');
  await assert.rejects(writeFastaSubset(join(dir, 'dup.fna'), join(dir, 'out.fna'), new Set(['a'])), /Duplicate FASTA ID a/);
});

test('a missing gzipped source rejects', async () => {
  const dir = tempDir('fasta-');
  await assert.rejects(readFastaIndex(join(dir, 'missing.fna.gz')), { code: 'ENOENT' });
  await assert.rejects(writeFastaSubset(join(dir, 'missing.fna.gz'), join(dir, 'out.fna'), new Set(['a'])), { code: 'ENOENT' });
});

test('an unopenable destination rejects', async () => {
  const dir = tempDir('fasta-');
  writeFileSync(join(dir, 'a.fna'), FASTA);
  await assert.rejects(writeFastaSubset(join(dir, 'a.fna'), join(dir, 'no-such-dir', 'out.fna'), new Set(['chr1'])), { code: 'ENOENT' });
});

test('a subset of every sequence copies the FASTA byte for byte', async () => {
  const out = join(tempDir('fasta-'), 'all.fna');
  await writeFastaSubset(ECUN_FASTA, out, new Set(['AL590449.1', 'AL590450.2']));
  assert.equal(readFileSync(out, 'utf-8'), gunzipSync(readFileSync(ECUN_FASTA)).toString('utf-8'));
});
