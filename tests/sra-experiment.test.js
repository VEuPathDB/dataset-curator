import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, cpSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { sraExperimentType } from '../shared/scripts/dataset-types/_sra-experiment.js';
import * as dnaseq from '../shared/scripts/dataset-types/dnaseq.js';

const fixtures = new URL('./fixtures/', import.meta.url).pathname;
const SHARED = ['derivedCuratedFiles', 'presenterNames', 'normalizeCurated', 'deriveArtifacts', 'checkCurated', 'assertCuratedAgree', 'renderArtifacts', 'corpusFiles', 'stagingProblems'];

test('the factory returns every shared export, and dnaseq exports them', () => {
  const shared = sraExperimentType({ type: 't', datasetClass: 'c', datasetNameFor: (o, n) => `${o}_${n}` });
  assert.deepEqual(Object.keys(shared).sort(), [...SHARED].sort());
  for (const name of SHARED) assert.equal(typeof dnaseq[name], typeof shared[name], name);
});

test('extraColumns, stfAnnotations and extraChecks hook into the samplesheet and the agreement check', (t) => {
  const tmp = mkdtempSync(join(tmpdir(), 'sra-experiment-'));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const dir = join(tmp, 'PRJNA000010');
  cpSync(join(fixtures, 'proposals', 'PRJNA000010'), dir, { recursive: true, filter: (p) => !/expected/.test(p) });
  const type = sraExperimentType({
    type: 't', datasetClass: 'dnaseqExperiment', datasetNameFor: (o, n) => `${o}_${n}`,
    extraColumns: ['tag'],
    stfAnnotations: (a) => ({ ...a, samples: a.samples.map((s) => ({ ...s, tag: 'x' })) }),
    extraChecks: () => ['extra-check']
  });
  type.normalizeCurated(dir);
  const file = join(dir, 'curated', 'PRJNA000010_sample_annotations.json');
  const annotations = JSON.parse(readFileSync(file, 'utf-8'));
  annotations.samples[0].tag = 'x';
  writeFileSync(file, JSON.stringify(annotations, null, 2) + '\n');
  const artifacts = type.deriveArtifacts(dir);
  for (const [f, text] of Object.entries(artifacts)) {
    mkdirSync(dirname(join(dir, 'curated', f)), { recursive: true });
    writeFileSync(join(dir, 'curated', f), text);
  }
  const lines = Object.entries(artifacts).find(([f]) => f.endsWith('samplesheet.csv'))[1].trim().split('\n');
  assert.equal(lines[0], 'sample,fastq_1,fastq_2,tag');
  const tagged = lines.slice(1).filter((l) => l.startsWith(`${annotations.samples[0].sampleId},`));
  assert.ok(tagged.length > 0 && tagged.every((l) => l.endsWith(',x')));
  assert.ok(lines.slice(1).filter((l) => !tagged.includes(l)).every((l) => l.endsWith(',')));
  assert.deepEqual(type.checkCurated(dir), ['extra-check']);
});
