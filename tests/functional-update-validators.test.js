import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdtempSync, appendFileSync, cpSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { validatorsFor } from '../shared/scripts/dataset-types/validators.js';
import { loadManifest } from '../shared/scripts/dataset-types/_common.js';
import { workFiles, readConverted } from '../shared/scripts/dataset-types/functional-update/record.js';
import { CONVERTERS } from '../shared/scripts/dataset-types/functional-update/converters.js';
import { parseDatasetClass } from '../shared/scripts/lib/dataset-classes.js';
import { preprocessedFiles } from '../shared/scripts/dataset-types/functional-update.js';
import { fixtures } from './helpers.js';
import { convertedWorkArea, INPUT, sha } from './functional-update-helpers.js';

const FU = join(fixtures, 'proposals/tfakST1_productNames_20261111');

/** A copy of the fixture proposal with staging set, as convertedWorkArea's fetch staged it, or as given. */
function proposalStaging(staged = { path: 'products.tsv', sha256: sha(INPUT) }) {
  const dir = join(mkdtempSync(join(tmpdir(), 'fu-v-')), 'tfakST1_productNames_20261111');
  cpSync(FU, dir, { recursive: true });
  const path = join(dir, 'manifest.json');
  writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf-8')), staging: [staged] }, null, 2));
  return dir;
}
const FUC = proposalStaging();
const byName = Object.fromEntries(validatorsFor('functional-update').map((v) => [v.name, v]));

test('functional-update registers converted (preprocess) and updateRecord (content)', () => {
  assert.deepEqual(validatorsFor('functional-update').map((v) => [v.name, v.kind]), [['converted', 'preprocess'], ['updateRecord', 'content']]);
});

test('updateRecord passes the fixture', async () => {
  assert.deepEqual(await byName.updateRecord.run({ proposalDir: FU, manifest: loadManifest(FU) }), []);
});

test('converted reports an unconverted work area as an error', async () => {
  const workArea = mkdtempSync(join(tmpdir(), 'fu-v-'));
  const findings = await byName.converted.run({ proposalDir: FUC, manifest: loadManifest(FUC), workArea, extras: {} });
  assert.deepEqual(findings.map((f) => [f.severity, f.message]), [['error', 'no convert.json in the work area; run functional-update.js fetch, columns and convert']]);
});

test('converted passes a current conversion, records its digest, and fails a pending genome', async () => {
  const extras = {};
  const workArea = await convertedWorkArea();
  assert.deepEqual(await byName.converted.run({ proposalDir: FUC, manifest: loadManifest(FUC), workArea, extras }), []);
  assert.match(extras.preprocess.convert, /^[0-9a-f]{64}$/);
  const pending = await convertedWorkArea({ pendingGenomes: ['GCA_9.1'] });
  const findings = await byName.converted.run({ proposalDir: FUC, manifest: loadManifest(FUC), workArea: pending, extras: {} });
  assert.deepEqual(findings.map((f) => f.severity), ['error']);
  assert.match(findings[0].message, /genome proposal GCA_9\.1 on master names tfakST1/);
});

const gitWith = (accessions, abbrev) => ({
  listDir: () => accessions,
  showFile: () => JSON.stringify({ project: 'FungiDB', organisms: [{ source: 'new', proposedOrganismAbbrev: abbrev }] })
});

test('converted asks git for pending genomes when it has it, ignoring the recorded snapshot', async () => {
  const run = (workArea, git) => byName.converted.run({ proposalDir: FUC, manifest: loadManifest(FUC), workArea, extras: {}, git });
  const stale = await convertedWorkArea({ pendingGenomes: ['GCA_9.1'] });
  assert.deepEqual(await run(stale, gitWith([], 'tfakST1')), []);
  assert.deepEqual(await run(stale, gitWith(['GCA_9.1'], 'tfakOTHER')), []);
  const live = await run(await convertedWorkArea(), gitWith(['GCA_7.1'], 'tfakST1'));
  assert.deepEqual(live.map((f) => f.severity), ['error']);
  assert.match(live[0].message, /genome proposal GCA_7\.1 on master names tfakST1/);
});

test('converted passes info findings through as info', async () => {
  const workArea = await convertedWorkArea();
  const path = workFiles(workArea).convert;
  const record = JSON.parse(readFileSync(path, 'utf-8'));
  record.findings.push({ check: 'skippedTypes', severity: 'info', count: 2, message: 'gene children skipped', sample: ['x: 2'] });
  writeFileSync(path, JSON.stringify(record));
  const findings = await byName.converted.run({ proposalDir: FUC, manifest: loadManifest(FUC), workArea, extras: {} });
  assert.deepEqual(findings.filter((f) => f.severity === 'info').map((f) => f.message), ['skippedTypes (2): gene children skipped [x: 2]']);
});

