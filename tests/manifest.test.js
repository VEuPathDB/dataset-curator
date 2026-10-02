import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validate, read, write, organismsOf, parseExternalIds, idsOf } from '../shared/scripts/lib/manifest.js';

function valid() {
  return {
    schemaVersion: 2,
    accession: 'PRJNA123456',
    datasetType: 'bulk-rnaseq',
    project: 'FungiDB',
    referenceOrganismAbbrev: 'afumAf293',
    additionalOrganismAbbrevs: [],
    contacts: { primary: 'jane.doe', additional: ['ravi.kumar'] },
    curator: 'someone@apidb.org',
    createdAt: '2026-09-18T14:00:00.000Z',
    skill: { name: 'propose-bulk-rnaseq', version: '2.0.0' }
  };
}

test('a complete manifest has no errors', () => {
  assert.deepEqual(validate(valid()), []);
});

test('validate rejects a non-object manifest', () => {
  assert.deepEqual(validate(null), ['manifest must be a JSON object']);
  assert.deepEqual(validate(undefined), ['manifest must be a JSON object']);
  assert.deepEqual(validate([]), ['manifest must be a JSON object']);
  assert.deepEqual(validate('nope'), ['manifest must be a JSON object']);
});

test('contacts.additional must be an array of non-empty strings', () => {
  assert.ok(validate({ ...valid(), contacts: { primary: 'jane.doe', additional: 'nope' } })
    .some(e => /contacts\.additional must be an array of non-empty contact ids/.test(e)));
  assert.ok(validate({ ...valid(), contacts: { primary: 'jane.doe', additional: ['', 'ravi.kumar'] } })
    .some(e => /contacts\.additional must be an array of non-empty contact ids/.test(e)));
  assert.ok(validate({ ...valid(), contacts: { primary: 'jane.doe', additional: [123] } })
    .some(e => /contacts\.additional must be an array of non-empty contact ids/.test(e)));
  assert.deepEqual(validate({ ...valid(), contacts: { primary: 'jane.doe', additional: [] } }), []);
});

test('createdAt must be a strict ISO 8601 UTC timestamp', () => {
  const msg = /createdAt must be an ISO 8601 UTC timestamp/;
  assert.ok(validate({ ...valid(), createdAt: '2026-09-18' }).some(e => msg.test(e)));
  assert.ok(validate({ ...valid(), createdAt: 'not-a-date' }).some(e => msg.test(e)));
  assert.ok(validate({ ...valid(), createdAt: '2026-13-99T99:99:99Z' }).some(e => msg.test(e)));
  assert.deepEqual(validate({ ...valid(), createdAt: '2026-09-18T14:00:00Z' }), []);
});

test('ticket is optional but must be well formed when present', () => {
  const m = { ...valid(), ticket: { system: 'github', id: '42', url: 'https://r/issues/42' } };
  assert.deepEqual(validate(m), []);
  const bad = { ...valid(), ticket: { system: 'jira', id: '42' } };
  const errors = validate(bad);
  assert.ok(errors.some(e => /ticket\.system/.test(e)));
  assert.ok(errors.some(e => /ticket\.url/.test(e)));
});

test('unknown schemaVersion is rejected', () => {
  assert.ok(validate({ ...valid(), schemaVersion: 99 }).some(e => /schemaVersion/.test(e)));
});

