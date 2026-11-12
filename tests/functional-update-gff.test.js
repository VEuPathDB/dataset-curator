import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gffDirectoryUrl, pickGff, releaseOf, fetchReleasedGff } from '../shared/scripts/dataset-types/functional-update/gff-source.js';
import { AMBIGUOUS, idIndex, idIndexOfFile, levelOfId, mapId } from '../shared/scripts/dataset-types/functional-update/gff-ids.js';
import { RELEASED_GFF } from './functional-update-helpers.js';

const row = (type, attrs) => ['chr1', 'VEuPathDB', type, 1, 90, '.', '+', '.', attrs].join('\t');
const tmp = () => mkdtempSync(join(tmpdir(), 'fu-gff-'));

test('gffDirectoryUrl, pickGff and releaseOf find the one release GFF', () => {
  assert.equal(gffDirectoryUrl('FungiDB', 'TfakeusST1'), 'https://fungidb.org/common/downloads/Current_Release/TfakeusST1/gff/data/');
  assert.equal(gffDirectoryUrl('FungiDB', 'A b', 'release-68'), 'https://fungidb.org/common/downloads/release-68/A%20b/gff/data/');
  assert.equal(pickGff('<a href="FungiDB-68_TfakeusST1.gff">x</a><a href="../">up</a>', 'u'), 'FungiDB-68_TfakeusST1.gff');
  assert.throws(() => pickGff('<a href="a.gff"></a><a href="b.gff"></a>', 'u'), /u lists 2 \.gff files \(a\.gff, b\.gff\); expected one/);
  assert.equal(releaseOf('FungiDB-68_TfakeusST1.gff'), '68');
  assert.throws(() => releaseOf('genes.gff'), /genes\.gff: no release number in the name/);
});

test('fetchReleasedGff lists the directory, then streams the file to destDir with its sha256', async () => {
  const seen = [];
  const fetchImpl = async (url, options) => {
    seen.push([url, options.signal instanceof AbortSignal]);
    return new Response(url.endsWith('/') ? '<a href="FungiDB-68_TfakeusST1.gff">' : RELEASED_GFF);
  };
  const destDir = tmp();
  const got = await fetchReleasedGff({ project: 'FungiDB', nameForFiles: 'TfakeusST1', destDir, fetchImpl });
  assert.equal(got.url, 'https://fungidb.org/common/downloads/Current_Release/TfakeusST1/gff/data/FungiDB-68_TfakeusST1.gff');
  assert.equal(got.pinnedUrl, 'https://fungidb.org/common/downloads/release-68/TfakeusST1/gff/data/FungiDB-68_TfakeusST1.gff');
  assert.equal(got.release, '68');
  assert.equal(got.path, join(destDir, 'FungiDB-68_TfakeusST1.gff'));
  assert.equal(readFileSync(got.path, 'utf-8'), RELEASED_GFF);
  assert.equal(got.sha256, createHash('sha256').update(RELEASED_GFF).digest('hex'));
  assert.deepEqual(readdirSync(destDir), ['FungiDB-68_TfakeusST1.gff']);
  assert.deepEqual(seen.map(([, signal]) => signal), [true, true]);
});

test('fetchReleasedGff names the URL on an HTTP status or a network failure', async () => {
  const destDir = tmp();
  await assert.rejects(fetchReleasedGff({ project: 'FungiDB', nameForFiles: 'X', destDir, fetchImpl: async () => ({ ok: false, status: 404 }) }),
    /Current_Release\/X\/gff\/data\/: HTTP 404/);
  const refused = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
  await assert.rejects(fetchReleasedGff({ project: 'FungiDB', nameForFiles: 'X', destDir, fetchImpl: async () => { throw refused; } }),
    /Current_Release\/X\/gff\/data\/: ECONNREFUSED/);
  const noRelease = async (url) => new Response(url.endsWith('/') ? '<a href="genes.gff">' : 'x');
  await assert.rejects(fetchReleasedGff({ project: 'FungiDB', nameForFiles: 'X', destDir, fetchImpl: noRelease }), /genes\.gff: no release number/);
});

test('fetchReleasedGff leaves no partial file when the download fails', async () => {
  const destDir = tmp();
  const broken = new ReadableStream({ pull() { throw new Error('connection reset'); } });
  const fetchImpl = async (url) => (url.endsWith('/') ? new Response('<a href="FungiDB-68_X.gff">') : new Response(broken));
  await assert.rejects(fetchReleasedGff({ project: 'FungiDB', nameForFiles: 'X', destDir, fetchImpl }), /FungiDB-68_X\.gff: connection reset/);
  assert.deepEqual(readdirSync(destDir), []);
});

test('idIndex maps genes, transcripts and proteins; protein IDs use protein_source_id, else <transcript>-p1', () => {
  const index = idIndex(RELEASED_GFF);
  assert.equal(levelOfId(index, 'TFAK_0010'), 'gene');
  assert.equal(levelOfId(index, 'TFAK_0010.2'), 'transcript');
  assert.equal(levelOfId(index, 'TFAK_0010.1-p1'), 'protein');
  assert.equal(levelOfId(index, 'TFAK_0010.2-p1'), 'protein');
  assert.equal(levelOfId(index, 'nope'), null);
  assert.deepEqual(mapId(index, 'TFAK_0010', 'gene', 'transcript'), ['TFAK_0010.1', 'TFAK_0010.2']);
  assert.deepEqual(mapId(index, 'TFAK_0010', 'gene', 'protein'), ['TFAK_0010.1-p1', 'TFAK_0010.2-p1']);
  assert.deepEqual(mapId(index, 'TFAK_0010.1-p1', 'protein', 'gene'), ['TFAK_0010']);
  assert.deepEqual(mapId(index, 'TFAK_0020', 'gene', 'protein'), []);
});

