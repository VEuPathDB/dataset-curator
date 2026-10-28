import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { planMigration, applyMigration } from '../bin/dropSamplesheetStrandednessColumn.js';

const STRANDED = '{"props":{"isStrandSpecific":"true"}}';
const UNSTRANDED = '{"props":{"isStrandSpecific":"false"}}';
const OLDH = 'sample,fastq_1,fastq_2,strandedness\n';
const SHEET = 'Proposals/P1/curated/abc1/samplesheet.csv';

function tree(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'migrate-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(root, rel, '..'), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
}

test('planMigration lists old-format samplesheets with before and after headers and row counts', (t) => {
  const root = tree(t, { [SHEET]: `${OLDH}A,SRR1,,stranded\nB,SRR2,,stranded\n`, 'Proposals/P1/curated/dataset.json': STRANDED });
  assert.deepEqual(planMigration(root), {
    refused: [],
    files: [{ path: 'Proposals/P1/curated/abc1/samplesheet.csv', before: 'sample,fastq_1,fastq_2,strandedness', after: 'sample,fastq_1,fastq_2', rows: 2 }]
  });
});

test('planMigration skips files already migrated and refuses any other header', (t) => {
  const root = tree(t, {
    'Proposals/P1/curated/a/samplesheet.csv': 'sample,fastq_1,fastq_2\nA,SRR1,\n',
    'Proposals/P2/curated/b/samplesheet.csv': 'sample,fastq_1,strandedness\nA,SRR1,stranded\n'
  });
  const plan = planMigration(root);
  assert.deepEqual(plan.files, []);
  assert.deepEqual(plan.refused, ['Proposals/P2/curated/b/samplesheet.csv: header "sample,fastq_1,strandedness"']);
});

test('applyMigration drops column 4 and keeps a trailing newline', (t) => {
  const rel = 'Proposals/P1/curated/abc1/samplesheet.csv';
  const root = tree(t, { [rel]: `${OLDH}A,SRR1,,stranded\nB,a.fq,b.fq,stranded\n`, 'Proposals/P1/curated/dataset.json': STRANDED });
  applyMigration(root, planMigration(root));
  assert.equal(readFileSync(join(root, rel), 'utf-8'), 'sample,fastq_1,fastq_2\nA,SRR1,\nB,a.fq,b.fq\n');
});

test('applyMigration refuses to run when any file was refused', (t) => {
  const root = tree(t, { 'Proposals/P2/curated/b/samplesheet.csv': 'x,y\n' });
  assert.throws(() => applyMigration(root, planMigration(root)), /Refusing to migrate/);
});

test('planMigration refuses a row whose strandedness disagrees with dataset.json', (t) => {
  const root = tree(t, { [SHEET]: `${OLDH}A,SRR1,,stranded\nB,SRR2,,unstranded\n`, 'Proposals/P1/curated/dataset.json': STRANDED });
  const plan = planMigration(root);
  assert.deepEqual(plan.files, []);
  assert.deepEqual(plan.refused, [`${SHEET} line 3: strandedness "unstranded" but dataset.json isStrandSpecific is true`]);
});

test('planMigration accepts unstranded rows when dataset.json says false', (t) => {
  const root = tree(t, { [SHEET]: `${OLDH}A,SRR1,,unstranded\n`, 'Proposals/P1/curated/dataset.json': UNSTRANDED });
  assert.equal(planMigration(root).files.length, 1);
});

test('planMigration refuses a row with the wrong cell count or an unknown strandedness', (t) => {
  const root = tree(t, { [SHEET]: `${OLDH}A,SRR1,\nB,SRR2,,reverse\n`, 'Proposals/P1/curated/dataset.json': STRANDED });
  assert.deepEqual(planMigration(root).refused, [
    `${SHEET} line 2: 3 columns; expected 4`,
    `${SHEET} line 3: strandedness "reverse" is neither stranded nor unstranded`
  ]);
});

test('planMigration refuses when dataset.json is missing or unreadable', (t) => {
  const missing = tree(t, { [SHEET]: `${OLDH}A,SRR1,,stranded\n` });
  assert.match(planMigration(missing).refused[0], new RegExp(`^${SHEET}: dataset.json`));
  const bad = tree(t, { [SHEET]: `${OLDH}A,SRR1,,stranded\n`, 'Proposals/P1/curated/dataset.json': '{nope' });
  assert.match(planMigration(bad).refused[0], new RegExp(`^${SHEET}: dataset.json`));
});

test('applyMigration writes LF output from CRLF input', (t) => {
  const root = tree(t, { [SHEET]: `${OLDH}A,SRR1,,stranded\n`.replace(/\n/g, '\r\n'), 'Proposals/P1/curated/dataset.json': STRANDED });
  applyMigration(root, planMigration(root));
  assert.equal(readFileSync(join(root, SHEET), 'utf-8'), 'sample,fastq_1,fastq_2\nA,SRR1,\n');
});

test('applyMigration adds a trailing newline when the input had none', (t) => {
  const root = tree(t, { [SHEET]: `${OLDH}A,SRR1,,stranded`, 'Proposals/P1/curated/dataset.json': STRANDED });
  applyMigration(root, planMigration(root));
  assert.equal(readFileSync(join(root, SHEET), 'utf-8'), 'sample,fastq_1,fastq_2\nA,SRR1,\n');
});
