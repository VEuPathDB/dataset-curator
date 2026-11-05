import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import {
  FUNCTION_DIR, FUNCTIONAL_SCHEMA_VERSION, functionalPaths, newFunctionalRecord, readFunctionalRecord
} from '../shared/scripts/genome/functional/record.js';
import { GENERATOR } from '../shared/scripts/genome/record.js';
import { PipelineError, writeJsonAtomic } from '../shared/scripts/genome/workdir.js';
import { tempDir } from './genome-helpers.js';

const PROPS = { prefixes: ['GeneID'], url: 'https://www.ncbi.nlm.nih.gov/gene/?term=EXTERNAL_ID_HERE', target: 'NAFeature', viewName: 'GeneFeature' };
const DATASET = {
  datasetClass: 'dbxref_simple', name: 'geneid_from_annotation', file: 'mapping.txt', level: 'gene', format: null, sha256: 'abc', props: PROPS,
  rows: [['G1', '1001'], ['G1', '1002'], ['G2', '1001']], text: 'G1\t1001\nG1\t1002\nG2\t1001\n'
};

test('newFunctionalRecord lists each dataset with its file, row count, digest and distinct IDs', () => {
  assert.equal(FUNCTIONAL_SCHEMA_VERSION, 1);
  assert.deepEqual(newFunctionalRecord({ genomeBuildSha256: 'gb', source: 'GenBank', datasets: [DATASET], findings: [] }), {
    schemaVersion: 1,
    generator: { ...GENERATOR },
    genomeBuild: { sha256: 'gb' },
    source: 'GenBank',
    datasets: [{
      datasetClass: 'dbxref_simple', name: 'geneid_from_annotation', file: 'final/function/dbxref_simple/geneid_from_annotation/mapping.txt',
      rows: 3, sha256: 'abc', ids: { level: 'gene', count: 2 }, props: PROPS
    }],
    findings: []
  });
});

test('functionalPaths puts the files under final/function and the record beside genome-build.json', () => {
  assert.equal(FUNCTION_DIR, 'final/function');
  assert.deepEqual(functionalPaths('/w'), {
    functionDir: join('/w', 'final/function'), stagedDir: join('/w', 'final/function.tmp'), functionalJson: join('/w', 'functional.json')
  });
});

test('readFunctionalRecord returns the record and refuses a missing, other-version or incomplete one', () => {
  const workDir = tempDir('functional-record-');
  const path = functionalPaths(workDir).functionalJson;
  assert.throws(() => readFunctionalRecord(workDir, 'verify'),
    (e) => e instanceof PipelineError && e.command === 'verify' && e.problem === 'is missing' && e.next === 'run functional');
  const record = newFunctionalRecord({ genomeBuildSha256: 'gb', source: 'GenBank', datasets: [DATASET], findings: [] });
  writeJsonAtomic(path, record);
  assert.deepEqual(readFunctionalRecord(workDir, 'verify'), record);
  writeJsonAtomic(path, { ...record, schemaVersion: 2 });
  assert.throws(() => readFunctionalRecord(workDir, 'verify'), /has schemaVersion 2, not 1\nNext: run functional again/);
  writeJsonAtomic(path, { ...record, datasets: undefined });
  assert.throws(() => readFunctionalRecord(workDir, 'verify'), /is incomplete: it needs genomeBuild\.sha256, source, datasets and findings/);
});
