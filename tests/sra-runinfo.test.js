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
