import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as genome from '../shared/scripts/dataset-types/genome-assembly.js';
import { assertValidEntries, entryDeliveries, renderDatasets, constantsOf, datasetsOf } from '../shared/scripts/dataset-types/_common.js';
import { readDatasetClass, CLASSES_RELATIVE_PATH } from '../shared/scripts/lib/dataset-classes.js';
import { loadConstants } from '../shared/scripts/lib/load-ops.js';
import { withOrganismConstants } from '../shared/scripts/lib/organism-constants.js';
import { fixtures } from './helpers.js';

const CONSTANTS = { genomeSource: 'GenBank', genomeVersion: '2017-03-09', soTerm: 'chromosome', functAnnotVersion: '2017-03-09', source: 'GenBank' };
const SERVER = { type: 'server', paths: ['/data/tfakST-1'] };
const sequence = (datasetClass, soTerm, extra = {}) => ({
  datasetClass, name: '$$genomeSource$$', version: '$$genomeVersion$$',
  props: { ncbiTaxonId: '$$ncbiTaxonId$$', table: 'DoTS::ExternalNASequence', soTerm, sourceIdRegex: '^>(\\S+)', ...extra }, source: SERVER
});
const features = (datasetClass, soTerm, extra = {}) => ({
  datasetClass, name: '$$genomeSource$$', version: '$$genomeVersion$$',
  props: { ncbiTaxonId: '$$ncbiTaxonId$$', soTerm, mapFile: 'genemRNAExonCDS2Gus.xml', ...extra }, source: SERVER
});
const dbxref = (name, version, columnSpec, url) => ({
  datasetClass: 'dbxref_simple', name, version,
  props: { columnSpec, target: 'NAFeature', url, urlUsesSecondaryId: 'false', genomeVersion: '$$genomeVersion$$', viewName: 'Transcript' }, source: SERVER
});

/** Sequences, then features, then functional entries, as preprocessing writes them. Both secondary pairs share a name. */
const ENTRIES = [
  sequence('fasta_primary_genome_sequence', '$$soTerm$$', { releaseDate: '' }),
  sequence('fasta_secondary_genome', 'supercontig'),
  sequence('fasta_secondary_genome', 'contig'),
  sequence('fasta_organelle_genome', 'mitochondrial_chromosome', { organelle: 'mitochondrion' }),
  features('NoPreprocess_primary_genome_features', '$$soTerm$$', { source: '$$source$$' }),
  features('NoPreprocess_secondary_genome_features', 'supercontig'),
  features('NoPreprocess_secondary_genome_features', 'contig'),
  { datasetClass: 'productNames', name: 'GenBank', version: '$$functAnnotVersion$$', props: {}, source: SERVER },
  dbxref('EuPathDB_comment', '2022-09-01', 'primary_identifier', ''),
  dbxref('NCBI_Gene', '$$functAnnotVersion$$', 'primary_identifier,secondary_identifier', 'https://www.ncbi.nlm.nih.gov/gene/EXTERNAL_ID_HERE')
];

/** GCA_000001.1 amended as preprocessing would: its entries and constants, in a checkout with classes.xml. */
function syntheticGenome(t) {
  const repo = mkdtempSync(join(tmpdir(), 'genome-entries-'));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  mkdirSync(join(repo, 'Model/lib/xml/datasetClass'), { recursive: true });
  cpSync(join(fixtures, 'classes.xml'), join(repo, CLASSES_RELATIVE_PATH));
  const dir = join(repo, 'Proposals', 'GCA_000001.1');
  cpSync(join(fixtures, 'proposals', 'GCA_000001.1'), dir, { recursive: true });
  writeFileSync(join(dir, 'curated', 'datasets.json'), JSON.stringify({ schemaVersion: 2, datasets: ENTRIES }, null, 2) + '\n');
  writeFileSync(join(dir, 'curated', 'organism.json'), JSON.stringify({ constants: CONSTANTS }, null, 2) + '\n');
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf-8'));
  return { dir, manifest, classOf: (className) => readDatasetClass(repo, className) };
}

test('the synthetic genome proposal validates', (t) => {
  const { dir, manifest, classOf } = syntheticGenome(t);
  assert.deepEqual(assertValidEntries(dir, manifest, genome, { classOf }), ENTRIES);
});

