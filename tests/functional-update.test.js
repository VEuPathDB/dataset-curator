import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync, cpSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { historyDate } from '../shared/scripts/dataset-types/functional-update/update.js';
import * as fu from '../shared/scripts/dataset-types/functional-update.js';
import { DATASET_TYPES } from '../shared/scripts/dataset-types/index.js';
import { ORGANISM_RULES } from '../shared/scripts/dataset-types/organism-rules.js';
import { assertValidEntries, loadManifest } from '../shared/scripts/dataset-types/_common.js';
import { parseDatasetClass } from '../shared/scripts/lib/dataset-classes.js';
import { fixtures } from './helpers.js';

export const FU = join(fixtures, 'proposals/tfakST1_productNames_20261111');
export const fixtureClassOf = (className) => parseDatasetClass(readFileSync(join(fixtures, 'classes.xml'), 'utf-8'), className);

test('functional-update is registered, single-entry, amends presenters and needs a released organism', () => {
  assert.equal(DATASET_TYPES['functional-update'], fu);
  assert.deepEqual(ORGANISM_RULES['functional-update'], { new: false, max: 1, pending: 'refuse' });
  assert.equal(fu.singleEntry, true);
  assert.equal(fu.amendsPresenters, true);
  assert.deepEqual(fu.datasetClasses, ['productNames', 'GeneOntologyAssociations', 'EnzymeCommissionAssociations', 'geneName', 'comments', 'aliases']);
  assert.equal(fu.validationWorkspace, 'functional-update-validation');
});

test('presenterNames names the organism\'s genome presenter', () => {
  assert.deepEqual(fu.presenterNames(FU), ['tfakST1_primary_genome_RSRC']);
});

test('the fixture\'s entry is valid against the fixture classes', () => {
  const entries = assertValidEntries(FU, loadManifest(FU), fu, { classOf: fixtureClassOf });
  assert.equal(entries[0].name, 'VEuPathDB');
});

/** A scratch copy of the fixture with curated/ cleared, and the entries input replaced by entries. */
function phase1Dir({ entries, pendingGenomes = [] } = {}) {
  const dir = join(mkdtempSync(join(tmpdir(), 'fu-')), 'tfakST1_productNames_20261111');
  cpSync(FU, dir, { recursive: true });
  rmSync(join(dir, 'curated'), { recursive: true });
  const input = join(dir, 'inputs', 'tfakST1_productNames_20261111_organism_entries.json');
  const found = JSON.parse(readFileSync(input, 'utf-8'));
  writeFileSync(input, JSON.stringify({ ...found, ...(entries ? { entries } : {}), pendingGenomes }));
  return dir;
}
const SOURCE = { datasetClass: 'productNames', functionalAnnotationSource: 'VEuPathDB' };

test('deriveUpdate bumps the one existing entry by default', () => {
  assert.deepEqual(fu.deriveUpdate(phase1Dir(), SOURCE), {
    schemaVersion: 1, datasetClass: 'productNames', mode: 'bump', name: 'VEuPathDB', previousVersion: '2026-07-22',
    history: { functionalAnnotationSource: 'VEuPathDB', text: 'functional annotation updated' }
  });
});

test('deriveUpdate resolves a $$constant$$ previous version from the organism\'s constants', () => {
  const dir = phase1Dir({ entries: [{ name: 'GenBank', version: '$$functAnnotVersion$$', props: {} }] });
  assert.equal(fu.deriveUpdate(dir, SOURCE).previousVersion, '2020-01-01');
});

test('deriveUpdate needs a name when the organism has several or no entries of the class, and newEntry for an unknown name', () => {
  const two = phase1Dir({ entries: [{ name: 'A', version: '2020-01-01', props: {} }, { name: 'B', version: '2020-01-01', props: {} }] });
  assert.throws(() => fu.deriveUpdate(two, SOURCE), /tfakST1 has 2 productNames entries \(A, B\); set "name" in --overrides/);
  assert.equal(fu.deriveUpdate(two, SOURCE, { name: 'B' }).mode, 'bump');
  assert.throws(() => fu.deriveUpdate(two, SOURCE, { name: 'C' }), /no productNames entry named C \(it has A, B\); set "update": \{ "newEntry": true \}/);
  const made = fu.deriveUpdate(two, { ...SOURCE, newEntry: true }, { name: 'C' });
  assert.deepEqual([made.mode, made.name, made.previousVersion], ['new', 'C', null]);
  assert.throws(() => fu.deriveUpdate(two, { ...SOURCE, newEntry: true }, { name: 'A' }), /A already exists; drop "newEntry" to update it/);
  assert.throws(() => fu.deriveUpdate(two, { ...SOURCE, newEntry: true }), /a new entry needs a "name" in --overrides/);
  const none = phase1Dir({ entries: [] });
  assert.throws(() => fu.deriveUpdate(none, SOURCE), /tfakST1 has 0 productNames entries \(none\); set "name" in --overrides/);
});

