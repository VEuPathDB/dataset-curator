import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvToRuns } from '../shared/scripts/lib/sra-runinfo.js';

test('csvToRuns maps the experiment accession, library name, submission and release date', () => {
  const [run] = csvToRuns([{
    Run: 'SRR12005499',
    BioSample: 'SAMN15226360',
    Experiment: 'SRX8538680',
    LibraryName: 'S1147Nr3',
    Submission: 'SRA1086590',
    ReleaseDate: '2021-07-04 00:09:45',
    Foo: 'x'
  }]);
  assert.equal(run.experiment_accession, 'SRX8538680');
  assert.equal(run.library_name, 'S1147Nr3');
  assert.equal(run.submission_accession, 'SRA1086590');
  assert.equal(run.first_public, '2021-07-04');
  assert.equal(run.experiment_title, '');
  assert.deepEqual(run.sample_attributes, { foo: 'x' });
});

test('csvToRuns maps Run Selector SraRunTable headers and keeps them out of sample_attributes', () => {
  const [run] = csvToRuns([{
    Run: 'SRR12005499',
    BioSample: 'SAMN15226360',
    Experiment: 'SRX8538680',
    'Library Name': 'S1147Nr3',
    Instrument: 'Illumina HiSeq 2500',
    'Assay Type': 'RNA-Seq',
    Bases: '1234567',
    Bytes: '999',
    ReleaseDate: '2021-07-04T00:09:45Z',
    'DATASTORE filetype': 'fastq,sra',
    'DATASTORE provider': 'gs,ncbi,s3',
    'DATASTORE region': 'gs.us-east1,ncbi.public,s3.us-east-1',
    create_date: '2020-06-12T10:00:00Z',
    version: '1',
    strain: 'SC5314'
  }]);
  assert.equal(run.library_name, 'S1147Nr3');
  assert.equal(run.instrument_model, 'Illumina HiSeq 2500');
  assert.equal(run.library_strategy, 'RNA-Seq');
  assert.equal(run.base_count, 1234567);
  assert.equal(run.first_public, '2021-07-04');
  assert.equal(run.submission_accession, '');
  assert.deepEqual(run.sample_attributes, { strain: 'SC5314' });
});
