import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gffDirectoryUrl, pickGff, releaseOf, fetchReleasedGff } from '../shared/scripts/dataset-types/functional-update/gff-source.js';
import { idIndex, levelOfId, mapId } from '../shared/scripts/dataset-types/functional-update/gff-ids.js';
import { RELEASED_GFF } from './functional-update-helpers.js';

test('gffDirectoryUrl, pickGff and releaseOf find the one release GFF', () => {
  assert.equal(gffDirectoryUrl('FungiDB', 'TfakeusST1'), 'https://fungidb.org/common/downloads/Current_Release/TfakeusST1/gff/data/');
  assert.equal(pickGff('<a href="FungiDB-68_TfakeusST1.gff">x</a><a href="../">up</a>', 'u'), 'FungiDB-68_TfakeusST1.gff');
  assert.throws(() => pickGff('<a href="a.gff"></a><a href="b.gff"></a>', 'u'), /u lists 2 \.gff files \(a\.gff, b\.gff\); expected one/);
  assert.equal(releaseOf('FungiDB-68_TfakeusST1.gff'), '68');
});

test('fetchReleasedGff lists the directory, then downloads the file', async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    return { ok: true, status: 200, text: async () => (url.endsWith('/') ? '<a href="FungiDB-68_TfakeusST1.gff">' : RELEASED_GFF) };
  };
  const got = await fetchReleasedGff({ project: 'FungiDB', nameForFiles: 'TfakeusST1', fetchImpl });
  assert.equal(got.url, 'https://fungidb.org/common/downloads/Current_Release/TfakeusST1/gff/data/FungiDB-68_TfakeusST1.gff');
  assert.equal(got.release, '68');
  assert.equal(got.text, RELEASED_GFF);
  assert.equal(seen.length, 2);
  await assert.rejects(fetchReleasedGff({ project: 'FungiDB', nameForFiles: 'X', fetchImpl: async () => ({ ok: false, status: 404 }) }), /HTTP 404/);
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

test('idIndex ignores an embedded FASTA section', () => {
  const index = idIndex(`${RELEASED_GFF}##FASTA\n>chr1\nACGT\n`);
  assert.equal(levelOfId(index, 'TFAK_0020.1'), 'transcript');
});
