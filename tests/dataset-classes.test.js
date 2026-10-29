import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { createGit } from '../shared/scripts/lib/git-ops.js';
import { initRepo } from './helpers.js';
import { readDatasetClass, readDatasetClassOnRef, expandPattern, identityValues, CLASSES_RELATIVE_PATH } from '../shared/scripts/lib/dataset-classes.js';
import { presenterNames } from '../shared/scripts/dataset-types/bulk-rnaseq.js';

const fixtures = new URL('./fixtures/', import.meta.url).pathname;

function repoWithClasses() {
  const repo = mkdtempSync(join(tmpdir(), 'classes-'));
  mkdirSync(join(repo, 'Model/lib/xml/datasetClass'), { recursive: true });
  cpSync(join(fixtures, 'classes.xml'), join(repo, CLASSES_RELATIVE_PATH));
  return repo;
}

test('reads the rnaSeqExperiment props, loader name and delivery path', () => {
  const c = readDatasetClass(repoWithClasses(), 'rnaSeqExperiment');
  assert.deepEqual(c.props, [
    'projectName', 'organismAbbrev', 'name', 'version', 'limitNU', 'hasPairedEnds',
    'isStrandSpecific', 'alignWithCdsCoordinates', 'fromSRA'
  ]);
  assert.equal(c.datasetNamePattern, '${organismAbbrev}_${name}_rnaSeq_RSRC');
  assert.equal(c.deliveryPath, '@@manualDeliveryDir@@/${projectName}/${organismAbbrev}/rnaSeq/${name}/${version}/final/');
});

test('the rnaseq presenter name is the class loader datasetName', () => {
  const c = readDatasetClass(repoWithClasses(), 'rnaSeqExperiment');
  const manifest = { accession: 'PRJNA000002', organisms: [{ proposedOrganismAbbrev: 'tfakST1', source: 'loaded', project: 'FungiDB' }], name: 'Doe_heat_shock_2024', version: '2024-05-01' };
  assert.equal(expandPattern(c.datasetNamePattern, identityValues(manifest, 'tfakST1')),
    presenterNames(join(fixtures, 'proposals', 'PRJNA000002'))[0]);
});

test('expandPattern fills identity and refuses an unknown placeholder', () => {
  assert.equal(expandPattern('${projectName}/${name}', { projectName: 'FungiDB', name: 'x' }), 'FungiDB/x');
  assert.throws(() => expandPattern('${nope}', {}), /No value for \$\{nope\}/);
});

test('refuses a missing class, or one without a loader', () => {
  const repo = repoWithClasses();
  assert.throws(() => readDatasetClass(repo, 'nope'), /Dataset class "nope" not found/);
  assert.throws(() => readDatasetClass(repo, 'noLoader'), /"noLoader" has no datasetLoader datasetName/);
  assert.throws(() => readDatasetClass(mkdtempSync(join(tmpdir(), 'noclasses-')), 'x'), /classes\.xml not found/);
});

const demo = join(homedir(), 'dataset-curation-demo');
test('reads the real rnaSeqExperiment class from a local VEuPathDatasets checkout',
  { skip: !existsSync(join(demo, CLASSES_RELATIVE_PATH)) && 'no local checkout' }, () => {
    assert.deepEqual(readDatasetClass(demo, 'rnaSeqExperiment'), readDatasetClass(repoWithClasses(), 'rnaSeqExperiment'));
  });

test('readDatasetClassOnRef reads classes.xml from a ref, not the working tree', () => {
  const { repo } = initRepo('classes-on-ref-');
  rmSync(join(repo, CLASSES_RELATIVE_PATH));
  const c = readDatasetClassOnRef(createGit(repo), 'origin/master', 'rnaSeqExperiment');
  assert.equal(c.deliveryPath, '@@manualDeliveryDir@@/${projectName}/${organismAbbrev}/rnaSeq/${name}/${version}/final/');
  assert.throws(() => readDatasetClassOnRef(createGit(repo), 'origin/master', 'noSuchClass'), /Dataset class "noSuchClass" not found/);
});
