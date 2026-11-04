import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  datasetsOf, onlyEntry, entriesLabel, readerOnRef, resolveEntry, constantsFor, constantsOf, entryDeliveries, assertValidEntries
} from '../shared/scripts/dataset-types/_common.js';
import { DATASET_TYPES } from '../shared/scripts/dataset-types/index.js';
import { deliveryLocation } from '../shared/scripts/lib/artifacts.js';
import { readDatasetClass, CLASSES_RELATIVE_PATH } from '../shared/scripts/lib/dataset-classes.js';
import { fixtures } from './helpers.js';

const rnaDir = join(fixtures, 'proposals', 'PRJNA000002');
const genomeDir = join(fixtures, 'proposals', 'GCA_000001.1');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf-8'));
const manifestOf = (dir) => readJson(join(dir, 'manifest.json'));
const LEGACY = { datasetClass: 'rnaSeqExperiment', name: 'Doe_heat_shock_2024', version: '2024-05-01' };

/** A scratch copy of a fixture proposal. */
function copyOf(t, accession = 'PRJNA000002') {
  const dir = join(mkdtempSync(join(tmpdir(), 'entries-')), accession);
  t.after(() => rmSync(join(dir, '..'), { recursive: true, force: true }));
  cpSync(join(fixtures, 'proposals', accession), dir, { recursive: true });
  return dir;
}

/** A copy of PRJNA000002 in the datasets.json shape, holding datasets or its own one entry. */
function asV2(t, datasets) {
  const dir = copyOf(t);
  const manifestPath = join(dir, 'manifest.json');
  const { datasetClass, name, version, ...rest } = readJson(manifestPath);
  const { props, source } = readJson(join(dir, 'curated', 'dataset.json'));
  writeFileSync(manifestPath, JSON.stringify(rest, null, 2) + '\n');
  rmSync(join(dir, 'curated', 'dataset.json'));
  writeFileSync(join(dir, 'curated', 'datasets.json'),
    JSON.stringify({ schemaVersion: 2, datasets: datasets ?? [{ datasetClass, name, version, props, source }] }, null, 2) + '\n');
  return dir;
}

/** The "  - " lines of a thrown validation message, or [] when fn returns. */
function problemsOf(fn) {
  try { fn(); return []; } catch (e) { return e.message.split('\n  - ').slice(1); }
}

test('datasetsOf reads curated/datasets.json and the old manifest-plus-dataset.json shape alike', (t) => {
  const v1 = datasetsOf(rnaDir, manifestOf(rnaDir));
  assert.deepEqual(v1, [{ ...LEGACY, props: readJson(join(rnaDir, 'curated', 'dataset.json')).props, source: { type: 'sra' } }]);
  const dir = asV2(t);
  assert.deepEqual(datasetsOf(dir, manifestOf(dir)), v1);
});

test('datasetsOf reads an old dataset.json without a source as SRA', (t) => {
  const dir = copyOf(t);
  const path = join(dir, 'curated', 'dataset.json');
  const { source, ...d } = readJson(path);
  writeFileSync(path, JSON.stringify(d));
  assert.deepEqual(datasetsOf(dir, manifestOf(dir))[0].source, { type: 'sra' });
});

test('a proposal with neither file and no manifest identity has no entries', () => {
  assert.deepEqual(datasetsOf(genomeDir, manifestOf(genomeDir)), []);
});

