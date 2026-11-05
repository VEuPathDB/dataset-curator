import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proteinIdOf, resolveFeatures } from '../shared/scripts/genome/functional/ids.js';
import { parseGff } from '../shared/scripts/genome/gff.js';
import { CM, gffLine, gffText } from './genome-helpers.js';

const resolve = (...lines) => resolveFeatures(parseGff(gffText(...lines)));
const summary = (features) => features.map((f) => [f.kind, f.group.id, f.gene, f.transcript, ...(f.kind === 'rna' ? [f.hasCds] : [])]);

test('a CDS resolves to its mRNA and that mRNA\'s gene; its segments are one feature', () => {
  const { features, unresolved, codingTranscripts } = resolve(
    gffLine(CM, 'gene', 100, 900, '+', 'ID=ECU10_0010'),
    gffLine(CM, 'mRNA', 100, 900, '+', 'ID=ECU10_0010_mRNA;Parent=ECU10_0010'),
    gffLine(CM, 'exon', 100, 400, '+', 'ID=ECU10_0010_mRNA_exon1;Parent=ECU10_0010_mRNA'),
    gffLine(CM, 'CDS', 100, 400, '+', 'ID=CAD25721.2;Parent=ECU10_0010_mRNA'),
    gffLine(CM, 'CDS', 600, 900, '+', 'ID=CAD25721.2;Parent=ECU10_0010_mRNA')
  );
  assert.deepEqual(summary(features), [
    ['gene', 'ECU10_0010', 'ECU10_0010', null],
    ['rna', 'ECU10_0010_mRNA', 'ECU10_0010', 'ECU10_0010_mRNA', true],
    ['cds', 'CAD25721.2', 'ECU10_0010', 'ECU10_0010_mRNA']
  ]);
  assert.equal(features[2].group.lines.length, 2);
  assert.deepEqual(unresolved, []);
  assert.deepEqual(codingTranscripts, ['ECU10_0010_mRNA']);
});

test('an ncRNA without a CDS is a transcript of its gene, and a pseudogene is a gene', () => {
  const { features, codingTranscripts } = resolve(
    gffLine(CM, 'gene', 1000, 1072, '+', 'ID=gene_CM000001.1_1000_1072'),
    gffLine(CM, 'snRNA', 1000, 1072, '+', 'ID=rna_CM000001.1_1000_1072_snRNA;Parent=gene_CM000001.1_1000_1072;product=U4 snRNA'),
    gffLine(CM, 'pseudogene', 2000, 2300, '+', 'ID=PSG1'),
    gffLine(CM, 'pseudogenic_transcript', 2000, 2300, '+', 'ID=PSG1_t;Parent=PSG1')
  );
  assert.deepEqual(summary(features), [
    ['gene', 'gene_CM000001.1_1000_1072', 'gene_CM000001.1_1000_1072', null],
    ['rna', 'rna_CM000001.1_1000_1072_snRNA', 'gene_CM000001.1_1000_1072', 'rna_CM000001.1_1000_1072_snRNA', false],
    ['gene', 'PSG1', 'PSG1', null],
    ['rna', 'PSG1_t', 'PSG1', 'PSG1_t', false]
  ]);
  assert.deepEqual(codingTranscripts, []);
});

test('an RNA or CDS whose Parent chain reaches no gene is unresolved, labelled by ID or span', () => {
  const { features, unresolved, notLoaded } = resolve(
    gffLine(CM, 'gene', 1, 99, '+', 'ID=G1'),
    gffLine(CM, 'ncRNA', 100, 172, '+', 'ID=rna-orphan'),
    gffLine(CM, 'CDS', 200, 300, '+', 'ID=P2;Parent=missing_mRNA'),
    gffLine(CM, 'CDS', 10, 20, '+', 'Parent=missing_mRNA'),
    gffLine(CM, 'CDS', 50, 60, '+', 'ID=P3;Parent=G1')
  );
  assert.deepEqual(unresolved, ['rna-orphan', 'P2', 'CM000001.1:10..20', 'P3']);
  assert.deepEqual(features, []);
  assert.deepEqual(notLoaded, [{ id: 'G1', type: 'gene' }]);
});

