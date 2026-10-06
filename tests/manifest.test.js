import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validate, read, write, organismsOf, organismRuleOf, parseExternalIds, idsOf, projectOf, proposedAbbrevOf, homeProject, projectsOf } from '../shared/scripts/lib/manifest.js';
import { loadManifest } from '../shared/scripts/dataset-types/_common.js';

function valid() {
  return {
    schemaVersion: 4,
    accession: 'PRJNA123456',
    datasetType: 'bulk-rnaseq',
    organisms: [{ proposedOrganismAbbrev: 'afumAf293', source: 'loaded', project: 'FungiDB' }],
    contacts: { primary: 'jane.doe', additional: ['ravi.kumar'] },
    curator: 'someone@apidb.org',
    createdAt: '2026-09-18T14:00:00.000Z',
    skill: { name: 'propose-bulk-rnaseq', version: '2.0.0' }
  };
}

const genome = (organism = {}) => ({
  ...valid(), accession: 'GCA_000001.1', datasetType: 'genome-assembly',
  organisms: [{ proposedOrganismAbbrev: 'tfakST-1', source: 'new', project: 'FungiDB', species: 'Testus fakeus', strain: 'ST-1', ncbiTaxonId: '999001', ...organism }]
});

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

test('a root project is a schemaVersion 3 field', () => {
  assert.ok(validate({ ...valid(), project: 'FungiDB' }).includes('project is a schemaVersion 3 field; each organism names its project. Re-run write-proposal.js'));
});

test('each organism names a valid VEuPathDB project', () => {
  const m = valid();
  m.organisms[0].project = 'fungidb';
  assert.ok(validate(m).some(e => /organisms\[0\]\.project "fungidb" is not valid; expected one of AmoebaDB/.test(e)));
  delete m.organisms[0].project;
  assert.ok(validate(m).some(e => /organisms\[0\]\.project "undefined" is not valid/.test(e)));
});

