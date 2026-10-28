import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fetchReleasedOrganisms, matchReleased, normalizeName, taxonSharers, GENOME_INFO_URL } from '../shared/scripts/lib/released-organisms.js';

const body = readFileSync(new URL('./fixtures/genome-data-types.json', import.meta.url), 'utf-8');
const okFetch = async (url, init) => ({ ok: true, status: 200, text: async () => body, url, init });

test('fetchReleasedOrganisms posts the GenomeDataTypes report and parses the records', async () => {
  let seen;
  const records = await fetchReleasedOrganisms(async (url, init) => { seen = { url, init }; return okFetch(url, init); });
  assert.equal(seen.url, GENOME_INFO_URL);
  assert.equal(seen.init.method, 'POST');
  assert.deepEqual(JSON.parse(seen.init.body).reportConfig.attributes, ['organism_name', 'strain', 'project_id', 'chromosomeCount']);
  assert.deepEqual(records[0], { sourceId: 'NCBITAXON_332648', organismName: 'Botrytis cinerea B05.10', strain: 'B05.10', project: 'FungiDB', chromosomeCount: 18 });
});

test('fetchReleasedOrganisms refuses a failed query with no fallback', async () => {
  await assert.rejects(fetchReleasedOrganisms(async () => ({ ok: false, status: 503, text: async () => 'down' })), /veupathdb\.org.*HTTP 503/);
  await assert.rejects(fetchReleasedOrganisms(async () => ({ ok: true, status: 200, text: async () => '<html>' })), /not JSON/);
  await assert.rejects(fetchReleasedOrganisms(async () => { throw new Error('ENOTFOUND'); }), /ENOTFOUND/);
});

test('fetchReleasedOrganisms asks for up to 10000 records', async () => {
  let seen;
  await fetchReleasedOrganisms(async (url, init) => { seen = JSON.parse(init.body); return okFetch(url, init); });
  assert.equal(seen.reportConfig.pagination.numRecords, 10000);
});

const fetchOf = (parsed) => async () => ({ ok: true, status: 200, text: async () => JSON.stringify(parsed) });

test('fetchReleasedOrganisms refuses a report without chromosomeCount, or one the site truncated', async () => {
  const records = JSON.parse(body).records;
  const noCount = records.map((r) => { const { chromosomeCount, ...a } = r.attributes; return { ...r, attributes: a }; });
  await assert.rejects(fetchReleasedOrganisms(fetchOf({ records: noCount })), /no chromosomeCount attribute/);
  await assert.rejects(fetchReleasedOrganisms(fetchOf({ records, meta: { totalCount: 5000 } })), /3 of 5000 records.*truncated/);
  assert.equal((await fetchReleasedOrganisms(fetchOf({ records, meta: { totalCount: 3 } }))).length, 3);
});

test('normalizeName drops brackets, collapses whitespace and lowercases', () => {
  assert.equal(normalizeName('  [Candida]   auris  B8441 '), 'candida auris b8441');
});

test('matchReleased candidates compare names normalized, and fall back to the genus', () => {
  const records = [
    { sourceId: 'A', organismName: '[Candida] auris B8441', project: 'FungiDB' },
    { sourceId: 'B', organismName: 'Candida albicans SC5314', project: 'FungiDB' },
    { sourceId: 'C', organismName: 'Botrytis cinerea B05.10', project: 'FungiDB' }
  ];
  assert.deepEqual(matchReleased(records, { project: 'FungiDB', species: 'Candida  Auris' }).candidates.map((r) => r.sourceId), ['A']);
  assert.deepEqual(matchReleased(records, { project: 'FungiDB', species: 'Candida tropicalis' }).candidates.map((r) => r.sourceId), ['A', 'B']);
  assert.deepEqual(matchReleased(records, { project: 'FungiDB', species: 'Fusarium sp.' }).candidates, []);
});

test('taxonSharers names the organism files in the project with the taxon id', () => {
  const index = [
    { abbrev: 'tfakA', project: 'FungiDB', ncbiTaxonId: '1' },
    { abbrev: 'tfakB', project: 'FungiDB', ncbiTaxonId: '1' },
    { abbrev: 'tfakC', project: 'ToxoDB', ncbiTaxonId: '1' },
    { abbrev: 'tfakD', project: 'FungiDB', ncbiTaxonId: '2' }
  ];
  assert.deepEqual(taxonSharers(index, { project: 'FungiDB', ncbiTaxonId: '1' }), ['tfakA', 'tfakB']);
  assert.deepEqual(taxonSharers(index, { project: 'FungiDB', ncbiTaxonId: undefined }), []);
});

test('matchReleased treats a taxon several organism files share as unmatched, with that record as the candidate', async () => {
  const records = await fetchReleasedOrganisms(okFetch);
  assert.deepEqual(matchReleased(records, { ncbiTaxonId: '332648', project: 'FungiDB', species: 'Botrytis cinerea', sharing: ['bcinB0510', 'bcinT4'] }), {
    matched: false, candidates: [records[0]], reason: '2 organism files share taxon 332648: bcinB0510, bcinT4; confirm which is released'
  });
  assert.equal(matchReleased(records, { ncbiTaxonId: '332648', project: 'FungiDB', sharing: ['bcinB0510'] }).matched, true);
  assert.equal(matchReleased(records, { ncbiTaxonId: '332648', project: 'FungiDB', sharing: ['bcinB0510', 'bcinT4'], pick: 'NCBITAXON_332648' }).matched, true);
});

test('check-released-organism exits 1 when the SRA metadata has not been fetched', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'check-released-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const script = new URL('../shared/scripts/check-released-organism.js', import.meta.url).pathname;
  const r = spawnSync(process.execPath, [script, 'PRJNA1', '--organism', 'tfakST1', '--project', 'FungiDB', '--rebuild-branch', 'rebuild02'], { cwd, encoding: 'utf-8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /PRJNA1_sra_metadata\.json.*run fetch-sra-metadata\.js PRJNA1 first/);
});

test('matchReleased matches on taxon id and project', async () => {
  const records = await fetchReleasedOrganisms(okFetch);
  assert.deepEqual(matchReleased(records, { ncbiTaxonId: '332648', project: 'FungiDB', species: 'Botrytis cinerea' }), {
    matched: true, record: records[0], by: 'taxon'
  });
});

test('matchReleased lists same-species candidates when nothing matches', async () => {
  const records = await fetchReleasedOrganisms(okFetch);
  const r = matchReleased(records, { ncbiTaxonId: '5', project: 'FungiDB', species: 'Botrytis cinerea' });
  assert.equal(r.matched, false);
  assert.deepEqual(r.candidates.map((c) => c.sourceId), ['NCBITAXON_332648', 'NCBITAXON_999001']);
});

test('matchReleased takes a curator pick and refuses an unknown or other-project pick', async () => {
  const records = await fetchReleasedOrganisms(okFetch);
  assert.deepEqual(matchReleased(records, { ncbiTaxonId: '5', project: 'FungiDB', species: 'Botrytis cinerea', pick: 'NCBITAXON_999001' }), {
    matched: true, record: records[1], by: 'curator'
  });
  assert.throws(() => matchReleased(records, { project: 'FungiDB', pick: 'NCBITAXON_1' }), /NCBITAXON_1 is not a released organism/);
  assert.throws(() => matchReleased(records, { project: 'FungiDB', pick: 'NCBITAXON_1003232' }), /MicrosporidiaDB organism, not FungiDB/);
});