test('datasetType must have a module', () => {
  assert.ok(validate({ ...valid(), datasetType: 'proteomics' }).some(e => /datasetType "proteomics" has no module in dataset-types\//.test(e)));
});

test('project must be a valid VEuPathDB project', () => {
  assert.ok(validate({ ...valid(), project: 'fungidb' }).some(e => /project/.test(e)));
});

test('accession must match the directory name when given', () => {
  assert.ok(validate(valid(), { dirName: 'PRJNA000000' }).some(e => /directory/.test(e)));
});

test('accession format is restricted to letters, digits, underscore and dot', () => {
  const msg = /accession may contain only letters, digits, underscore and dot/;
  assert.ok(validate({ ...valid(), accession: 'PRJNA"123' }).some(e => msg.test(e)));
  assert.ok(validate({ ...valid(), accession: 'PRJNA&123' }).some(e => msg.test(e)));
  assert.deepEqual(validate({ ...valid(), accession: 'GCA_000001.1' }), []);
  assert.deepEqual(validate({ ...valid(), accession: 'PRJNA000002_no_overrides' }), []);
});

test('referenceOrganismAbbrev format is restricted to letters and digits', () => {
  const msg = /referenceOrganismAbbrev may contain only letters and digits/;
  assert.ok(validate({ ...valid(), referenceOrganismAbbrev: 'tfak"ST1' }).some(e => msg.test(e)));
  assert.ok(validate({ ...valid(), referenceOrganismAbbrev: 'tfak&ST1' }).some(e => msg.test(e)));
  assert.deepEqual(validate({ ...valid(), referenceOrganismAbbrev: 'tfakST1' }), []);
});

test('schemaVersion 1 is no longer read', () => {
  assert.match(validate({ ...valid(), schemaVersion: 1 }).join('\n'), /schemaVersion must be one of 2/);
});

test('targetBuild is refused: the build is the ticket milestone', () => {
  assert.match(validate({ ...valid(), targetBuild: '02' }).join('\n'), /targetBuild is no longer recorded; the build is the ticket milestone/);
});

test('each dataset type names its own organism fields', () => {
  const genome = { ...valid(), datasetType: 'genome-assembly', organismAbbrev: 'afumAf293' };
  delete genome.referenceOrganismAbbrev; delete genome.additionalOrganismAbbrevs;
  assert.deepEqual(validate(genome), []);
  assert.match(validate({ ...valid(), organismAbbrev: 'afumAf293' }).join('\n'), /organismAbbrev is not a bulk-rnaseq field/);
  assert.match(validate({ ...genome, additionalOrganismAbbrevs: [] }).join('\n'), /additionalOrganismAbbrevs is not a genome-assembly field/);
});

test('additional organisms are distinct abbreviations that never repeat the reference', () => {
  const errs = (extra) => validate({ ...valid(), additionalOrganismAbbrevs: extra }).join('\n');
  assert.equal(errs(['afumA1163', 'afisNRRL181']), '');
  assert.match(errs('afumA1163'), /additionalOrganismAbbrevs must be an array of organism abbreviations/);
  assert.match(errs(['bad-one']), /additionalOrganismAbbrevs must be an array of organism abbreviations/);
  assert.match(errs(['afumA1163', 'afumA1163']), /lists an organism twice/);
  assert.match(errs(['afumAf293']), /must not repeat referenceOrganismAbbrev "afumAf293"/);
});

test('organismsOf lists the primary organism first', () => {
  assert.deepEqual(organismsOf({ ...valid(), additionalOrganismAbbrevs: ['afumA1163'] }), ['afumAf293', 'afumA1163']);
  assert.deepEqual(organismsOf({ datasetType: 'genome-assembly', organismAbbrev: 'tfakST1' }), ['tfakST1']);
});

test('organismsOf refuses an unknown dataset type', () => {
  assert.throws(() => organismsOf({ datasetType: 'proteomics' }), /datasetType "proteomics" has no module in dataset-types\//);
});

test('contacts are checked against known ids when given', () => {
  const errors = validate(valid(), { contactIds: ['jane.doe'] });
  assert.ok(errors.some(e => /ravi\.kumar/.test(e)));
});

test('write validates, then read round-trips', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'manifest-')), 'PRJNA123456');
  mkdirSync(dir);
  write(dir, valid());
  const onDisk = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf-8'));
  assert.equal(onDisk.accession, 'PRJNA123456');
  assert.deepEqual(read(dir), valid());
});

test('write refuses an invalid manifest', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'manifest-')), 'PRJNA123456');
  mkdirSync(dir);
  assert.throws(() => write(dir, { ...valid(), project: 'Nope' }), /Invalid manifest/);
});

test('write creates the proposal directory if it does not exist', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'manifest-')), 'nested', 'PRJNA123456');
  write(dir, valid());
  assert.deepEqual(read(dir), valid());
});