test('a bump needs a date for the current version, else the curator confirms by hand', () => {
  const expected = (v) => [`current version "${v}" of productNames VEuPathDB is not a date; compare by hand and confirm with update.newEntry or fix the organism file`];
  for (const previousVersion of ['$$functAnnotVersion$$', 'v3']) {
    const dir = join(mkdtempSync(join(tmpdir(), 'fu-')), 'tfakST1_productNames_20261111');
    cpSync(FU, dir, { recursive: true });
    const update = join(dir, 'curated', 'update.json');
    writeFileSync(update, JSON.stringify({ ...JSON.parse(readFileSync(update, 'utf-8')), previousVersion }));
    assert.deepEqual(fu.checkCurated(dir), expected(previousVersion));
  }
});

test('deriveUpdate refuses no source, an unknown class, another class\'s input and a pending genome', () => {
  assert.throws(() => fu.deriveUpdate(phase1Dir(), { datasetClass: 'productNames' }), /functionalAnnotationSource has no default/);
  assert.throws(() => fu.deriveUpdate(phase1Dir(), { ...SOURCE, datasetClass: 'dbxref_simple' }), /takes productNames, GeneOntologyAssociations/);
  assert.throws(() => fu.deriveUpdate(phase1Dir(), { ...SOURCE, datasetClass: 'geneName' }), /lists productNames entries, not geneName; re-run check-functional-entries\.js/);
  assert.throws(() => fu.deriveUpdate(phase1Dir({ pendingGenomes: ['GCA_9.1'] }), SOURCE), /genome proposal GCA_9\.1 on master names tfakST1/);
});

test('deriveIdentity and deriveDataset give the entry; a bump keeps the existing props, a new entry takes the class defaults', () => {
  const dir = phase1Dir();
  mkdirSync(join(dir, 'curated'));
  writeFileSync(join(dir, 'curated', 'update.json'), JSON.stringify(fu.deriveUpdate(dir, SOURCE)));
  assert.deepEqual(fu.deriveIdentity(dir), { datasetClass: 'productNames', name: 'VEuPathDB', version: undefined });
  assert.deepEqual(fu.deriveDataset(dir, fixtureClassOf('productNames')), {
    schemaVersion: 1, props: {}, source: { type: 'server', paths: ['/veupathdb/dataStaging/tfakST1_productNames_20261111/products_update.tsv'] }
  });
  assert.throws(() => fu.deriveDataset(dir, fixtureClassOf('productNames'), { props: { x: '1' } }), /take no "dataset" overrides/);

  const genes = phase1Dir({ entries: [{ name: 'GenBank', version: '2020-01-01', props: { genomeVersion: '$$genomeVersion$$' } }] });
  const input = join(genes, 'inputs', 'tfakST1_productNames_20261111_organism_entries.json');
  writeFileSync(input, readFileSync(input, 'utf-8').replace('"productNames"', '"geneName"'));
  mkdirSync(join(genes, 'curated'));
  writeFileSync(join(genes, 'curated', 'update.json'), JSON.stringify(fu.deriveUpdate(genes, { ...SOURCE, datasetClass: 'geneName', newEntry: true }, { name: 'VEuPathDB' })));
  assert.deepEqual(fu.deriveDataset(genes, fixtureClassOf('geneName')).props, { genomeVersion: '$$genomeVersion$$' });
});

test('a bump refuses existing props that reference a constant the update cannot carry', () => {
  const dir = phase1Dir({ entries: [{ name: 'VEuPathDB', version: '2026-07-22', props: { x: '$$odd$$' } }] });
  mkdirSync(join(dir, 'curated'));
  writeFileSync(join(dir, 'curated', 'update.json'), JSON.stringify(fu.deriveUpdate(dir, SOURCE)));
  assert.throws(() => fu.deriveDataset(dir, fixtureClassOf('productNames')), /props\.x references \$\$odd\$\$/);
});

test('checkCurated: version after the previous one, staging agrees with the staged upload', () => {
  assert.deepEqual(fu.checkCurated(FU), []);
  const dir = join(mkdtempSync(join(tmpdir(), 'fu-')), 'tfakST1_productNames_20261111');
  cpSync(FU, dir, { recursive: true });
  const datasets = join(dir, 'curated', 'datasets.json');
  writeFileSync(datasets, readFileSync(datasets, 'utf-8').replace('2026-11-03', '2026-07-01'));
  const manifest = join(dir, 'manifest.json');
  writeFileSync(manifest, readFileSync(manifest, 'utf-8').replace('"products_update.tsv"', '"other.tsv"'));
  assert.deepEqual(fu.checkCurated(dir), [
    'version 2026-07-01 must be later than the entry\'s current 2026-07-22',
    'manifest staging must list exactly the staged products_update.tsv with its sha256; re-run stage-file.js and pass its "staging" in --overrides'
  ]);
});

test('the curator date must be a real YYYY-MM-DD date', () => {
  assert.equal(historyDate('2026-11-03'), 'Nov 03, 2026');
  for (const bad of ['2026-02-30', '2026-13-01', '2026-1-3', 'soon', undefined]) assert.throws(() => historyDate(bad), /is not a real date, YYYY-MM-DD/);
  const dir = join(mkdtempSync(join(tmpdir(), 'fu-')), 'tfakST1_productNames_20261111');
  cpSync(FU, dir, { recursive: true });
  const datasets = join(dir, 'curated', 'datasets.json');
  writeFileSync(datasets, readFileSync(datasets, 'utf-8').replace('2026-11-03', '2026-11-31'));
  assert.throws(() => fu.checkCurated(dir), /version must be a date, YYYY-MM-DD/);
});