test('unplacedOk skips the project check only for an organism with no project', () => {
  const m = valid();
  delete m.organisms[0].project;
  assert.deepEqual(validate(m, { unplacedOk: true }), []);
  m.organisms[0].project = 'fungidb';
  assert.ok(validate(m, { unplacedOk: true }).some(e => /project "fungidb" is not valid/.test(e)));
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

test('schemaVersion 1 is no longer read', () => {
  assert.match(validate({ ...valid(), schemaVersion: 1 }).join('\n'), /schemaVersion must be one of 4/);
});

test('targetBuild is refused: the build is the ticket milestone', () => {
  assert.match(validate({ ...valid(), targetBuild: '02' }).join('\n'), /targetBuild is no longer recorded; the build is the ticket milestone/);
});

test('schemaVersion 4 is the only version', () => {
  assert.ok(validate({ ...valid(), schemaVersion: 3 }).includes('schemaVersion must be one of 4'));
});

test('v2 organism fields are refused with the way forward', () => {
  for (const k of ['organismAbbrev', 'referenceOrganismAbbrev', 'additionalOrganismAbbrevs']) {
    assert.ok(validate({ ...valid(), [k]: 'x' }).includes(`${k} is a schemaVersion 2 field; re-run write-proposal.js`), k);
  }
});

test('organisms must be a non-empty array of objects', () => {
  assert.ok(validate({ ...valid(), organisms: [] }).includes('organisms must be a non-empty array'));
  assert.ok(validate({ ...valid(), organisms: 'tfakST1' }).includes('organisms must be a non-empty array'));
  assert.ok(validate({ ...valid(), organisms: ['tfakST1'] }).includes('organisms[0] must be an object'));
});

test('a proposed abbreviation must have the abbreviation shape', () => {
  for (const ok of ['bcinB05-10', 'acspSK_2022a', 'aellCBS707.79']) {
    assert.deepEqual(validate({ ...valid(), organisms: [{ proposedOrganismAbbrev: ok, source: 'loaded', project: 'FungiDB' }] }), [], ok);
  }
  assert.ok(validate({ ...valid(), organisms: [{ proposedOrganismAbbrev: 'a/b', source: 'loaded', project: 'FungiDB' }] })
    .includes('organisms[0].proposedOrganismAbbrev must be letters, digits, ".", "_" or "-", starting with a letter or digit'));
});

test('an organism of a type using loaded organisms is loaded or links a genome proposal', () => {
  const link = { proposedOrganismAbbrev: 'tfakST-1', source: { proposal: 'GCA_000001.1' }, project: 'FungiDB' };
  assert.deepEqual(validate({ ...valid(), organisms: [{ proposedOrganismAbbrev: 'tfakST1', source: 'loaded', project: 'FungiDB' }, link] }), []);
  assert.ok(validate({ ...valid(), organisms: [{ proposedOrganismAbbrev: 'tfakST1', source: 'new', project: 'FungiDB' }] })
    .includes('organisms[0].source must be "loaded" or { "proposal": "<genome accession>" }'));
  assert.ok(validate({ ...valid(), organisms: [{ proposedOrganismAbbrev: 'tfakST1', source: 'loaded', project: 'FungiDB', species: 'X y' }] })
    .includes('organisms[0].species belongs to genome proposals'));
});

test('a genome organism is new and names its species and strain; the taxon id is optional digits', () => {
  assert.deepEqual(validate(genome()), []);
  assert.deepEqual(validate(genome({ ncbiTaxonId: undefined })), []);
  assert.deepEqual(validate(genome({ strain: '' })), []);
  assert.ok(validate(genome({ source: 'loaded', project: 'FungiDB' })).includes('organisms[0].source must be "new" for genome-assembly'));
  assert.ok(validate(genome({ species: 'Testus' })).includes('organisms[0].species must name a genus and species'));
  assert.ok(validate(genome({ strain: undefined })).includes('organisms[0].strain must be a string, empty when the organism has none'));
  assert.ok(validate(genome({ ncbiTaxonId: 999001 })).includes('organisms[0].ncbiTaxonId must be a string of digits'));
});

test('a genome proposal has one organism; no proposal lists an organism twice', () => {
  const g = genome();
  assert.ok(validate({ ...g, organisms: [g.organisms[0], { ...g.organisms[0], proposedOrganismAbbrev: 'tfakST-2' }] })
    .includes('genome-assembly proposals have at most 1 organism'));
  const twice = { proposedOrganismAbbrev: 'tfakST1', source: 'loaded', project: 'FungiDB' };
  assert.ok(validate({ ...valid(), organisms: [twice, twice] }).includes('organisms lists tfakST1 twice'));
});

test('an organism entry refuses keys it does not know, and a linked source has only "proposal"', () => {
  assert.ok(validate({ ...valid(), organisms: [{ proposedOrganismAbbrev: 'tfakST1', source: 'loaded', project: 'FungiDB', taxon: '1' }] })
    .includes('organisms[0].taxon is not an organism field'));
  assert.ok(validate(genome({ organismName: 'Testus fakeus' })).includes('organisms[0].organismName is not an organism field'));
  assert.deepEqual(validate({ ...valid(), organisms: [{ proposedOrganismAbbrev: 'tfakST1', source: 'loaded', project: 'FungiDB', strain: 'x' }] }),
    ['organisms[0].strain belongs to genome proposals']);
  assert.deepEqual(validate({ ...valid(), organisms: [{ proposedOrganismAbbrev: 'tfakST-1', source: { proposal: 'GCA_000001.1', branch: 'x' }, project: 'FungiDB' }] }),
    ['organisms[0].source.branch is not a source field']);
});

test('a linked source names a proposal accession', () => {
  assert.ok(validate({ ...valid(), organisms: [{ proposedOrganismAbbrev: 'tfakST-1', source: { proposal: 'GCA/1' }, project: 'FungiDB' }] })
    .includes('organisms[0].source must be "loaded" or { "proposal": "<genome accession>" }'));
});

test('a settled abbreviation, when present, has the abbreviation shape', () => {
  const settled = { proposedOrganismAbbrev: 'tfakST1', source: 'loaded', project: 'FungiDB', organismAbbrev: 'tfakST1' };
  assert.deepEqual(validate({ ...valid(), organisms: [settled] }, { settled: true }), []);
  assert.ok(validate({ ...valid(), organisms: [{ ...settled, organismAbbrev: 'a b' }] }, { settled: true })
    .includes('organisms[0].organismAbbrev must be letters, digits, ".", "_" or "-", starting with a letter or digit'));
});

test('a settled abbreviation is refused on a manifest that Phase 2 has not settled', () => {
  const organisms = [{ proposedOrganismAbbrev: 'tfakST2', source: 'loaded', project: 'FungiDB' }, { proposedOrganismAbbrev: 'tfakST1', source: 'loaded', project: 'FungiDB', organismAbbrev: 'tfakST1' }];
  assert.deepEqual(validate({ ...valid(), organisms }), ['organisms[1].organismAbbrev is set only by Phase 2 settlement']);
  const dir = join(mkdtempSync(join(tmpdir(), 'settled-')), 'PRJNA123456');
  assert.throws(() => write(dir, { ...valid(), organisms }), /organisms\[1\]\.organismAbbrev is set only by Phase 2 settlement/);
  write(dir, { ...valid(), organisms }, { settled: true });
  assert.throws(() => read(dir), /set only by Phase 2 settlement/);
  assert.deepEqual(organismsOf(loadManifest(dir)), ['tfakST2', 'tfakST1']);
});

test('organismsOf lists settled abbreviations where present, proposed ones otherwise', () => {
  const m = { ...valid(), organisms: [{ proposedOrganismAbbrev: 'a1', source: 'loaded', project: 'FungiDB', organismAbbrev: 'b1' }, { proposedOrganismAbbrev: 'a2', source: 'loaded', project: 'FungiDB' }] };
  assert.deepEqual(organismsOf(m), ['b1', 'a2']);
});

test('projectOf, proposedAbbrevOf, homeProject and projectsOf read the organisms, settled names first', () => {
  const m = { ...valid(), organisms: [
    { proposedOrganismAbbrev: 'pfal3D7', source: 'loaded', project: 'PlasmoDB', organismAbbrev: 'pfal3D7' },
    { proposedOrganismAbbrev: 'hsapX', source: 'loaded', project: 'HostDB', organismAbbrev: 'hsapREF' },
    { proposedOrganismAbbrev: 'pberANKA', source: 'loaded', project: 'PlasmoDB' }
  ] };
  assert.equal(projectOf(m, 'hsapREF'), 'HostDB');
  assert.equal(proposedAbbrevOf(m, 'hsapREF'), 'hsapX');
  assert.equal(proposedAbbrevOf(m, 'pberANKA'), 'pberANKA');
  assert.equal(homeProject(m), 'PlasmoDB');
  assert.deepEqual(projectsOf(m), ['PlasmoDB', 'HostDB']);
  assert.throws(() => projectOf(m, 'nope'), /nope is not an organism of PRJNA123456/);
});

test('organismRuleOf refuses an unknown dataset type and reads each type\'s rule', () => {
  assert.throws(() => organismRuleOf('proteomics'), /datasetType "proteomics" has no module in dataset-types\//);
  assert.deepEqual(organismRuleOf('genome-assembly'), { new: true, max: 1 });
  assert.deepEqual(organismRuleOf('bulk-rnaseq'), { new: false });
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
  assert.throws(() => write(dir, { ...valid(), organisms: [{ ...valid().organisms[0], project: 'Nope' }] }), /Invalid manifest/);
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
