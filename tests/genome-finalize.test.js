import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { runBuild } from '../shared/scripts/genome/commands/build.js';
import { runFinalize } from '../shared/scripts/genome/commands/finalize.js';
import { sha256 } from '../shared/scripts/genome/workdir.js';
import {
  CM, FAKE_PREPROCESS, fakeApiCommonData, FIXED_NOW, KZ, perlMissing, reportText, surveyedWorkDir, tempDir,
  TINY_FASTA, TINY_NORMALIZED, TINY_RECIPE, writeRecipe
} from './genome-helpers.js';

const read = (workDir, path) => readFileSync(join(workDir, path), 'utf-8');
const withoutComments = (text) => text.split('\n').filter((l) => !l.startsWith('#')).join('\n');

async function built(options, recipe) {
  const ctx = await surveyedWorkDir(options);
  writeRecipe(ctx.workDir, recipe);
  await runBuild({ ...ctx, now: FIXED_NOW });
  return ctx;
}

test('finalize runs preprocessGFF3 per partition and writes genome-build.json', { skip: perlMissing }, async () => {
  const { workDir, apiCommonData } = await built();
  const record = await runFinalize({ workDir, apiCommonData, now: FIXED_NOW });
  assert.equal(read(workDir, 'final/primary_chromosome/genome.gff'), withoutComments(read(workDir, 'build/primary_chromosome/genome.gff3')));
  assert.equal(read(workDir, 'final/primary_chromosome/genome.fasta'), read(workDir, 'build/primary_chromosome/genome.fasta'));
  assert.equal(read(workDir, 'final/primary_chromosome/chromosomeMap.txt'), 'CM000001.1\tchr1\t1\n');
  assert.equal(existsSync(join(workDir, 'final/secondary_supercontig/chromosomeMap.txt')), false);
  assert.ok(existsSync(join(workDir, 'final/secondary_supercontig/genome.gff')));
  assert.equal(existsSync(join(workDir, 'final.tmp')), false);
  assert.equal(record.apiCommonData.commit, execFileSync('git', ['-C', apiCommonData, 'rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim());
  assert.equal(record.apiCommonData.dirty, false);
  assert.equal(record.apiCommonData.preprocessGFF3.sha256, sha256(FAKE_PREPROCESS));
  assert.equal(record.normalized.sha256, sha256(TINY_NORMALIZED));
  assert.equal(record.finalizedAt, FIXED_NOW());
  assert.equal(record.builtAt, FIXED_NOW());
  assert.deepEqual(JSON.parse(read(workDir, 'genome-build.json')), record);
});

test('--preprocessGFF3 runs a patched copy and records its sha256', { skip: perlMissing }, async () => {
  const { workDir, apiCommonData } = await built();
  const patched = join(tempDir('patched-'), 'preprocessGFF3');
  writeFileSync(patched, `${FAKE_PREPROCESS}# patched\n`);
  const record = await runFinalize({ workDir, apiCommonData, preprocessGFF3: patched, now: FIXED_NOW });
  assert.equal(record.apiCommonData.preprocessGFF3.sha256, sha256(`${FAKE_PREPROCESS}# patched\n`));
});

test('finalize records an ApiCommonData checkout with uncommitted changes as dirty', { skip: perlMissing }, async () => {
  const { workDir, apiCommonData } = await built();
  appendFileSync(join(apiCommonData, 'Load/bin/preprocessGFF3'), '# local edit\n');
  const record = await runFinalize({ workDir, apiCommonData, now: FIXED_NOW });
  assert.equal(record.apiCommonData.dirty, true);
});

test('finalize names the Bio::SeqIO fix when preprocessGFF3 does not compile', { skip: perlMissing }, async () => {
  const { workDir } = await built();
  const broken = fakeApiCommonData({ script: `use Nonexistent::ModuleForThisTest;\n${FAKE_PREPROCESS}` });
  await assert.rejects(runFinalize({ workDir, apiCommonData: broken }),
    (e) => /preprocessGFF3$/.test(e.file) && /^does not compile:\n/.test(e.problem) && /`use Bio::SeqIO;`/.test(e.next));
});

test('a partition with no features gets its FASTA and no GFF', { skip: perlMissing }, async () => {
  const report = reportText([
    ['chr1', 'assembled-molecule', 'Chromosome', CM], ['scaffold2', 'unplaced-scaffold', 'na', KZ], ['MT', 'assembled-molecule', 'Mitochondrion', 'CM000003.1']
  ]);
  const { workDir, apiCommonData } = await built({ fasta: `${TINY_FASTA}>CM000003.1 mitochondrion\nACGTACGT\n`, report });
  const record = await runFinalize({ workDir, apiCommonData, now: FIXED_NOW });
  const { files, ...last } = record.partitions.at(-1);
  assert.deepEqual(last, { role: 'organelle', soTerm: 'mitochondrial_chromosome', organelle: 'mitochondrion', sequenceCount: 1, dir: 'final/organelle_mitochondrion', featureCount: 0 });
  assert.equal(read(workDir, 'final/organelle_mitochondrion/genome.fasta'), '>CM000003.1 mitochondrion\nACGTACGT\n');
  assert.equal(existsSync(join(workDir, 'final/organelle_mitochondrion/genome.gff')), false);
});

test('finalize refuses a normalized GFF that drifted from build.json, and needs a build', async () => {
  await assert.rejects(runFinalize({ workDir: tempDir('empty-'), apiCommonData: '/nowhere' }), /finalize: .*build\.json: is missing\nNext: run build first/);
  const { workDir, apiCommonData } = await built();
  appendFileSync(join(workDir, 'build/normalized.gff3'), '# edited\n');
  await assert.rejects(runFinalize({ workDir, apiCommonData }), /normalized\.gff3: does not match build\/build\.json\nNext: run build again/);
});

const stale = (file) => new RegExp(`finalize: .*${file}: changed since build\\nNext: run build again`);

test('finalize refuses a build that is stale against recipe.json', async () => {
  const { workDir, apiCommonData } = await built();
  writeRecipe(workDir, { ...TINY_RECIPE, ids: 'ids.tsv' });
  await assert.rejects(runFinalize({ workDir, apiCommonData }), stale('recipe\\.json'));
});

test('finalize refuses a build whose ids.tsv or partitions.tsv changed or was removed', async () => {
  const recipe = { ...TINY_RECIPE, ids: 'ids.tsv', partitions: 'partitions.tsv' };
  const ctx = await surveyedWorkDir();
  writeFileSync(join(ctx.workDir, 'ids.tsv'), 'level\told\tnew\n');
  writeFileSync(join(ctx.workDir, 'partitions.tsv'), 'sequence\trole\tsoTerm\torganelle\n');
  writeRecipe(ctx.workDir, recipe);
  await runBuild({ ...ctx, now: FIXED_NOW });
  appendFileSync(join(ctx.workDir, 'ids.tsv'), '\n');
  await assert.rejects(runFinalize(ctx), stale('ids\\.tsv'));
  writeFileSync(join(ctx.workDir, 'ids.tsv'), 'level\told\tnew\n');
  appendFileSync(join(ctx.workDir, 'partitions.tsv'), '\n');
  await assert.rejects(runFinalize(ctx), stale('partitions\\.tsv'));
});

test('finalize refuses a build whose recipe.json, ids.tsv or partitions.tsv was deleted', async () => {
  const recipe = { ...TINY_RECIPE, ids: 'ids.tsv', partitions: 'partitions.tsv' };
  const ctx = await surveyedWorkDir();
  writeFileSync(join(ctx.workDir, 'ids.tsv'), 'level\told\tnew\n');
  writeFileSync(join(ctx.workDir, 'partitions.tsv'), 'sequence\trole\tsoTerm\torganelle\n');
  writeRecipe(ctx.workDir, recipe);
  await runBuild({ ...ctx, now: FIXED_NOW });
  for (const [file, pattern] of [['ids.tsv', 'ids\\.tsv'], ['partitions.tsv', 'partitions\\.tsv'], ['recipe.json', 'recipe\\.json']]) {
    const path = join(ctx.workDir, file);
    const text = readFileSync(path);
    rmSync(path);
    await assert.rejects(runFinalize(ctx), stale(pattern));
    writeFileSync(path, text);
  }
});

test('finalize refuses a build.json from before per-partition checksums', async () => {
  const { workDir, apiCommonData } = await built();
  const path = join(workDir, 'build/build.json');
  const record = JSON.parse(readFileSync(path, 'utf-8'));
  for (const part of record.partitions) delete part.files;
  writeFileSync(path, JSON.stringify(record));
  await assert.rejects(runFinalize({ workDir, apiCommonData }), /finalize: .*build\.json: was written by an older build\nNext: run build again/);
  assert.equal(existsSync(join(workDir, 'final.tmp')), false);
});

test('finalize refuses a build/ partition file that changed since build', async () => {
  const { workDir, apiCommonData } = await built();
  appendFileSync(join(workDir, 'build/primary_chromosome/genome.fasta'), 'ACGT\n');
  await assert.rejects(runFinalize({ workDir, apiCommonData }), stale('primary_chromosome/genome\\.fasta'));
  rmSync(join(workDir, 'build/primary_chromosome/genome.fasta'));
  await assert.rejects(runFinalize({ workDir, apiCommonData }), stale('primary_chromosome/genome\\.fasta'));
});

test('a finalize that fails midway leaves the previous final/ and genome-build.json alone', { skip: perlMissing }, async () => {
  const { workDir, apiCommonData } = await built();
  await runFinalize({ workDir, apiCommonData, now: FIXED_NOW });
  const before = read(workDir, 'genome-build.json');
  const dying = fakeApiCommonData({ script: `${FAKE_PREPROCESS}die "boom" if $in =~ /secondary/;\n` });
  await assert.rejects(runFinalize({ workDir, apiCommonData: dying }), /finalize: [^\n]*secondary_supercontig\/genome\.gff3: preprocessGFF3 failed: [^\n]*\nNext:/);
  assert.equal(existsSync(join(workDir, 'final.old')), false);
  assert.equal(existsSync(join(workDir, 'final.tmp')), false);
  assert.equal(read(workDir, 'genome-build.json'), before);
  assert.ok(existsSync(join(workDir, 'final/secondary_supercontig/genome.gff')));
});
