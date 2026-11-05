import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractDatasets, fileText, uniqueSorted } from '../shared/scripts/genome/functional/classes.js';
import { resolveFeatures } from '../shared/scripts/genome/functional/ids.js';
import { parseGff } from '../shared/scripts/genome/gff.js';
import { CM, gffLine, gffText } from './genome-helpers.js';

const CTX = { source: 'GenBank', taxonId: 284813, date: '20261104' };
const extract = (...lines) => {
  const { features, codingTranscripts } = resolveFeatures(parseGff(gffText(...lines)));
  return extractDatasets(features, { source: 'GenBank', codingTranscripts });
};
const dataset = (result, datasetClass, name) => result.datasets.find((d) => d.datasetClass === datasetClass && d.name === name);
const text = (result, datasetClass, name) => fileText(dataset(result, datasetClass, name), CTX);
const checks = (result) => result.findings.map((f) => [f.severity, f.check, f.count, f.sample]);

const codingGene = (id, { gene = '', rna = '', cds = '' } = {}) => [
  gffLine(CM, 'gene', 100, 900, '+', `ID=${id}${gene}`),
  gffLine(CM, 'mRNA', 100, 900, '+', `ID=${id}_mRNA;Parent=${id}${rna}`),
  gffLine(CM, 'exon', 100, 900, '+', `ID=${id}_mRNA_exon1;Parent=${id}_mRNA`),
  gffLine(CM, 'CDS', 100, 900, '+', `ID=${id}.p;Parent=${id}_mRNA${cds}`)
];
const trnaGene = (id, rna) => [
  gffLine(CM, 'gene', 1000, 1072, '+', `ID=${id}`),
  gffLine(CM, 'tRNA', 1000, 1072, '+', `ID=rna-${id};Parent=${id}${rna}`)
];

test('uniqueSorted drops repeated rows and orders by code unit, ID first', () => {
  assert.deepEqual(uniqueSorted([['b', 'x'], ['a', 'z'], ['b', 'x'], ['a', 'Z'], ['B', 'y']]), [['B', 'y'], ['a', 'Z'], ['a', 'z'], ['b', 'x']]);
});

test('productNames reads product from the CDS, and from an RNA that has no CDS', () => {
  const r = extract(
    ...codingGene('ECU10_0010', { rna: ';product=ignored mRNA product', cds: ';product=hypothetical protein' }),
    ...trnaGene('ECU10_0155', ';product=tRNA-Asn')
  );
  assert.equal(text(r, 'productNames', 'GenBank'), 'ECU10_0010_mRNA\thypothetical protein\t1\nrna-ECU10_0155\ttRNA-Asn\t1\n');
  assert.equal(dataset(r, 'productNames', 'GenBank').level, 'transcript');
  assert.equal(dataset(r, 'productNames', 'GenBank').file, 'products.txt');
});

test('is_preferred marks the first product in GFF order, then rows sort by ID and product', () => {
  const r = extract(
    ...codingGene('B_0020', { cds: ';product=zinc finger%2C C2H2 type,DNA binding protein' }),
    ...codingGene('A_0010', { cds: ';product=kinase' })
  );
  assert.equal(text(r, 'productNames', 'GenBank'),
    'A_0010_mRNA\tkinase\t1\nB_0020_mRNA\tDNA binding protein\t0\nB_0020_mRNA\tzinc finger, C2H2 type\t1\n');
  assert.deepEqual(checks(r).filter(([, check]) => check === 'multipleProducts'), [['info', 'multipleProducts', 1, ['B_0020_mRNA']]]);
});

test('a coding transcript with no product is a noProducts error; an RNA without one is not', () => {
  const r = extract(...codingGene('ECU10_0010', { cds: ';product=kinase' }), ...codingGene('ECU10_0020'), ...trnaGene('ECU10_0155', ''));
  assert.deepEqual(checks(r).filter(([severity]) => severity === 'error'), [['error', 'noProducts', 1, ['ECU10_0020_mRNA']]]);
});

test('geneName keeps the gene feature\'s own name, skips one equal to its ID or a locus_tag, and warns when its features disagree', () => {
  const r = extract(
    ...codingGene('ECU10_0010', { gene: ';gene=ECU10_0010', cds: ';gene=ECU10_0010;product=p' }),
    gffLine(CM, 'gene', 53670, 53750, '-', 'ID=ECU11_0375_2;gene=ECU11_0375'),
    gffLine(CM, 'tRNA', 53670, 53750, '-', 'ID=rna-ECU11_0375;Parent=ECU11_0375_2;gene=ECU11_0375;product=tRNA-Leu'),
    ...codingGene('TST_0030', { gene: ';gene=tstC;locus_tag=TST_0030', cds: ';gene=tstC2;product=p' }),
    ...codingGene('TST_0040', { gene: ';gene=TST_0040x;locus_tag=TST_0040x', cds: ';product=p' }),
    ...codingGene('TST_0050', { cds: ';gene=tstE;product=p' })
  );
  assert.equal(text(r, 'geneName', 'GenBank'), 'ECU11_0375_2\tECU11_0375\nTST_0030\ttstC\nTST_0050\ttstE\n');
  assert.deepEqual(checks(r).filter(([, check]) => check === 'geneNameConflict'), [['warning', 'geneNameConflict', 1, ['TST_0030']]]);
});

test('comments: Notes on RNAs and CDSs go to transcripts, Notes on genes to genes', () => {
  const r = extract(
    ...codingGene('ECU10_0010', { gene: ';Note=gene note', cds: ';Note=10_0010%2C unknown%2C gene found by Glimmer;product=p' }),
    ...trnaGene('ECU10_0155', ';Note=tRNA found by tRNAscan-SE;product=tRNA-Asn')
  );
  assert.equal(text(r, 'comments', 'GenBank_transcript'),
    'ECU10_0010_mRNA\t10_0010, unknown, gene found by Glimmer\nrna-ECU10_0155\ttRNA found by tRNAscan-SE\n');
  assert.equal(text(r, 'comments', 'GenBank_gene'), 'ECU10_0010\tgene note\n');
});

test('aliases take protein_id per transcript; dbxref_synonym takes gene_synonym per gene', () => {
  const r = extract(...codingGene('ECU10_0010', { gene: ';gene_synonym=ecuA,ecu-a', cds: ';product=p;protein_id=CAD25721.2' }));
  assert.equal(text(r, 'aliases', 'gbProteinId'), 'ECU10_0010_mRNA\tCAD25721.2\n');
  assert.equal(text(r, 'dbxref_synonym', 'GenBank'), 'ECU10_0010\tecu-a\nECU10_0010\tecuA\n');
});

test('a dataset with no rows is left out and named in one emptyClass info finding', () => {
  const r = extract(...codingGene('ECU10_0010', { cds: ';product=p' }));
  assert.deepEqual(r.datasets.map((d) => `${d.datasetClass}/${d.name}`), ['productNames/GenBank']);
  assert.deepEqual(checks(r), [['info', 'emptyClass', 5,
    ['geneName/GenBank', 'comments/GenBank_transcript', 'comments/GenBank_gene', 'aliases/gbProteinId', 'dbxref_synonym/GenBank']]]);
});