test('datasetsOf refuses dataset.json beside datasets.json, and manifest identity beside datasets.json', (t) => {
  const both = asV2(t);
  cpSync(join(rnaDir, 'curated', 'dataset.json'), join(both, 'curated', 'dataset.json'));
  assert.throws(() => datasetsOf(both, manifestOf(both)),
    /Invalid dataset entries of PRJNA000002:\n  - curated\/dataset\.json and curated\/datasets\.json are both present/);
  const identity = asV2(t);
  assert.throws(() => datasetsOf(identity, { ...manifestOf(identity), ...LEGACY }),
    /the manifest's datasetClass, name, version and curated\/datasets\.json both give dataset identity/);
});

test('datasetsOf refuses half of the old shape', (t) => {
  const dir = copyOf(t);
  rmSync(join(dir, 'curated', 'dataset.json'));
  assert.throws(() => datasetsOf(dir, manifestOf(dir)), /the manifest's datasetClass, name, version need curated\/dataset\.json/);
  const { datasetClass, name, version, ...bare } = manifestOf(rnaDir);
  assert.throws(() => datasetsOf(rnaDir, bare), /curated\/dataset\.json has no identity/);
});

test('datasetsOf checks each entry\'s shape', (t) => {
  const [entry] = datasetsOf(rnaDir, manifestOf(rnaDir));
  const errorsFor = (datasets) => { const dir = asV2(t, datasets); return problemsOf(() => datasetsOf(dir, manifestOf(dir))); };
  assert.deepEqual(errorsFor([{ ...entry, name: 'Doe heat' }]),
    ['rnaSeqExperiment Doe heat: name may contain only letters, digits and underscores, and must start with a letter, or be one $$constant$$']);
  assert.deepEqual(errorsFor([{ ...entry, name: 'Doe_PRJNA000002' }]),
    ['rnaSeqExperiment Doe_PRJNA000002: name "Doe_PRJNA000002" must be readable, not built from the accession']);
  assert.deepEqual(errorsFor([{ ...entry, version: '24 July 2021' }]),
    ['rnaSeqExperiment Doe_heat_shock_2024: version must be a date, YYYY-MM-DD, or one $$constant$$']);
  assert.deepEqual(errorsFor([{ ...entry, version: '$$a$$_$$b$$' }]),
    ['rnaSeqExperiment Doe_heat_shock_2024: version must be a date, YYYY-MM-DD, or one $$constant$$']);
  const { props, ...noProps } = entry;
  assert.deepEqual(errorsFor([{ ...noProps, colour: 'red' }]),
    ['rnaSeqExperiment Doe_heat_shock_2024: props is required', 'rnaSeqExperiment Doe_heat_shock_2024: colour is not an entry field']);
  assert.deepEqual(errorsFor([{ ...entry, props: { limitNU: 30 } }]),
    ['rnaSeqExperiment Doe_heat_shock_2024: props must be an object of string values']);
  assert.deepEqual(errorsFor([{ ...entry, source: { type: 'ftp' } }]),
    ['rnaSeqExperiment Doe_heat_shock_2024: source.type must be one of sra, server, url']);
  assert.deepEqual(errorsFor(['x']), ['datasets[0] must be an object { datasetClass, name, version, props, source }']);
  assert.deepEqual(errorsFor([{ ...entry, datasetClass: 'fasta_primary_genome_sequence', name: '$$genomeSource$$', version: '$$genomeVersion$$' }]), []);
});

test('datasetsOf refuses a (datasetClass, name) listed twice', (t) => {
  const [entry] = datasetsOf(rnaDir, manifestOf(rnaDir));
  const twice = asV2(t, [entry, { ...entry, version: '2025-01-01' }]);
  assert.deepEqual(problemsOf(() => datasetsOf(twice, manifestOf(twice))),
    ['rnaSeqExperiment Doe_heat_shock_2024 is listed more than once; datasetClass and name identify an entry']);
  const fine = asV2(t, [entry, { ...entry, datasetClass: 'chipSeqExperiment' }]);
  assert.equal(datasetsOf(fine, manifestOf(fine)).length, 2);
});

test('datasetsOf reads a proposal on a ref through readerOnRef; onlyEntry insists on one entry', () => {
  const files = { 'Proposals/PRJNA000002/curated/dataset.json': readFileSync(join(rnaDir, 'curated', 'dataset.json'), 'utf-8') };
  const git = { fileExistsOnRef: (ref, p) => ref === 'origin/master' && p in files, showFile: (ref, p) => files[p] };
  assert.deepEqual(datasetsOf('Proposals/PRJNA000002', manifestOf(rnaDir), { read: readerOnRef(git, 'origin/master') }),
    datasetsOf(rnaDir, manifestOf(rnaDir)));
  assert.equal(onlyEntry(rnaDir, manifestOf(rnaDir)).name, 'Doe_heat_shock_2024');
  assert.throws(() => onlyEntry(genomeDir, manifestOf(genomeDir)), /Proposal GCA_000001\.1 needs exactly one dataset entry; it has 0/);
  assert.equal(entriesLabel([{ name: 'Doe_2024' }]), 'Doe_2024');
  assert.equal(entriesLabel([{ name: 'a' }, { name: 'b' }]), '2 datasets');
});

test('datasetsOf refuses impossible calendar dates', (t) => {
  const [entry] = datasetsOf(rnaDir, manifestOf(rnaDir));
  const dir = asV2(t, [{ ...entry, version: '2024-02-30' }]);
  assert.deepEqual(problemsOf(() => datasetsOf(dir, manifestOf(dir))),
    ['rnaSeqExperiment Doe_heat_shock_2024: version must be a date, YYYY-MM-DD, or one $$constant$$']);
});

test('datasetsOf reads an empty datasets list as no entries, and refuses a datasets.json holding null', (t) => {
  const dir = asV2(t, []);
  assert.deepEqual(datasetsOf(dir, manifestOf(dir)), []);
  writeFileSync(join(dir, 'curated', 'datasets.json'), 'null');
  assert.throws(() => datasetsOf(dir, manifestOf(dir)), /curated\/datasets\.json must be \{ "schemaVersion": 2, "datasets": \[\.\.\.\] \}/);
});

test('the accession check applies to literal names, not $$constant$$ names', (t) => {
  const [entry] = datasetsOf(rnaDir, manifestOf(rnaDir));
  const dir = asV2(t, [{ ...entry, name: '$$PRJNA000002$$' }]);
  assert.deepEqual(datasetsOf(dir, manifestOf(dir)).map((e) => e.name), ['$$PRJNA000002$$']);
});

const GENOME_CONSTANTS = { genomeSource: 'GenBank', genomeVersion: '2017-03-09', soTerm: 'chromosome', functAnnotVersion: '2017-03-09', source: 'GenBank' };
const SERVER = { type: 'server', paths: ['/data/tfakST-1'] };
const PRIMARY = {
  datasetClass: 'fasta_primary_genome_sequence', name: '$$genomeSource$$', version: '$$genomeVersion$$',
  props: { ncbiTaxonId: '$$ncbiTaxonId$$', table: 'DoTS::ExternalNASequence', soTerm: '$$soTerm$$', sourceIdRegex: '^>(\\S+)', releaseDate: '' },
  source: SERVER
};
const genomeManifest = manifestOf(genomeDir);

test('resolveEntry fills $$constants$$ in name, version and props; organism-file constants stay references', () => {
  const c = constantsFor(genomeManifest, 'tfakST-1', GENOME_CONSTANTS);
  assert.deepEqual(resolveEntry(PRIMARY, c), {
    ...PRIMARY, name: 'GenBank', version: '2017-03-09',
    props: { ncbiTaxonId: '$$ncbiTaxonId$$', table: 'DoTS::ExternalNASequence', soTerm: 'chromosome', sourceIdRegex: '^>(\\S+)', releaseDate: '' }
  });
  assert.deepEqual([c.projectName, c.organismAbbrev, c.strainAbbrev], ['FungiDB', 'tfakST-1', '$$strainAbbrev$$']);
  assert.equal(constantsFor(genomeManifest, 'tfakST-1', {}, { requiredOrganismConstants: { ploidy: /^\d+$/ } }).ploidy, '$$ploidy$$');
});

test('resolveEntry refuses an unresolved constant and a version that resolves to no date', () => {
  const c = constantsFor(genomeManifest, 'tfakST-1', GENOME_CONSTANTS);
  assert.throws(() => resolveEntry({ ...PRIMARY, name: '$$annotationSource$$' }, c),
    /fasta_primary_genome_sequence \$\$annotationSource\$\$: \$\$annotationSource\$\$ is not a known constant \(curated\/organism\.json, projectName, organismAbbrev, strainAbbrev, ncbiTaxonId, speciesNcbiTaxonId, or one the dataset type requires\)/);
  assert.throws(() => resolveEntry({ ...PRIMARY, version: '$$soTerm$$' }, c),
    /fasta_primary_genome_sequence \$\$genomeSource\$\$: version \$\$soTerm\$\$ resolves to "chromosome", not a date YYYY-MM-DD/);
  assert.throws(() => resolveEntry({ ...PRIMARY, version: '$$strainAbbrev$$' }, c), /resolves to "\$\$strainAbbrev\$\$", not a date/);
});

test('constantsOf reads curated/organism.json constants, and {} without them', (t) => {
  const dir = copyOf(t, 'GCA_000001.1');
  const record = join(dir, 'curated', 'organism.json');
  assert.deepEqual(constantsOf(dir), {});
  writeFileSync(record, JSON.stringify({ schemaVersion: 1 }));
  assert.deepEqual(constantsOf(dir), {});
  writeFileSync(record, JSON.stringify({ schemaVersion: 1, constants: GENOME_CONSTANTS }));
  assert.deepEqual(constantsOf(dir), GENOME_CONSTANTS);
  writeFileSync(record, JSON.stringify({ constants: { soTerm: 1 } }));
  assert.throws(() => constantsOf(dir), /constants must be an object of string values/);
  writeFileSync(record, JSON.stringify({ constants: { 'so term': 'x' } }));
  assert.throws(() => constantsOf(dir), /constants has an invalid name "so term"/);
});

test('resolveEntry substitutes inside a prop string and names the entry and constant when a prop is unresolved', () => {
  const c = constantsFor(genomeManifest, 'tfakST-1', GENOME_CONSTANTS);
  assert.equal(resolveEntry({ ...PRIMARY, props: { ...PRIMARY.props, table: 'pre$$soTerm$$post' } }, c).props.table, 'prechromosomepost');
  assert.throws(() => resolveEntry({ ...PRIMARY, props: { ...PRIMARY.props, table: '$$nope$$' } }, c),
    /fasta_primary_genome_sequence \$\$genomeSource\$\$: \$\$nope\$\$ is not a known constant/);
});

test('constantsOf names the path of invalid JSON and refuses constants the organism file owns', (t) => {
  const dir = copyOf(t, 'GCA_000001.1');
  const record = join(dir, 'curated', 'organism.json');
  writeFileSync(record, '{ nope');
  assert.throws(() => constantsOf(dir), (e) => e.message.includes(record) && /is not valid JSON/.test(e.message));
  for (const name of ['projectName', 'organismAbbrev', 'strainAbbrev', 'ncbiTaxonId', 'speciesNcbiTaxonId']) {
    writeFileSync(record, JSON.stringify({ constants: { [name]: 'x' } }));
    assert.throws(() => constantsOf(dir), new RegExp(`constants may not set ${name}; the organism file owns it`));
  }
});

/** classOf over a scratch checkout holding the fixture classes.xml. */
function classesRepo(t) {
  const repo = mkdtempSync(join(tmpdir(), 'entries-classes-'));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  mkdirSync(join(repo, 'Model/lib/xml/datasetClass'), { recursive: true });
  cpSync(join(fixtures, 'classes.xml'), join(repo, CLASSES_RELATIVE_PATH));
  return (className) => readDatasetClass(repo, className);
}

test('deliveryLocation expands the class path from the organism and the resolved entry, and names an unfilled placeholder', (t) => {
  const classOf = classesRepo(t);
  const entry = resolveEntry(PRIMARY, constantsFor(genomeManifest, 'tfakST-1', GENOME_CONSTANTS));
  assert.deepEqual(deliveryLocation(genomeManifest, classOf('fasta_primary_genome_sequence'), 'tfakST-1', entry), {
    target: '@@manualDeliveryDir@@/FungiDB/tfakST-1/genome/chromosome_GenBank_fasta/2017-03-09/final/',
    relative: 'FungiDB/tfakST-1/genome/chromosome_GenBank_fasta/2017-03-09/final',
    file: null
  });
  const features = {
    datasetClass: 'NoPreprocess_primary_genome_features', name: 'GenBank', version: '2017-03-09',
    props: { ncbiTaxonId: '1', soTerm: 'chromosome', mapFile: 'x.xml' }, source: SERVER
  };
  assert.throws(() => deliveryLocation(genomeManifest, classOf('NoPreprocess_primary_genome_features'), 'tfakST-1', features),
    /NoPreprocess_primary_genome_features GenBank: No value for \$\{source\} in/);
});

test('entryDeliveries gives each organism every entry, in entry order', (t) => {
  const classOf = classesRepo(t);
  const products = { datasetClass: 'productNames', name: 'GenBank', version: '$$functAnnotVersion$$', props: {}, source: SERVER };
  const where = entryDeliveries(genomeManifest, [PRIMARY, products], { classOf, constants: GENOME_CONSTANTS });
  assert.deepEqual(where.map((w) => [w.label, w.organism, w.relative, w.file]), [
    ['fasta_primary_genome_sequence $$genomeSource$$', 'tfakST-1', 'FungiDB/tfakST-1/genome/chromosome_GenBank_fasta/2017-03-09/final', null],
    ['productNames GenBank', 'tfakST-1', 'FungiDB/tfakST-1/function/GenBank_product_names/2017-03-09/final', 'products.txt']
  ]);
  assert.equal(where[0].entry, PRIMARY);
});

const genome = DATASET_TYPES['genome-assembly'];
const rnaseq = DATASET_TYPES['bulk-rnaseq'];

/** A copy of genome GCA_000001.1 holding datasets, with constants in curated/organism.json. */
function genomeWith(t, datasets, constants = GENOME_CONSTANTS) {
  const dir = copyOf(t, 'GCA_000001.1');
  writeFileSync(join(dir, 'curated', 'datasets.json'), JSON.stringify({ schemaVersion: 2, datasets }, null, 2) + '\n');
  writeFileSync(join(dir, 'curated', 'organism.json'), JSON.stringify({ constants }, null, 2) + '\n');
  return dir;
}

test('every dataset type declares the classes its entries may hold', () => {
  assert.deepEqual(DATASET_TYPES['bulk-rnaseq'].datasetClasses, ['rnaSeqExperiment']);
  assert.deepEqual(DATASET_TYPES.dnaseq.datasetClasses, ['dnaseqExperiment']);
  assert.deepEqual(DATASET_TYPES.chipseq.datasetClasses, ['chipSeqExperiment']);
  for (const type of ['bulk-rnaseq', 'dnaseq', 'chipseq']) assert.equal(DATASET_TYPES[type].singleEntry, true, type);
  assert.equal(genome.singleEntry, undefined);
  assert.deepEqual(genome.datasetClasses, [
    'fasta_primary_genome_sequence', 'fasta_secondary_genome', 'fasta_organelle_genome',
    'NoPreprocess_primary_genome_features', 'NoPreprocess_secondary_genome_features', 'NoPreprocess_organelle_genome_features',
    'productNames', 'GeneOntologyAssociations', 'EnzymeCommissionAssociations', 'geneName', 'dbxref_synonym', 'comments', 'aliases', 'dbxref_simple'
  ]);
});

test('assertValidEntries returns valid entries', (t) => {
  const classOf = classesRepo(t);
  assert.deepEqual(assertValidEntries(genomeWith(t, [PRIMARY]), genomeManifest, genome, { classOf }), [PRIMARY]);
  assert.deepEqual(assertValidEntries(rnaDir, manifestOf(rnaDir), rnaseq, { classOf }), datasetsOf(rnaDir, manifestOf(rnaDir)));
  assert.deepEqual(assertValidEntries(genomeDir, genomeManifest, genome, { classOf }), []);
});

test('assertValidEntries refuses a class the type does not hold, and the wrong count for a single-entry type', (t) => {
  const classOf = classesRepo(t);
  const [rna] = datasetsOf(rnaDir, manifestOf(rnaDir));
  assert.deepEqual(problemsOf(() => assertValidEntries(genomeWith(t, [rna]), genomeManifest, genome, { classOf })),
    [`rnaSeqExperiment Doe_heat_shock_2024: genome-assembly proposals hold ${genome.datasetClasses.join(', ')}, not rnaSeqExperiment`]);
  const two = asV2(t, [rna, { ...rna, name: 'Doe_cold_shock_2024' }]);
  assert.deepEqual(problemsOf(() => assertValidEntries(two, manifestOf(two), rnaseq, { classOf })),
    ['bulk-rnaseq proposals hold exactly one dataset entry; this one has 2']);
  const none = asV2(t, []);
  assert.deepEqual(problemsOf(() => assertValidEntries(none, manifestOf(none), rnaseq, { classOf })),
    ['bulk-rnaseq proposals hold exactly one dataset entry; this one has 0']);
});

test('assertValidEntries refuses missing and extra props', (t) => {
  const classOf = classesRepo(t);
  const { sourceIdRegex, ...props } = PRIMARY.props;
  const dir = genomeWith(t, [{ ...PRIMARY, props: { ...props, colour: 'red', name: 'x' } }]);
  assert.deepEqual(problemsOf(() => assertValidEntries(dir, genomeManifest, genome, { classOf })), [
    'fasta_primary_genome_sequence $$genomeSource$$: props.sourceIdRegex is required by class fasta_primary_genome_sequence',
    'fasta_primary_genome_sequence $$genomeSource$$: props.colour is not a prop of class fasta_primary_genome_sequence',
    'fasta_primary_genome_sequence $$genomeSource$$: props.name comes from the entry and its organism and must not be set here'
  ]);
});

test('assertValidEntries refuses an unresolved constant and a version that resolves to no date', (t) => {
  const classOf = classesRepo(t);
  assert.deepEqual(problemsOf(() => assertValidEntries(genomeWith(t, [{ ...PRIMARY, name: '$$annotationSource$$' }]), genomeManifest, genome, { classOf })),
    ['fasta_primary_genome_sequence $$annotationSource$$: $$annotationSource$$ is not a known constant (curated/organism.json, projectName, organismAbbrev, strainAbbrev, ncbiTaxonId, speciesNcbiTaxonId, or one the dataset type requires)']);
  assert.deepEqual(problemsOf(() => assertValidEntries(genomeWith(t, [{ ...PRIMARY, version: '$$soTerm$$' }]), genomeManifest, genome, { classOf })),
    ['fasta_primary_genome_sequence $$genomeSource$$: version $$soTerm$$ resolves to "chromosome", not a date YYYY-MM-DD']);
});

test('assertValidEntries refuses an unfilled delivery placeholder and two entries delivering to one directory', (t) => {
  const classOf = classesRepo(t);
  const features = {
    datasetClass: 'NoPreprocess_primary_genome_features', name: '$$genomeSource$$', version: '$$genomeVersion$$',
    props: { ncbiTaxonId: '$$ncbiTaxonId$$', soTerm: '$$soTerm$$', mapFile: 'genemRNAExonCDS2Gus.xml' }, source: SERVER
  };
  const unfilled = problemsOf(() => assertValidEntries(genomeWith(t, [features]), genomeManifest, genome, { classOf }));
  assert.ok(unfilled.includes('NoPreprocess_primary_genome_features GenBank: No value for ${source} in "${projectName}/${organismAbbrev}/genome/${soTerm}_${source}_gff3/${version}/final"'), unfilled.join('\n'));
  const secondary = {
    datasetClass: 'fasta_secondary_genome', name: '$$genomeSource$$', version: '$$genomeVersion$$',
    props: { ncbiTaxonId: '$$ncbiTaxonId$$', table: 'DoTS::ExternalNASequence', soTerm: 'supercontig', sourceIdRegex: '^>(\\S+)' }, source: SERVER
  };
  assert.deepEqual(problemsOf(() => assertValidEntries(genomeWith(t, [secondary, { ...secondary, name: 'GenBank' }]), genomeManifest, genome, { classOf })),
    ['fasta_secondary_genome $$genomeSource$$ and fasta_secondary_genome GenBank both deliver to FungiDB/tfakST-1/genome/supercontig_GenBank_fasta/2017-03-09/final']);
});
