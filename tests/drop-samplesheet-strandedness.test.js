import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { planMigration, applyMigration } from '../bin/dropSamplesheetStrandednessColumn.js';

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
  const root = tree(t, { 'Proposals/P1/curated/abc1/samplesheet.csv': 'sample,fastq_1,fastq_2,strandedness\nA,SRR1,,stranded\nB,SRR2,,stranded\n' });
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
  const root = tree(t, { [rel]: 'sample,fastq_1,fastq_2,strandedness\nA,SRR1,,stranded\nB,a.fq,b.fq,unstranded\n' });
  applyMigration(root, planMigration(root));
  assert.equal(readFileSync(join(root, rel), 'utf-8'), 'sample,fastq_1,fastq_2\nA,SRR1,\nB,a.fq,b.fq\n');
});

test('applyMigration refuses to run when any file was refused', (t) => {
  const root = tree(t, { 'Proposals/P2/curated/b/samplesheet.csv': 'x,y\n' });
  assert.throws(() => applyMigration(root, planMigration(root)), /Refusing to migrate/);
});