test('each genome entry has its own datasetName and directory, and a file for organelle sequence, products and dbxrefs', (t) => {
  const { dir, manifest, classOf } = syntheticGenome(t);
  const where = entryDeliveries(manifest, datasetsOf(dir, manifest), { classOf, constants: constantsOf(dir), datasetType: genome });
  assert.deepEqual(where.map((l) => [l.datasetName, l.relative, l.file]), [
    ['tfakST-1_primary_genome_RSRC', 'FungiDB/tfakST-1/genome/chromosome_GenBank_fasta/2017-03-09/final', null],
    ['tfakST-1_supercontig_GenBank_RSRC', 'FungiDB/tfakST-1/genome/supercontig_GenBank_fasta/2017-03-09/final', null],
    ['tfakST-1_contig_GenBank_RSRC', 'FungiDB/tfakST-1/genome/contig_GenBank_fasta/2017-03-09/final', null],
    ['tfakST-1_mitochondrial_chromosome_GenBank_RSRC', 'FungiDB/tfakST-1/genome/mitochondrial_chromosome_GenBank_fasta/2017-03-09/final', 'genome.fasta'],
    ['tfakST-1_primary_genome_features_RSRC', 'FungiDB/tfakST-1/genome/chromosome_GenBank_gff3/2017-03-09/final', null],
    ['tfakST-1_supercontig_genome_features_RSRC', 'FungiDB/tfakST-1/genome/supercontig_GenBank_gff3/2017-03-09/final', null],
    ['tfakST-1_contig_genome_features_RSRC', 'FungiDB/tfakST-1/genome/contig_GenBank_gff3/2017-03-09/final', null],
    ['tfakST-1_function_GenBank_product_names_RSRC', 'FungiDB/tfakST-1/function/GenBank_product_names/2017-03-09/final', 'products.txt'],
    ['tfakST-1_dbxref_EuPathDB_comment_RSRC', 'FungiDB/tfakST-1/dbxref/EuPathDB_comment/2022-09-01/final', 'mapping.txt'],
    ['tfakST-1_dbxref_NCBI_Gene_RSRC', 'FungiDB/tfakST-1/dbxref/NCBI_Gene/2017-03-09/final', 'mapping.txt']
  ]);
});

test('the load XML holds one <dataset> per entry in entry order, constants left for the organism file', (t) => {
  const { dir, manifest, classOf } = syntheticGenome(t);
  const xml = renderDatasets(dir, manifest, genome, classOf);
  const blocks = xml.split('\n\n');
  assert.deepEqual(blocks.map((b) => /^  <dataset class="([^"]+)">/.exec(b)?.[1]), ENTRIES.map((e) => e.datasetClass));
  assert.equal(blocks[0], `  <dataset class="fasta_primary_genome_sequence">
    <prop name="projectName">$$projectName$$</prop>
    <prop name="organismAbbrev">$$organismAbbrev$$</prop>
    <prop name="ncbiTaxonId">$$ncbiTaxonId$$</prop>
    <prop name="name">$$genomeSource$$</prop>
    <prop name="version">$$genomeVersion$$</prop>
    <prop name="table">DoTS::ExternalNASequence</prop>
    <prop name="soTerm">$$soTerm$$</prop>
    <prop name="sourceIdRegex">^&gt;(\\S+)</prop>
    <prop name="releaseDate"></prop>
  </dataset>`);
  assert.doesNotMatch(blocks[4], /<prop name="name">/);
  assert.match(blocks[4], /<prop name="source">\$\$source\$\$<\/prop>/);
  assert.match(blocks[1], /<prop name="name">\$\$genomeSource\$\$<\/prop>[\s\S]*<prop name="soTerm">supercontig<\/prop>/);
  assert.match(blocks[2], /<prop name="name">\$\$genomeSource\$\$<\/prop>[\s\S]*<prop name="soTerm">contig<\/prop>/);
});

test('a load gives the proposal constants to the organism file and refuses a different value already there', (t) => {
  const { dir } = syntheticGenome(t);
  const { required, given } = loadConstants(genome, constantsOf(dir));
  const file = readFileSync(join(fixtures, 'tfakST1.xml'), 'utf-8');
  const { content, added } = withOrganismConstants(file, required, given, 'tfakST-1');
  assert.deepEqual(added, ['genomeSource=GenBank', 'genomeVersion=2017-03-09', 'soTerm=chromosome', 'functAnnotVersion=2017-03-09', 'source=GenBank']);
  assert.match(content, /<constant name="projectName" value="FungiDB"\/>\n  <constant name="genomeSource" value="GenBank"\/>/);
  assert.throws(() => withOrganismConstants(content.replace('value="GenBank"/>', 'value="RefSeq"/>'), required, given, 'tfakST-1'),
    /tfakST-1 already has genomeSource RefSeq; --genomeSource says GenBank/);
});
