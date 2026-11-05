import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { createGit } from '../shared/scripts/lib/git-ops.js';
import { initRepo } from './helpers.js';
import { memoClassOf, parseDatasetClass, readDatasetClass, readDatasetClassOnRef, expandPattern, CLASSES_RELATIVE_PATH } from '../shared/scripts/lib/dataset-classes.js';
import * as rnaseq from '../shared/scripts/dataset-types/bulk-rnaseq.js';
import * as dnaseq from '../shared/scripts/dataset-types/dnaseq.js';
import * as chipseq from '../shared/scripts/dataset-types/chipseq.js';
import { datasetNameOf } from '../shared/scripts/lib/artifacts.js';

const { presenterNames } = rnaseq;

const fixtures = new URL('./fixtures/', import.meta.url).pathname;
const demo = join(homedir(), 'dataset-curation-demo', 'VEuPathDatasets');

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
  assert.deepEqual(c.delivery, { dir: '${projectName}/${organismAbbrev}/rnaSeq/${name}/${version}/final', file: null });
});

test('the rnaseq presenter name is the class loader datasetName', () => {
  const c = readDatasetClass(repoWithClasses(), 'rnaSeqExperiment');
  const manifest = { accession: 'PRJNA000002', organisms: [{ proposedOrganismAbbrev: 'tfakST1', source: 'loaded', project: 'FungiDB' }], name: 'Doe_heat_shock_2024', version: '2024-05-01' };
  assert.equal(expandPattern(c.datasetNamePattern, { organismAbbrev: 'tfakST1', name: manifest.name }),
    presenterNames(join(fixtures, 'proposals', 'PRJNA000002'))[0]);
});

for (const [mod, className] of [[rnaseq, 'rnaSeqExperiment'], [dnaseq, 'dnaseqExperiment'], [chipseq, 'chipSeqExperiment']]) {
  test(`${className}: the type's datasetNameFor is the class loader datasetName`, () => {
    const manifest = { organisms: [{ proposedOrganismAbbrev: 'tfakST1', source: 'loaded', project: 'FungiDB' }] };
    const entry = { name: 'Doe_x_2024', version: '2024-05-01', props: {} };
    assert.equal(mod.datasetNameFor('tfakST1', 'Doe_x_2024'), datasetNameOf(manifest, readDatasetClass(repoWithClasses(), className), 'tfakST1', entry));
  });
}

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

test('reads the real rnaSeqExperiment class from a local VEuPathDatasets checkout',
  { skip: !existsSync(join(demo, CLASSES_RELATIVE_PATH)) && 'no local checkout' }, () => {
    assert.deepEqual(readDatasetClass(demo, 'rnaSeqExperiment'), readDatasetClass(repoWithClasses(), 'rnaSeqExperiment'));
  });

test('readDatasetClassOnRef reads classes.xml from a ref, not the working tree', () => {
  const { repo } = initRepo('classes-on-ref-');
  rmSync(join(repo, CLASSES_RELATIVE_PATH));
  const c = readDatasetClassOnRef(createGit(repo), 'origin/master', 'rnaSeqExperiment');
  assert.deepEqual(c.delivery, { dir: '${projectName}/${organismAbbrev}/rnaSeq/${name}/${version}/final', file: null });
  assert.throws(() => readDatasetClassOnRef(createGit(repo), 'origin/master', 'noSuchClass'), /Dataset class "noSuchClass" not found/);
});