test('mapId returns [] for an ID that is not at the stated level', () => {
  const index = idIndex(RELEASED_GFF);
  assert.deepEqual(mapId(index, 'nope', 'transcript', 'gene'), []);
  assert.deepEqual(mapId(index, 'nope', 'transcript', 'protein'), []);
  assert.deepEqual(mapId(index, 'TFAK_0010', 'transcript', 'transcript'), ['TFAK_0010']);
  assert.deepEqual(mapId(index, 'nope', 'gene', 'transcript'), []);
  assert.deepEqual(mapId(index, 'nope', 'protein', 'gene'), []);
});

test('idIndex stops at ##FASTA, including when it is the first line', () => {
  const index = idIndex(`${RELEASED_GFF}##FASTA\n>chr1\nACGT\n`);
  assert.equal(levelOfId(index, 'TFAK_0020.1'), 'transcript');
  assert.equal(idIndex('##FASTA\n>chr1\nACGT\n').genes.size, 0);
});

test('a pseudogene has a transcript and no protein', () => {
  const index = idIndex([row('pseudogene', 'ID=TFAK_0030'), row('pseudogenic_transcript', 'ID=TFAK_0030.1;Parent=TFAK_0030'), row('exon', 'ID=e1;Parent=TFAK_0030.1'), ''].join('\n'));
  assert.deepEqual(mapId(index, 'TFAK_0030', 'gene', 'transcript'), ['TFAK_0030.1']);
  assert.deepEqual(mapId(index, 'TFAK_0030', 'gene', 'protein'), []);
});

test('an ID at two levels is ambiguous', () => {
  const text = [
    row('gene', 'ID=A'), row('mRNA', 'ID=A.1;Parent=A'), row('CDS', 'ID=c1;Parent=A.1;protein_source_id=B'),
    row('gene', 'ID=B'), row('mRNA', 'ID=B.1;Parent=B'),
    row('gene', 'ID=C'), row('mRNA', 'ID=C.1;Parent=C'), row('CDS', 'ID=c2;Parent=C.1;protein_source_id=C.1'), ''
  ].join('\n');
  const index = idIndex(text);
  assert.equal(AMBIGUOUS, 'ambiguous');
  assert.equal(levelOfId(index, 'B'), AMBIGUOUS);
  assert.equal(levelOfId(index, 'C.1'), AMBIGUOUS);
  assert.equal(levelOfId(index, 'A'), 'gene');
  assert.equal(levelOfId(index, 'A.1'), 'transcript');
});

test('idIndexOfFile reads a file line by line and matches idIndex on its text', () => {
  const path = join(tmp(), 'released.gff');
  writeFileSync(path, RELEASED_GFF);
  const fromFile = idIndexOfFile(path);
  const fromText = idIndex(RELEASED_GFF);
  assert.deepEqual([...fromFile.proteinOf], [...fromText.proteinOf]);
  assert.deepEqual([...fromFile.genes], [...fromText.genes]);
  assert.equal(existsSync(path), true);
});

test('idIndexOfFile copes with lines and a multi-byte character split across chunks, and no final newline', () => {
  const text = [row('gene', 'ID=Gé'), row('mRNA', 'ID=Gé.1;Parent=Gé'), row('CDS', 'ID=c;Parent=Gé.1')].join('\n');
  const path = join(tmp(), 'split.gff');
  writeFileSync(path, text);
  const fromFile = idIndexOfFile(path, 7);
  assert.equal(levelOfId(fromFile, 'Gé'), 'gene');
  assert.deepEqual(mapId(fromFile, 'Gé', 'gene', 'protein'), ['Gé.1-p1']);
  assert.deepEqual([...fromFile.proteinOf], [...idIndex(text).proteinOf]);
});

test('idIndex strips CR from CRLF lines', () => {
  const index = idIndex(RELEASED_GFF.replaceAll('\n', '\r\n'));
  assert.equal(levelOfId(index, 'TFAK_0010'), 'gene');
  assert.deepEqual(mapId(index, 'TFAK_0010', 'gene', 'protein'), ['TFAK_0010.1-p1', 'TFAK_0010.2-p1']);
});

test('a gene, RNA or CDS line without 9 columns throws with its line number; other lines are ignored', () => {
  const short = ['chr1', 'x', 'mRNA', '1', '9'].join('\t');
  assert.throws(() => idIndex(['##gff-version 3', row('gene', 'ID=G'), short].join('\n')), /GFF line 3 has 5 tab-separated columns, not 9/);
  assert.doesNotThrow(() => idIndex(['chr1', 'x', 'region'].join('\t')));
});

test('gene children of a type ISF does not classify are counted in skippedTypes', () => {
  const index = idIndex([row('gene', 'ID=G'), row('mRNA', 'ID=G.1;Parent=G'), row('exon', 'ID=e1;Parent=G.1'),
    row('exon', 'ID=e2;Parent=G'), row('exon', 'ID=e3;Parent=G'), row('repeat_region', 'ID=r;Parent=G'), ''].join('\n'));
  assert.deepEqual([...index.skippedTypes], [['exon', 2], ['repeat_region', 1]]);
});
