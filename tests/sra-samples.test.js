import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as sra from '../shared/scripts/dataset-types/_sra-samples.js';
import * as rnaseq from '../shared/scripts/dataset-types/bulk-rnaseq.js';

const runs = [
  { run_accession: 'SRR1', sample_accession: 'SAMN1', sample_title: 'WT rep1' },
  { run_accession: 'SRR2', sample_accession: 'SAMN1', sample_title: 'WT rep1' },
  { run_accession: 'SRR3', sample_accession: 'SAMN2', sample_title: 'WT rep2' }
];

test('normalizeSamples lives in _sra-samples and bulk-rnaseq re-exports the same function', () => {
  assert.equal(rnaseq.normalizeSamples, sra.normalizeSamples);
});

test('runs of one BioSample are one sample; BioSamples with one title share a label', () => {
  const { samples } = sra.normalizeSamples({ samples: [{ runs: ['SRR1', 'SRR2'] }, { runs: ['SRR3'] }] }, runs);
  assert.deepEqual(samples.map((s) => [s.sampleId, s.label, s.biosample]), [['WT_rep1', 'WT', 'SAMN1'], ['WT_rep2', 'WT', 'SAMN2']]);
});

test('samplesheet has one row per run or files entry, sorted, with no strandedness column', () => {
  const text = sra.samplesheet([
    { sampleId: 'B', runs: ['SRR3'] },
    { sampleId: 'A', runs: ['SRR2', 'SRR1'] },
    { sampleId: 'C', files: [{ fastq_1: 'c_1.fq.gz', fastq_2: 'c_2.fq.gz' }] }
  ]);
  assert.equal(text, 'sample,fastq_1,fastq_2\nA,SRR1,\nA,SRR2,\nB,SRR3,\nC,c_1.fq.gz,c_2.fq.gz\n');
});

test('parseSamplesheet returns rows with line numbers and refuses the old 4-column header', () => {
  assert.deepEqual(sra.parseSamplesheet('sample,fastq_1,fastq_2\nA,SRR1,\n\n'), {
    errors: [], rows: [{ line: 2, sample: 'A', fastq1: 'SRR1', fastq2: '' }]
  });
  const old = sra.parseSamplesheet('sample,fastq_1,fastq_2,strandedness\nA,SRR1,,stranded\n');
  assert.equal(old.errors[0], 'samplesheet.csv header must be sample,fastq_1,fastq_2');
});

const H = 'sample,fastq_1,fastq_2\n';

test('parseSamplesheet errors on rows with extra or missing cells and keeps the row', () => {
  const extra = sra.parseSamplesheet(`${H}A,SRR1,,stranded\n`);
  assert.deepEqual(extra.errors, ['samplesheet.csv line 2 has 4 columns; expected 3']);
  assert.equal(extra.rows.length, 1);
  assert.deepEqual(sra.parseSamplesheet(`${H}A,SRR1\n`).errors, ['samplesheet.csv line 2 has 2 columns; expected 3']);
});

test('parseSamplesheet errors on an empty sample or empty fastq_1', () => {
  assert.deepEqual(sra.parseSamplesheet(`${H},SRR1,\n`).errors, ['samplesheet.csv line 2 has no sample']);
  assert.deepEqual(sra.parseSamplesheet(`${H}A,,\n`).errors, ['samplesheet.csv line 2 (A) has no fastq_1']);
});

const tsvOf = (...ids) => ['sample.ID \\\\ Descriptors\tlabel', ...ids.map((id) => `${id}\tx`)].join('\n') + '\n';
const sheetOf = (...ids) => sra.samplesheet(ids.map((sampleId, i) => ({ sampleId, runs: [`SRR${i}`] })));

test('checkSamplesAgree passes when samplesheet, STF and annotations hold the same ids', () => {
  assert.deepEqual(sra.checkSamplesAgree({ samplesheet: sheetOf('A', 'B'), tsv: tsvOf('B', 'A'), sampleIds: ['A', 'B'], versus: 'annotations.json' }), []);
});

test('checkSamplesAgree names an id found only in the samplesheet, only in the STF, or only in the annotations', () => {
  const errors = sra.checkSamplesAgree({ samplesheet: sheetOf('A', 'S'), tsv: tsvOf('A', 'T'), sampleIds: ['A', 'S', 'N'], versus: 'annotations.json' });
  assert.deepEqual(errors, [
    'samplesheet.csv and entity-sample.tsv disagree: only in samplesheet.csv: S; only in entity-sample.tsv: T',
    'samplesheet.csv and annotations.json disagree: only in samplesheet.csv: none; only in annotations.json: N'
  ]);
});

test('checkSamplesAgree treats ids differing only in case as different', () => {
  const errors = sra.checkSamplesAgree({ samplesheet: sheetOf('abc'), tsv: tsvOf('ABC'), sampleIds: ['abc'], versus: 'annotations.json' });
  assert.deepEqual(errors, ['samplesheet.csv and entity-sample.tsv disagree: only in samplesheet.csv: abc; only in entity-sample.tsv: ABC']);
});