test('read fails clearly when manifest.json is malformed', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'manifest-')), 'PRJNA123456');
  mkdirSync(dir);
  const path = join(dir, 'manifest.json');
  writeFileSync(path, '{ not valid json');
  assert.throws(() => read(dir), new RegExp(`^Error: ${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} is not valid JSON:`));
});

test('read refuses when directory name and accession disagree', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'manifest-')), 'PRJNA999999');
  mkdirSync(dir);
  write(dir, { ...valid(), accession: 'PRJNA999999' });
  assert.deepEqual(read(dir).accession, 'PRJNA999999');
  const wrong = join(mkdtempSync(join(tmpdir(), 'manifest-')), 'PRJNA000001');
  mkdirSync(wrong);
  // bypass write() validation to plant a mismatched file
  writeFileSync(join(wrong, 'manifest.json'), JSON.stringify(valid()));
  assert.throws(() => read(wrong), /directory/);
});

const identity = { datasetClass: 'rnaSeqExperiment', name: 'Doe_heat_shock_2024', version: '2024-05-01' };

test('identity fields validate together and in form', () => {
  assert.deepEqual(validate({ ...valid(), ...identity }), []);
  assert.deepEqual(validate({ ...valid(), name: 'Doe_2024' }), ['datasetClass, name, version must be given together']);
  assert.deepEqual(validate({ ...valid(), ...identity, name: 'Doe heat shock' }),
    ['name may contain only letters, digits and underscores, and must start with a letter']);
  assert.deepEqual(validate({ ...valid(), ...identity, name: 'Doe_PRJNA123456' }),
    ['name "Doe_PRJNA123456" must be readable, not built from the accession']);
  assert.deepEqual(validate({ ...valid(), ...identity, version: '2024-13-45' }), ['version must be a date, YYYY-MM-DD']);
  assert.deepEqual(validate({ ...valid(), ...identity, version: '24 July 2021' }), ['version must be a date, YYYY-MM-DD']);
});

test('externalIds is optional; known kinds must look like their accessions', () => {
  assert.deepEqual(validate({ ...valid(), externalIds: { bioproject: 'PRJNA123456', geo: 'GSE1' } }), []);
  assert.ok(validate({ ...valid(), externalIds: { geo: 'GSM1' } }).some(e => /externalIds\.geo "GSM1" is not a geo accession/.test(e)));
  assert.ok(validate({ ...valid(), externalIds: { arrayexpress: 'E-MTAB-1' } }).some(e => /externalIds\.arrayexpress is not a known kind/.test(e)));
  assert.ok(validate({ ...valid(), externalIds: ['GSE1'] }).some(e => /externalIds must be an object/.test(e)));
});

test('externalIds must agree with an accession of a known kind', () => {
  assert.ok(validate({ ...valid(), externalIds: { bioproject: 'PRJNA999' } }).some(e => /externalIds\.bioproject must be the accession "PRJNA123456"/.test(e)));
  assert.ok(validate({ ...valid(), externalIds: { geo: 'GSE1' } }).some(e => /externalIds\.bioproject must be the accession/.test(e)));
  assert.deepEqual(validate({ ...valid(), accession: 'GSE1', externalIds: { bioproject: 'PRJNA123456', geo: 'GSE1' } }), []);
});

test('parseExternalIds reads kind=id pairs and adds the accession as its own kind', () => {
  assert.deepEqual(parseExternalIds(['geo=GSE1'], 'PRJNA1'), { geo: 'GSE1', bioproject: 'PRJNA1' });
  assert.deepEqual(parseExternalIds([], 'DoeLab_2024'), {});
  assert.throws(() => parseExternalIds(['GSE1'], 'PRJNA1'), /kind=id/);
  assert.throws(() => parseExternalIds(['geo=GSE1', 'geo=GSE2'], 'PRJNA1'), /geo is given twice/);
});

test('idsOf lists the accession and every external id once', () => {
  assert.deepEqual(idsOf({ accession: 'GSE1', externalIds: { geo: 'GSE1', bioproject: 'PRJNA1' } }), ['GSE1', 'PRJNA1']);
  assert.deepEqual(idsOf({ accession: 'PRJNA1' }), ['PRJNA1']);
});