test('a CDS under two transcripts belongs to each', () => {
  const { features, codingTranscripts } = resolve(
    gffLine(CM, 'gene', 1, 900, '+', 'ID=G1'),
    gffLine(CM, 'mRNA', 1, 900, '+', 'ID=T1;Parent=G1'),
    gffLine(CM, 'mRNA', 1, 900, '+', 'ID=T2;Parent=G1'),
    gffLine(CM, 'CDS', 1, 900, '+', 'ID=P1;Parent=T1,T2')
  );
  assert.deepEqual(summary(features).slice(3), [['cds', 'P1', 'G1', 'T1'], ['cds', 'P1', 'G1', 'T2']]);
  assert.deepEqual(codingTranscripts, ['T1', 'T2']);
});

test('a gene whose only child is a type ISF does not load emits nothing and is listed as not loaded', () => {
  const { features, unresolved, notLoaded } = resolve(
    gffLine(CM, 'gene', 1, 99, '+', 'ID=G2'),
    gffLine(CM, 'RNase_P_RNA', 1, 99, '+', 'ID=R2;Parent=G2'),
    gffLine(CM, 'gene', 200, 299, '+', 'ID=G3'),
    gffLine(CM, 'tRNA', 200, 299, '+', 'ID=R3;Parent=G3')
  );
  assert.deepEqual(summary(features), [['gene', 'G3', 'G3', null], ['rna', 'R3', 'G3', 'R3', false]]);
  assert.deepEqual(unresolved, []);
  assert.deepEqual(notLoaded, [{ id: 'G2', type: 'gene' }, { id: 'R2', type: 'RNase_P_RNA' }]);
});

test('a childless pseudogene and a standalone tRNA are loaded under the IDs ISF gives their transcripts', () => {
  const { features, unresolved, notLoaded } = resolve(
    gffLine(CM, 'gene', 1, 99, '+', 'ID=PSG2;Note=pseudogene'),
    gffLine(CM, 'gene', 200, 299, '+', 'ID=PSG3;pseudo=true'),
    gffLine(CM, 'tRNA', 400, 472, '+', 'ID=rna-T1;product=tRNA-Gly')
  );
  assert.deepEqual(summary(features), [
    ['gene', 'PSG2', 'PSG2', null], ['rna', 'PSG2', 'PSG2', 'PSG2.mRNA', false],
    ['gene', 'PSG3', 'PSG3', null], ['rna', 'PSG3', 'PSG3', 'PSG3.mRNA', false],
    ['gene', 'rna-T1', 'rna-T1', null], ['rna', 'rna-T1', 'rna-T1', 'rna-T1.tRNA', false]
  ]);
  assert.deepEqual(unresolved, []);
  assert.deepEqual(notLoaded, []);
});

test('Parent is the union over every line of a feature, for an RNA and for a CDS', () => {
  const { features, codingTranscripts, unresolved } = resolve(
    gffLine(CM, 'gene', 1, 900, '+', 'ID=G1'),
    gffLine(CM, 'mRNA', 1, 900, '+', 'ID=T1;Parent=G1'),
    gffLine(CM, 'mRNA', 1, 900, '+', 'ID=T2;Parent=G1'),
    gffLine(CM, 'CDS', 1, 400, '+', 'ID=P1;Parent=T1'),
    gffLine(CM, 'CDS', 500, 900, '+', 'ID=P1;Parent=T2')
  );
  assert.deepEqual(summary(features).slice(3), [['cds', 'P1', 'G1', 'T1'], ['cds', 'P1', 'G1', 'T2']]);
  assert.deepEqual(codingTranscripts, ['T1', 'T2']);
  assert.deepEqual(unresolved, []);
  assert.deepEqual(codingTranscripts.map(proteinIdOf), ['T1-p1', 'T2-p1']);
});

test('an RNA with more than one gene parent is unresolved with the reason', () => {
  const { features, unresolved } = resolve(
    gffLine(CM, 'gene', 1, 99, '+', 'ID=G1'),
    gffLine(CM, 'gene', 1, 99, '+', 'ID=G2'),
    gffLine(CM, 'mRNA', 1, 99, '+', 'ID=T1;Parent=G1,G2')
  );
  assert.deepEqual(unresolved, ['T1 (more than one gene parent)']);
  assert.deepEqual(summary(features), [['gene', 'G1', 'G1', null], ['gene', 'G2', 'G2', null]]);
});

test('proteinIdOf follows GusSkeletonMaker: the transcript ID and -p1', () => {
  assert.equal(proteinIdOf('ECU10_0010_mRNA'), 'ECU10_0010_mRNA-p1');
});