test('converted calls an incomplete or unparsable convert.json incomplete, not a crash', async () => {
  const workArea = await convertedWorkArea();
  const path = workFiles(workArea).convert;
  const run = () => byName.converted.run({ proposalDir: FUC, manifest: loadManifest(FUC), workArea, extras: {} });
  const { entry, schemaVersion } = JSON.parse(readFileSync(path, 'utf-8'));
  writeFileSync(path, JSON.stringify({ schemaVersion, entry }));
  assert.deepEqual((await run()).map((f) => f.message), ['convert.json is incomplete; run functional-update.js convert again']);
  writeFileSync(path, '{not json');
  assert.deepEqual((await run()).map((f) => f.message), ['convert.json is incomplete; run functional-update.js convert again']);
});

test('updateRecord reports a proposal whose history text was removed', async () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'fu-v-')), 'tfakST1_productNames_20261111');
  cpSync(FU, dir, { recursive: true });
  const path = join(dir, 'curated/update.json');
  const update = JSON.parse(readFileSync(path, 'utf-8'));
  update.history.text = '';
  writeFileSync(path, JSON.stringify(update));
  const findings = await byName.updateRecord.run({ proposalDir: dir, manifest: loadManifest(dir) });
  assert.deepEqual(findings.map((f) => [f.severity, f.message]), [['error', 'curated/update.json history.text is required']]);
});

test('converted fails when the work area changed after convert', async () => {
  const workArea = await convertedWorkArea();
  appendFileSync(workFiles(workArea).columns, ' ');
  const findings = await byName.converted.run({ proposalDir: FUC, manifest: loadManifest(FUC), workArea, extras: {} });
  assert.deepEqual(findings.map((f) => f.severity), ['error']);
  assert.match(findings[0].message, /columns\.json changed since convert/);
});

const location = { label: 'productNames VEuPathDB', file: 'products.txt', relative: 'FungiDB/tfakST1/function/VEuPathDB_product_names/2026-11-03/final' };

test('preprocessedFiles delivers final/<file> once the report validated this conversion', async () => {
  const workArea = await convertedWorkArea();
  const { sha256 } = readConverted(workArea);
  const out = preprocessedFiles(FUC, location, { workArea, report: { preprocess: { convert: sha256 } } });
  assert.deepEqual(out.problems, []);
  assert.deepEqual(out.files, [{ path: 'products.txt', from: join(workArea, 'final', 'products.txt') }]);
  assert.equal(out.provenance.convert, sha256);
  assert.deepEqual(preprocessedFiles(FUC, location, { workArea, report: null }).problems, ['the verification report records no conversion; validate again']);
  assert.deepEqual(preprocessedFiles(FUC, location, { workArea, report: { preprocess: { convert: 'f'.repeat(64) } } }).problems, ['the work area changed since validation; validate again']);
  assert.deepEqual(preprocessedFiles(FUC, { ...location, file: 'other.txt' }, { workArea, report: { preprocess: { convert: sha256 } } }).problems, ['convert.json gives products.txt, but the class loads other.txt']);
});

test('converted and preprocessedFiles refuse a conversion of a file the proposal no longer stages', async () => {
  const workArea = await convertedWorkArea();
  const { sha256 } = readConverted(workArea);
  const dir = proposalStaging({ path: 'products.tsv', sha256: 'e'.repeat(64) });
  const again = "the proposal's staged file changed since fetch; run functional-update.js fetch, columns and convert again";
  const findings = await byName.converted.run({ proposalDir: dir, manifest: loadManifest(dir), workArea, extras: {} });
  assert.deepEqual(findings.map((f) => [f.severity, f.message]), [['error', again]]);
  const out = preprocessedFiles(dir, location, { workArea, report: { preprocess: { convert: sha256 } } });
  assert.deepEqual(out.problems, [again]);
  assert.deepEqual(out.files, []);
});

test('each converter writes the file its class delivers from classes.xml', () => {
  const xml = readFileSync(join(fixtures, 'classes.xml'), 'utf-8');
  assert.equal(Object.keys(CONVERTERS).length, 6);
  for (const [datasetClass, { file }] of Object.entries(CONVERTERS)) {
    assert.equal(parseDatasetClass(xml, datasetClass).delivery.file, file, datasetClass);
  }
});

test('preprocessedFiles refuses a stale or missing conversion and reads it once per delivery', async () => {
  const workArea = await convertedWorkArea();
  const { sha256 } = readConverted(workArea);
  const report = { preprocess: { convert: sha256 } };
  const cache = {};
  preprocessedFiles(FUC, location, { workArea, report, cache });
  appendFileSync(workFiles(workArea).columns, ' ');
  assert.deepEqual(preprocessedFiles(FUC, location, { workArea, report, cache }).problems, []);
  const stale = preprocessedFiles(FUC, location, { workArea, report });
  assert.equal(stale.files.length, 0);
  assert.match(stale.problems[0], /columns\.json changed since convert/);
  const empty = preprocessedFiles(FUC, location, { workArea: mkdtempSync(join(tmpdir(), 'fu-empty-')), report });
  assert.match(empty.problems[0], /no convert\.json/);
  assert.equal(empty.provenance, null);
});
