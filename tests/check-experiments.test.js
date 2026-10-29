import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve('shared/scripts/check-experiments.js');
const fixture = JSON.parse(readFileSync(resolve('tests/fixtures/sra-mixed-biosample.json'), 'utf-8'));

function run(metadata, args = ['PRJNA1']) {
  const cwd = mkdtempSync(join(tmpdir(), 'check-experiments-'));
  if (metadata) {
    mkdirSync(join(cwd, '.curation/tmp'), { recursive: true });
    writeFileSync(join(cwd, '.curation/tmp/PRJNA1_sra_metadata.json'), JSON.stringify(metadata));
  }
  return spawnSync('node', [SCRIPT, ...args], { cwd, encoding: 'utf-8' });
}

test('flags a BioSample spanning differing experiments, exit 0', () => {
  const r = run({ ...fixture, source: 'ENA+BioSample' });
  assert.equal(r.status, 0);
  assert.match(r.stderr, /SAMN15226360/);
  assert.match(r.stderr, /SRX8538680/);
  assert.match(r.stderr, /SRX24431285/);
  assert.match(r.stderr, /experiment_title\*/);
  assert.match(r.stderr, /library_name\*/);
  assert.doesNotMatch(r.stderr, /Warning/);
  const json = JSON.parse(r.stdout);
  assert.equal(json[0].biosample, 'SAMN15226360');
  assert.ok(json[0].differing.includes('library_name'));
});

test('reports nothing to flag when experiments agree', () => {
  const runs = fixture.runs.map((x) => ({ ...x, sample_accession: `S${x.run_accession}` }));
  const r = run({ ...fixture, source: 'ENA+BioSample', runs });
  assert.equal(r.status, 0);
  assert.match(r.stderr, /No BioSample spans differing SRA experiments/);
  assert.deepEqual(JSON.parse(r.stdout), []);
});

test('warns that manual_csv has no experiment titles', () => {
  const runs = fixture.runs.map((x) => ({ ...x, experiment_title: '' }));
  const r = run({ ...fixture, source: 'manual_csv', runs });
  assert.equal(r.status, 0);
  assert.match(r.stderr, /Warning: the manual CSV left experiment_title empty on every run, so it was not compared\n/);
});

test('manual_csv warning names every field empty on all runs, and only those', () => {
  const runs = fixture.runs.map((x) => ({ ...x, experiment_title: '', submission_accession: '' }));
  const r = run({ ...fixture, source: 'manual_csv', runs });
  assert.equal(r.status, 0);
  assert.match(r.stderr, /Warning: the manual CSV left experiment_title, submission_accession empty on every run, so they were not compared\n/);
});

test('manual_csv with every experiment field filled gives no warning', () => {
  const r = run({ ...fixture, source: 'manual_csv' });
  assert.equal(r.status, 0);
  assert.doesNotMatch(r.stderr, /Warning/);
});

test('missing argument exits 1 with usage', () => {
  const r = run(null, []);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Usage: node check-experiments.js/);
});

test('missing metadata file exits 1', () => {
  const r = run(null);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /fetch-sra-metadata.js PRJNA1/);
});

test('runs without experiment_accession exit 1', () => {
  const runs = fixture.runs.map(({ experiment_accession, ...rest }) => rest);
  const r = run({ ...fixture, runs });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /re-run fetch-sra-metadata.js/);
});
