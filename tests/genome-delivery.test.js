import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as genome from '../shared/scripts/dataset-types/genome-assembly.js';
import { entryDeliveries, datasetsOf, constantsOf } from '../shared/scripts/dataset-types/_common.js';
import { parseDatasetClass } from '../shared/scripts/lib/dataset-classes.js';
import { collectPreprocessed } from '../shared/scripts/lib/preprocessed.js';
import { readPreprocessed } from '../shared/scripts/dataset-types/genome-assembly/preprocess.js';
import { fixtures } from './helpers.js';
import { genomeWorkArea, amendedProposal, editJson, PARTITIONS } from './genome-work-area.js';

const classes = readFileSync(join(fixtures, 'classes.xml'), 'utf-8');
const classOf = (className) => parseDatasetClass(classes, className);

/** An amended proposal's entry locations, and a report that validated its work area as it is now. */
function delivering(options) {
  const workArea = genomeWorkArea(options);
  const { dir, manifest } = amendedProposal(workArea);
  const locations = entryDeliveries(manifest, datasetsOf(dir, manifest), { classOf, constants: constantsOf(dir), datasetType: genome });
  return { workArea, dir, locations, report: { preprocess: readPreprocessed(workArea).sha256 } };
}
const collect = (d, report = d.report) => collectPreprocessed({ datasetType: genome, proposalDir: d.dir, proposalId: 'GCA_000001.1', locations: d.locations, workArea: d.workArea, report });
const G = 'FungiDB/tfakST-1/genome';

test('the genome hook delivers each partition\'s files and each functional file under its entry, with provenance', () => {
  const d = delivering();
  const { sources, provenance } = collect(d);
  const from = (rel) => realpathSync(join(d.workArea, rel));
  assert.deepEqual(sources, {
    [`${G}/chromosome_GenBank_fasta/2024-03-05/final/genome.fasta`]: from('final/primary_chromosome/genome.fasta'),
    [`${G}/chromosome_GenBank_fasta/2024-03-05/final/chromosomeMap.txt`]: from('final/primary_chromosome/chromosomeMap.txt'),
    [`${G}/contig_GenBank_fasta/2024-03-05/final/genome.fasta`]: from('final/secondary_contig/genome.fasta'),
    [`${G}/mitochondrial_chromosome_GenBank_fasta/2024-03-05/final/genome.fasta`]: from('final/organelle_mitochondrion/genome.fasta'),
    [`${G}/chromosome_GenBank_gff3/2024-03-05/final/genome.gff`]: from('final/primary_chromosome/genome.gff'),
    [`${G}/chromosome_GenBank_gff3/2024-03-05/final/transcriptInfoAndIds`]: from('final/primary_chromosome/transcriptInfoAndIds'),
    [`${G}/contig_GenBank_gff3/2024-03-05/final/genome.gff`]: from('final/secondary_contig/genome.gff'),
    [`${G}/contig_GenBank_gff3/2024-03-05/final/transcriptInfoAndIds`]: from('final/secondary_contig/transcriptInfoAndIds'),
    'FungiDB/tfakST-1/function/GenBank_product_names/2024-04-01/final/products.txt': from('final/function/productNames/GenBank/products.txt'),
    'FungiDB/tfakST-1/function/GenBank_gene_names/2024-04-01/final/geneName.txt': from('final/function/geneName/GenBank/geneName.txt'),
    'FungiDB/tfakST-1/dbxref/uniprot_from_annotation/2024-04-01/final/mapping.txt': from('final/function/dbxref_simple/uniprot_from_annotation/mapping.txt'),
    'FungiDB/tfakST-1/dbxref/ensemblgenomes_gn_from_annotation/2024-04-01/final/mapping.txt': from('final/function/dbxref_simple/ensemblgenomes_gn_from_annotation/mapping.txt')
  });
  const summary = { ...d.report.preprocess, database: 'UniDB_test', release: '20261105T000000', generator: '4.0.0' };
  assert.deepEqual(Object.values(provenance), d.locations.map(() => summary));
});

test('the hook refuses a work area that changed since validation, naming it once per delivery, and a report without preprocessing', () => {
  const d = delivering();
  editJson(join(d.workArea, 'trial/trial.json'), (r) => ({ ...r, kept: true }));
  assert.throws(() => collect(d), (e) => (e.message.match(/the work area changed since validation; validate again/g) ?? []).length === 1);
  assert.throws(() => collect(delivering(), { proposalTree: 't' }), /the verification report records no preprocessing; validate again/);
});