const DELIVERIES = {
  rnaSeqExperiment: ['rnaSeq/${name}/${version}/final', null],
  dnaseqExperiment: ['SNP/${name}/${version}/final', null],
  chipSeqExperiment: ['chipSeq/${name}/${version}/final', null],
  fasta_primary_genome_sequence: ['genome/${soTerm}_${name}_fasta/${version}/final', null],
  fasta_secondary_genome: ['genome/${soTerm}_${name}_fasta/${version}/final', null],
  fasta_organelle_genome: ['genome/${soTerm}_${name}_fasta/${version}/final', 'genome.fasta'],
  NoPreprocess_primary_genome_features: ['genome/${soTerm}_${source}_gff3/${version}/final', null],
  NoPreprocess_secondary_genome_features: ['genome/${soTerm}_${name}_gff3/${version}/final', null],
  NoPreprocess_organelle_genome_features: ['genome/${soTerm}_${name}_gff3/${version}/final', null],
  productNames: ['function/${name}_product_names/${version}/final', 'products.txt'],
  GeneOntologyAssociations: ['function/${name}_GOAssociations/${version}/final', 'associations.gas'],
  EnzymeCommissionAssociations: ['function/${name}_ECAssociations/${version}/final', 'ec.txt'],
  geneName: ['function/${name}_gene_names/${version}/final', 'geneName.txt'],
  dbxref_synonym: ['function/synonym/${name}/${version}/final', 'synonyms.txt'],
  comments: ['comment/${name}/${version}/final', 'comments.txt'],
  aliases: ['alias/${name}/${version}/final', 'aliases.txt'],
  dbxref_simple: ['dbxref/${name}/${version}/final', 'mapping.txt']
};

for (const [className, [path, file]] of Object.entries(DELIVERIES)) {
  test(`${className} delivers from ${path}${file ? `/${file}` : '/'}`, () => {
    assert.deepEqual(readDatasetClass(repoWithClasses(), className).delivery, { dir: `\${projectName}/\${organismAbbrev}/${path}`, file });
  });
  test(`${className} reads as the local VEuPathDatasets checkout has it`,
    { skip: !existsSync(join(demo, CLASSES_RELATIVE_PATH)) && 'no local checkout' }, () => {
      const fixture = readDatasetClass(repoWithClasses(), className);
      const real = readDatasetClass(demo, className);
      assert.deepEqual([real.delivery, real.datasetNamePattern, real.props], [fixture.delivery, fixture.datasetNamePattern, fixture.props]);
    });
}

test('a class without a name prop keeps its own props; a datasetName on the next line still reads', () => {
  assert.deepEqual(readDatasetClass(repoWithClasses(), 'NoPreprocess_primary_genome_features').props,
    ['projectName', 'organismAbbrev', 'ncbiTaxonId', 'version', 'soTerm', 'source', 'mapFile']);
  assert.equal(readDatasetClass(repoWithClasses(), 'GeneOntologyAssociations').datasetNamePattern, '${organismAbbrev}_${name}_GOAssociations_RSRC');
});

test('a class matching no delivery shape, or delivering outside final/, is refused by name', () => {
  const repo = repoWithClasses();
  assert.throws(() => readDatasetClass(repo, 'noDelivery'), /Dataset class "noDelivery" declares no manual delivery/);
  assert.throws(() => readDatasetClass(repo, 'notFinal'),
    /Dataset class "notFinal" delivers from "\$\{projectName\}\/\$\{organismAbbrev\}\/data\/", which is not a final\/ directory or a file in one/);
});

test('manualGet fileOrDir is read whatever its attribute position', () => {
  const xml = `<datasetClasses><datasetClass class="x" category="" datasetFileHint="">
    <datasetLoader datasetName="\${organismAbbrev}_x_RSRC" version="\${version}">
      <manualGet foo="bar" fileOrDir="\${projectName}/x/\${version}/final/">
      </manualGet>
    </datasetLoader>
  </datasetClass></datasetClasses>`;
  assert.deepEqual(parseDatasetClass(xml, 'x').delivery, { dir: '${projectName}/x/${version}/final', file: null });
});

test('memoClassOf reads each class name once, and a failed read again', () => {
  const calls = [];
  const classOf = memoClassOf('/repo', (repoPath, className) => {
    calls.push([repoPath, className]);
    if (className === 'bad') throw new Error('no such class');
    return { className };
  });
  assert.equal(classOf('a'), classOf('a'));
  classOf('b');
  assert.throws(() => classOf('bad'), /no such class/);
  assert.throws(() => classOf('bad'), /no such class/);
  assert.deepEqual(calls, [['/repo', 'a'], ['/repo', 'b'], ['/repo', 'bad'], ['/repo', 'bad']]);
});
