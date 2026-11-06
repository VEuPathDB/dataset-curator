import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { readPreprocessed, preprocessedProblems } from '../shared/scripts/dataset-types/genome-assembly/preprocess.js';
import { genomeWorkArea, editJson, ACCESSION, FETCH_URLS } from './genome-work-area.js';

const shaOf = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const RERUN_TRIAL = 'the data loader runs genome-pipeline.js trial --undo, then trial';

test('readPreprocessed reads the four records and the sha256 of the three a delivery depends on', () => {
  const workArea = genomeWorkArea();
  const records = readPreprocessed(workArea);
  assert.equal(records.genomeBuild.accession, ACCESSION);
  assert.equal(records.trial.result, 'passed');
  assert.equal(records.functional.datasets.length, 4);
  assert.equal(records.fetch.files.gff.url, FETCH_URLS.gff);
  assert.deepEqual(records.sha256, {
    genomeBuild: shaOf(join(workArea, 'genome-build.json')),
    trial: shaOf(join(workArea, 'trial/trial.json')),
    functional: shaOf(join(workArea, 'functional.json'))
  });
});

test('readPreprocessed refuses a missing record, naming the file and the step that writes it', () => {
  for (const [file, message] of [
    ['genome-build.json', /genome-build\.json: is missing\nNext: run finalize first/],
    ['trial/trial.json', /trial\/trial\.json: is missing\nNext: the data loader runs genome-pipeline\.js trial/],
    ['functional.json', /functional\.json: is missing\nNext: run functional/],
    ['fetch/fetch.json', /fetch\/fetch\.json: is missing\nNext: run genome-pipeline\.js fetch/]
  ]) {
    const workArea = genomeWorkArea();
    rmSync(join(workArea, file));
    assert.throws(() => readPreprocessed(workArea), message, file);
  }
});

test('readPreprocessed refuses an unknown schema version and an incomplete fetch record', () => {
  for (const [file, message] of [
    ['genome-build.json', /has schemaVersion 9, not 1/],
    ['trial/trial.json', /has schemaVersion 9, not 2/],
    ['functional.json', /has schemaVersion 9, not 1/]
  ]) {
    const workArea = genomeWorkArea();
    editJson(join(workArea, file), (r) => ({ ...r, schemaVersion: 9 }));
    assert.throws(() => readPreprocessed(workArea), message, file);
  }
  const workArea = genomeWorkArea();
  editJson(join(workArea, 'fetch/fetch.json'), (r) => ({ ...r, files: { gff: r.files.gff } }));
  assert.throws(() => readPreprocessed(workArea), /fetch\.json: is incomplete: it needs files\.gff, files\.fasta and files\.report with their url/);
});

const problemsOf = (workArea) => preprocessedProblems(readPreprocessed(workArea), workArea);

test('a fresh work area, or one whose trial rows were kept, has no problems', () => {
  assert.deepEqual(problemsOf(genomeWorkArea()), []);
  assert.deepEqual(problemsOf(genomeWorkArea({ trial: { undone: false, kept: true } })), []);
});

test('a trial that did not pass, or ran on another build, is a problem', () => {
  assert.deepEqual(problemsOf(genomeWorkArea({ trial: { result: 'failed' } })), [`trial/trial.json: the trial result is "failed", not "passed"; ${RERUN_TRIAL}`]);
  assert.deepEqual(problemsOf(genomeWorkArea({ trial: { genomeBuild: { sha256: 'old' } } })), [`trial/trial.json is for an older genome-build.json; ${RERUN_TRIAL}`]);
  assert.deepEqual(problemsOf(genomeWorkArea({ trial: { undone: false } })), ['trial/trial.json: the trial rows are neither undone nor kept; the data loader runs genome-pipeline.js trial --undo']);
});

test('a final file the trial did not load, or a transcriptInfoAndIds it did not produce, is a problem', () => {
  const edited = genomeWorkArea();
  appendFileSync(join(edited, 'final/primary_chromosome/genome.gff'), '#\n');
  appendFileSync(join(edited, 'final/secondary_contig/transcriptInfoAndIds'), 'x\n');
  assert.deepEqual(problemsOf(edited), [
    `final/primary_chromosome/genome.gff is not the file the trial loaded; ${RERUN_TRIAL}`,
    `final/secondary_contig/transcriptInfoAndIds is not the file the trial produced; ${RERUN_TRIAL}`
  ]);
  assert.deepEqual(problemsOf(genomeWorkArea({ trial: { outputs: {} } })), [
    `trial/trial.json records no transcriptInfoAndIds for primary_chromosome; ${RERUN_TRIAL}`,
    `trial/trial.json records no transcriptInfoAndIds for secondary_contig; ${RERUN_TRIAL}`
  ]);
});

test('a stale functional.json is a problem', () => {
  const edited = genomeWorkArea();
  appendFileSync(join(edited, 'final/function/productNames/GenBank/products.txt'), 'x\ty\t1\n');
  assert.deepEqual(problemsOf(edited), ['final/function/productNames/GenBank/products.txt does not match functional.json; run genome-pipeline.js functional again']);
  const older = genomeWorkArea();
  editJson(join(older, 'functional.json'), (r) => ({ ...r, genomeBuild: { sha256: 'old' } }));
  assert.deepEqual(problemsOf(older), ['functional.json is for an older genome-build.json; run genome-pipeline.js functional again']);
});
