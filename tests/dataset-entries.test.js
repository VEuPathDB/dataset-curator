import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  datasetsOf, onlyEntry, entriesLabel, readerOnRef, resolveEntry, constantsFor, constantsOf
} from '../shared/scripts/dataset-types/_common.js';
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
