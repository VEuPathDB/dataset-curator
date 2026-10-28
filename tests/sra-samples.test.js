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
