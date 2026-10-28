import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fetchReleasedOrganisms, matchReleased, GENOME_INFO_URL } from '../shared/scripts/lib/released-organisms.js';

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