test('the hook refuses an undeliverable or unreadable work area under the entry label', () => {
  const failed = delivering();
  editJson(join(failed.workArea, 'trial/trial.json'), (r) => ({ ...r, result: 'failed' }));
  assert.throws(() => collect(failed, { preprocess: readPreprocessed(failed.workArea).sha256 }),
    /GCA_000001\.1: the preprocessing work area cannot be delivered:\n  - fasta_primary_genome_sequence \$\$genomeSource\$\$ \(chromosome\): trial\/trial\.json: the trial result is "failed"/);
  const d = delivering();
  rmSync(join(d.workArea, 'functional.json'));
  assert.throws(() => collect(d), /functional\.json: is missing/);
});

test('the hook refuses an entry with no partition, no features, no functional dataset, or another file name', () => {
  const d = delivering();
  const at = (className) => d.locations.find((l) => l.entry.datasetClass === className);
  const withEntry = (location, entry) => ({ ...location, entry: { ...location.entry, ...entry } });
  const strays = [
    withEntry(at('fasta_secondary_genome'), { props: { ...at('fasta_secondary_genome').entry.props, soTerm: 'supercontig' } }),
    withEntry(at('fasta_organelle_genome'), { datasetClass: 'NoPreprocess_organelle_genome_features' }),
    withEntry(at('productNames'), { name: 'RefSeq' }),
    { ...at('geneName'), file: 'names.txt' }
  ];
  assert.throws(() => collect({ ...d, locations: strays }), (e) => [
    /no partition in genome-build\.json is secondary with soTerm supercontig; re-run amend-proposal\.js/,
    /partition organelle_mitochondrion has no features to load; re-run amend-proposal\.js/,
    /functional\.json has no productNames dataset named RefSeq; re-run amend-proposal\.js/,
    /functional\.json gives final\/function\/geneName\/GenBank\/geneName\.txt, but the class loads names\.txt/
  ].every((re) => re.test(e.message)));
});

test('the hook keeps nothing between deliveries: a stale work area refuses every time, and a fixed one passes', () => {
  const d = delivering();
  const path = join(d.workArea, 'trial/trial.json');
  const original = readFileSync(path, 'utf-8');
  editJson(path, (r) => ({ ...r, kept: true }));
  const stale = /the work area changed since validation; validate again/;
  assert.throws(() => collect(d), stale);
  assert.throws(() => collect(d), stale);
  writeFileSync(path, original);
  assert.ok(Object.keys(collect(d).sources).length > 0);
});

test('the hook names a features partition the trial produced no transcriptInfoAndIds for', () => {
  const d = delivering();
  editJson(join(d.workArea, 'trial/trial.json'), (r) => ({ ...r, outputs: {} }));
  assert.throws(() => collect(d, { preprocess: readPreprocessed(d.workArea).sha256 }), /primary_chromosome: the trial has no transcriptInfoAndIds for it/);
});

test('a second organelle maps to its own partition', () => {
  const apicoplast = {
    role: 'organelle', soTerm: 'apicoplast_chromosome', organelle: 'apicoplast', sequenceCount: 1, dir: 'final/organelle_apicoplast', featureCount: 0, gffLines: 0,
    final: { gff: null, fasta: 'genome.fasta', chromosomeMap: null }, featureTypes: {}, maxIntron: 0, fasta: '>AP1\nCCCC\n', transcripts: []
  };
  const d = delivering({ partitions: [...PARTITIONS, apicoplast] });
  const { sources } = collect(d);
  assert.equal(sources[`${G}/apicoplast_chromosome_GenBank_fasta/2024-03-05/final/genome.fasta`], realpathSync(join(d.workArea, 'final/organelle_apicoplast/genome.fasta')));
  assert.equal(sources[`${G}/mitochondrial_chromosome_GenBank_fasta/2024-03-05/final/genome.fasta`], realpathSync(join(d.workArea, 'final/organelle_mitochondrion/genome.fasta')));
});

test('the hook refuses a genome-build.json or functional.json that changed since validation, as it does a trial.json', () => {
  for (const file of ['genome-build.json', 'functional.json']) {
    const d = delivering();
    appendFileSync(join(d.workArea, file), '\n');
    assert.throws(() => collect(d), /the work area changed since validation; validate again/, file);
  }
});

test('two organisms of one proposal deliver each partition under their own paths', () => {
  const d = delivering();
  const [first] = d.locations.filter((l) => l.entry.datasetClass === 'fasta_primary_genome_sequence');
  const second = { ...first, organism: 'tfakST-2', relative: first.relative.replace('tfakST-1', 'tfakST-2') };
  const { sources } = collect({ ...d, locations: [first, second] });
  assert.deepEqual(Object.keys(sources).filter((p) => p.endsWith('/genome.fasta')),
    [`${G}/chromosome_GenBank_fasta/2024-03-05/final/genome.fasta`, 'FungiDB/tfakST-2/genome/chromosome_GenBank_fasta/2024-03-05/final/genome.fasta']);
});
