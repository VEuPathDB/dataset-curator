import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runBuild } from '../shared/scripts/genome/commands/build.js';
import { MAP_PATH } from '../shared/scripts/genome/preprocess-gff3.js';
import { SCHEMA_VERSION } from '../shared/scripts/genome/record.js';
import { TRANSFORMS } from '../shared/scripts/genome/transforms/index.js';
import { PipelineError, sha256 } from '../shared/scripts/genome/workdir.js';
import {
  CM, FIXED_NOW, gffLine, KZ, reportText, surveyedWorkDir, TINY_COLLIDING_GFF, TINY_FASTA, TINY_GFF, TINY_IDS_DEFAULT, TINY_NORMALIZED, TINY_RECIPE, writeRecipe
} from './genome-helpers.js';

const read = (workDir, path) => readFileSync(join(workDir, path), 'utf-8');
const PACKAGE_VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8')).version;
const isBuildError = (e) => e instanceof PipelineError && e.command === 'build';

test('build writes the normalized GFF, partitions, ids.default.tsv and build/build.json', async () => {
  const { workDir, apiCommonData } = await surveyedWorkDir();
  writeRecipe(workDir);
  const record = await runBuild({ workDir, apiCommonData, now: FIXED_NOW });
  assert.equal(read(workDir, 'build/normalized.gff3'), TINY_NORMALIZED);
  assert.equal(read(workDir, 'ids.default.tsv'), TINY_IDS_DEFAULT);
  assert.deepEqual(record.transforms.map((t) => [t.name, t.changes]), [
    ['collapseSplitGenes', 1], ['addMrnaToGeneCds', 3], ['parentOrphanRnas', 1], ['addExonPerCds', 3], ['stripAttributes', 1]
  ]);
  assert.deepEqual(record.transforms[1].sample, ['TST_0010', 'TST_0020', 'TST_0040']);
  assert.deepEqual(record.idPolicy, { name: 'ncbiDefault', renamed: 7 });
  assert.equal(record.recipe.sha256, sha256(JSON.stringify(TINY_RECIPE)));
  assert.equal(record.normalized.sha256, sha256(TINY_NORMALIZED));
  assert.deepEqual(record.warnings, []);
  assert.equal(record.ids, null);
  assert.equal(record.builtAt, FIXED_NOW());
  assert.equal(record.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(record.generator, { name: 'dataset-curator genome-pipeline', version: PACKAGE_VERSION });
  assert.equal(record.source, 'ncbi');
  assert.deepEqual(record.apiCommonData, {
    commit: execFileSync('git', ['-C', apiCommonData, 'rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim(),
    dirty: false,
    isfMap: { path: MAP_PATH, sha256: sha256(readFileSync(join(apiCommonData, MAP_PATH))) }
  });
  const digest = /^[0-9a-f]{64}$/;
  for (const part of record.partitions) {
    assert.match(part.buildFiles.gff3, digest);
    assert.match(part.buildFiles.fasta, digest);
  }
  assert.match(record.partitions[0].buildFiles.chromosomeMap, digest);
  assert.equal(record.partitions[1].buildFiles.chromosomeMap, null);
  assert.equal(record.partitions[0].buildFiles.gff3, sha256(read(workDir, 'build/primary_chromosome/genome.gff3')));
  assert.deepEqual(record.partitions.map(({ buildFiles, ...rest }) => rest), [
    {
      role: 'primary', soTerm: 'chromosome', organelle: null, sequenceCount: 1, dir: 'final/primary_chromosome', featureCount: 4, gffLines: 19,
      final: { gff: 'genome.gff', fasta: 'genome.fasta', chromosomeMap: 'chromosomeMap.txt' }
    },
    {
      role: 'secondary', soTerm: 'supercontig', organelle: null, sequenceCount: 1, dir: 'final/secondary_supercontig', featureCount: 1, gffLines: 4,
      final: { gff: 'genome.gff', fasta: 'genome.fasta', chromosomeMap: null }
    }
  ]);
  assert.deepEqual(record.findings.map((f) => [f.check, f.count]), [['unhandledType', 1], ['partitionCounts', 2]]);
  assert.equal(record.findings.some((f) => f.severity === 'error'), false);
  assert.equal(existsSync(join(workDir, 'build.tmp')), false);
  assert.equal(read(workDir, 'build/primary_chromosome/chromosomeMap.txt'), 'CM000001.1\tchr1\t1\n');
  assert.equal(existsSync(join(workDir, 'build/secondary_supercontig/chromosomeMap.txt')), false);
  assert.equal(read(workDir, 'build/secondary_supercontig/genome.fasta'), `>KZ000002.1 Testus tinyus scaffold2\n${'TTGA'.repeat(15)}\n`);
  assert.equal(read(workDir, 'build/secondary_supercontig/genome.gff3'),
    ['##gff-version 3', ...TINY_NORMALIZED.split('\n').filter((l) => l.startsWith('##sequence-region KZ') || l.startsWith('KZ000002.1')), '###', ''].join('\n'));
  assert.deepEqual(JSON.parse(read(workDir, 'build/build.json')), record);
  assert.deepEqual(readdirSync(workDir).filter((n) => n.endsWith('.part')), []);
});

test('a transform that changes nothing is a warning in the record', async () => {
  const { workDir, apiCommonData } = await surveyedWorkDir();
  writeRecipe(workDir, { ...TINY_RECIPE, transforms: [...TINY_RECIPE.transforms, { name: 'stripAttributes', args: { type: 'gap', keys: ['gbkey'] } }] });
  const record = await runBuild({ workDir, apiCommonData, now: FIXED_NOW });
  assert.deepEqual(record.warnings, ['stripAttributes changed nothing; the recipe declares a transform this genome does not need']);
});

test('build refuses while errors remain and writes no build/', async () => {
  const { workDir, apiCommonData } = await surveyedWorkDir();
  writeRecipe(workDir, { idPolicy: 'ncbiDefault', transforms: [{ name: 'collapseSplitGenes' }, { name: 'parentOrphanRnas' }] });
  await assert.rejects(runBuild({ workDir, apiCommonData }), (e) =>
    isBuildError(e) && /the result still has errors:\n.*error structure\/geneCdsNoRna \(3\)/.test(e.problem) && /then run build again/.test(e.next));
  assert.equal(existsSync(join(workDir, 'build')), false);
});

test('build needs a survey of the same inputs and a valid recipe', async () => {
  const { workDir, apiCommonData } = await surveyedWorkDir();
  await assert.rejects(runBuild({ workDir, apiCommonData }), /recipe\.json: is missing\nNext: copy suggestedRecipe from survey\.json/);
  writeRecipe(workDir, { idPolicy: 'veupathdb', transforms: [{ name: 'renameEverything' }], extra: 1 });
  await assert.rejects(runBuild({ workDir, apiCommonData }),
    /recipe\.json: idPolicy must be one of ncbiDefault, none; transforms\[0\]: unknown transform renameEverything; .*; unknown keys: extra/);
  writeFileSync(join(workDir, 'recipe.json'), '{');
  await assert.rejects(runBuild({ workDir, apiCommonData }), (e) => isBuildError(e) && /is not JSON/.test(e.problem));
  writeRecipe(workDir);
  const survey = JSON.parse(read(workDir, 'survey.json'));
  writeFileSync(join(workDir, 'survey.json'), JSON.stringify({ ...survey, inputs: { ...survey.inputs, gff: { ...survey.inputs.gff, sha256: 'x' } } }));
  await assert.rejects(runBuild({ workDir, apiCommonData }), /survey\.json: was written for a different gff file\nNext: run survey again/);
});

test('a policy collision stops build with the ids.tsv line that settles it; the line then does', async () => {
  const { workDir, apiCommonData } = await surveyedWorkDir({ gff: TINY_COLLIDING_GFF });
  writeRecipe(workDir);
  await assert.rejects(runBuild({ workDir, apiCommonData }), (e) =>
    isBuildError(e)
    && e.problem === 'error ids/duplicateId (1): the ID policy gives one ID to several features: TST_0050 ← gene-TST_0050 and rna-TST_0050 [TST_0050]'
    && e.next.includes('transcript\trna-TST_0050\t<new id>'));
  assert.match(read(workDir, 'ids.default.tsv'), /^gene\tgene-TST_0050\tTST_0050$/m);
  writeFileSync(join(workDir, 'ids.tsv'), 'level\told\tnew\ntranscript\trna-TST_0050\tTST_0050.1\n');
  writeRecipe(workDir, { ...TINY_RECIPE, ids: 'ids.tsv' });
  const record = await runBuild({ workDir, apiCommonData, now: FIXED_NOW });
  assert.equal(record.ids.applied, 1);
  assert.equal(record.ids.sha256, sha256('level\told\tnew\ntranscript\trna-TST_0050\tTST_0050.1\n'));
  const normalized = read(workDir, 'build/normalized.gff3');
  assert.match(normalized, /\tmRNA\t1400\t1500\t\.\t\+\t\.\tID=TST_0050\.1;Parent=TST_0050;gbkey=mRNA\n/);
  assert.match(normalized, /\tCDS\t1400\t1500\t\.\t\+\t0\tID=PRT5\.1;Parent=TST_0050\.1;/);
});

test('a policy collision names the existing ids.tsv line instead of a second one', async () => {
  const { workDir, apiCommonData } = await surveyedWorkDir({ gff: TINY_COLLIDING_GFF });
  writeFileSync(join(workDir, 'ids.tsv'), 'level\told\tnew\ntranscript\trna-TST_0050\tTST_0050\n');
  writeRecipe(workDir, { ...TINY_RECIPE, ids: 'ids.tsv' });
  await assert.rejects(runBuild({ workDir, apiCommonData }), (e) =>
    isBuildError(e) && e.next.includes('ids.tsv line 2 already renames rna-TST_0050') && !e.next.includes('<new id>'));
});

test('a created-ID collision names the input whose ids.tsv line would fix it', async () => {
  const gff = TINY_GFF.replace(`##sequence-region ${KZ}`, [
    gffLine(CM, 'gene', 1400, 1500, '+', 'ID=gene-TST_0060;Name=TST_0060;gbkey=Gene;gene=TST_0060;gene_biotype=protein_coding'),
    gffLine(CM, 'CDS', 1400, 1500, '+', 'ID=cds-PRT6.1;Parent=gene-TST_0060;gbkey=CDS;protein_id=PRT6.1'),
    gffLine(CM, 'gene', 1600, 1700, '+', 'ID=gene-TST_0060_mRNA;Name=TST_0060_mRNA;gbkey=Gene;gene_biotype=other'),
    `##sequence-region ${KZ}`
  ].join('\n'));
  const { workDir, apiCommonData } = await surveyedWorkDir({ gff });
  writeRecipe(workDir);
  await assert.rejects(runBuild({ workDir, apiCommonData }), (e) =>
    isBuildError(e) && /addMrnaToGeneCds: created ID TST_0060_mRNA \(for TST_0060\) already exists; it derives from input gene gene-TST_0060/.test(e.problem)
    && e.next === 'gene\tgene-TST_0060\t<new id>');
});

test('a transform that needs a hand fix is a build error naming the recipe', async () => {
  const gff = TINY_GFF.replace(`##sequence-region ${KZ}`, [
    gffLine(CM, 'snRNA', 1500, 1600, '+', 'ID=rna-A;gbkey=ncRNA'),
    gffLine(CM, 'snRNA', 1500, 1600, '-', 'ID=rna-B;gbkey=ncRNA'),
    `##sequence-region ${KZ}`
  ].join('\n'));
  const { workDir, apiCommonData } = await surveyedWorkDir({ gff });
  writeRecipe(workDir);
  await assert.rejects(runBuild({ workDir, apiCommonData }), (e) => isBuildError(e) && /hand fix to the input GFF/.test(e.next));
});

test('a gene split across strands is a build error with the hand-fix next step', async () => {
  const gff = TINY_GFF.replace(`##sequence-region ${KZ}`, [
    gffLine(CM, 'gene', 1600, 1650, '+', 'ID=gene-TST_0070;gbkey=Gene'),
    gffLine(CM, 'gene', 1700, 1750, '-', 'ID=gene-TST_0070;gbkey=Gene'),
    `##sequence-region ${KZ}`
  ].join('\n'));
  const { workDir, apiCommonData } = await surveyedWorkDir({ gff });
  writeRecipe(workDir);
  await assert.rejects(runBuild({ workDir, apiCommonData }), (e) =>
    isBuildError(e) && /gene TST_0070 has lines on different sequences or strands/.test(e.problem) && /hand fix to the input GFF/.test(e.next));
});

test('a transform error without a known code is rethrown unchanged', async () => {
  const { workDir, apiCommonData } = await surveyedWorkDir();
  writeRecipe(workDir);
  const original = TRANSFORMS.collapseSplitGenes.run;
  const boom = new TypeError('boom');
  TRANSFORMS.collapseSplitGenes.run = () => { throw boom; };
  try {
    await assert.rejects(runBuild({ workDir, apiCommonData }), (e) => e === boom);
  } finally {
    TRANSFORMS.collapseSplitGenes.run = original;
  }
  assert.equal(existsSync(join(workDir, 'build')), false);
});

test('a refused build leaves the previous build untouched; a good rebuild replaces it and drops a stale genome-build.json', async () => {
  const { workDir, apiCommonData } = await surveyedWorkDir();
  writeRecipe(workDir);
  await runBuild({ workDir, apiCommonData, now: FIXED_NOW });
  const before = [read(workDir, 'build/build.json'), read(workDir, 'build/normalized.gff3')];
  writeFileSync(join(workDir, 'genome-build.json'), '{}');
  writeRecipe(workDir, { idPolicy: 'ncbiDefault', transforms: [{ name: 'collapseSplitGenes' }, { name: 'parentOrphanRnas' }] });
  await assert.rejects(runBuild({ workDir, apiCommonData }), isBuildError);
  assert.deepEqual([read(workDir, 'build/build.json'), read(workDir, 'build/normalized.gff3')], before);
  assert.equal(existsSync(join(workDir, 'genome-build.json')), true);
  mkdirSync(join(workDir, 'final'));
  writeFileSync(join(workDir, 'final/keep.txt'), 'x');
  writeRecipe(workDir, { ...TINY_RECIPE, transforms: [...TINY_RECIPE.transforms, { name: 'stripAttributes', args: { type: 'gap', keys: ['gbkey'] } }] });
  await runBuild({ workDir, apiCommonData, now: FIXED_NOW });
  assert.equal(existsSync(join(workDir, 'genome-build.json')), false);
  assert.equal(existsSync(join(workDir, 'build.tmp')), false);
  assert.equal(read(workDir, 'final/keep.txt'), 'x');
  assert.notEqual(read(workDir, 'build/build.json'), before[0]);
});

test('a refused build first puts back a build/ that a crashed swap left as build.old', async () => {
  const { workDir, apiCommonData } = await surveyedWorkDir();
  writeRecipe(workDir);
  await runBuild({ workDir, apiCommonData, now: FIXED_NOW });
  const before = read(workDir, 'build/build.json');
  renameSync(join(workDir, 'build'), join(workDir, 'build.old'));
  writeRecipe(workDir, { idPolicy: 'ncbiDefault', transforms: [{ name: 'collapseSplitGenes' }, { name: 'parentOrphanRnas' }] });
  await assert.rejects(runBuild({ workDir, apiCommonData }), isBuildError);
  assert.equal(read(workDir, 'build/build.json'), before);
  assert.equal(existsSync(join(workDir, 'build.old')), false);
});

test('record checksums come from the text that was parsed', async () => {
  const { workDir, apiCommonData } = await surveyedWorkDir();
  const idsText = 'level\told\tnew\ngene\tgene-TST_0010\tTST_0010\n';
  const partitionsText = `sequence\trole\tsoTerm\torganelle\n${KZ}\tsecondary\tcontig\t\n`;
  writeFileSync(join(workDir, 'ids.tsv'), idsText);
  writeFileSync(join(workDir, 'partitions.tsv'), partitionsText);
  writeRecipe(workDir, { ...TINY_RECIPE, ids: 'ids.tsv', partitions: 'partitions.tsv' });
  const record = await runBuild({ workDir, apiCommonData, now: FIXED_NOW });
  assert.equal(record.ids.sha256, sha256(idsText));
  assert.equal(record.partitionsTsv.sha256, sha256(partitionsText));
});

test('an organelle sequence with no features is its own partition with featureCount 0', async () => {
  const mt = 'MT000003.1';
  const { workDir, apiCommonData } = await surveyedWorkDir({
    fasta: `${TINY_FASTA}>${mt} Testus tinyus mitochondrion\n${'GATC'.repeat(10)}\n`,
    report: reportText([
      ['chr1', 'assembled-molecule', 'Chromosome', CM, 'NC_000001.1'],
      ['scaffold2', 'unplaced-scaffold', 'na', KZ, 'NW_000002.1'],
      ['MT', 'assembled-molecule', 'Mitochondrion', mt]
    ])
  });
  writeRecipe(workDir);
  const record = await runBuild({ workDir, apiCommonData, now: FIXED_NOW });
  const { buildFiles, ...last } = record.partitions.at(-1);
  assert.equal(buildFiles.chromosomeMap, null);
  assert.deepEqual(last, {
    role: 'organelle', soTerm: 'mitochondrial_chromosome', organelle: 'mitochondrion', sequenceCount: 1, dir: 'final/organelle_mitochondrion',
    featureCount: 0, gffLines: 0, final: { gff: null, fasta: 'genome.fasta', chromosomeMap: null }
  });
  assert.equal(read(workDir, 'build/organelle_mitochondrion/genome.fasta'), `>${mt} Testus tinyus mitochondrion\n${'GATC'.repeat(10)}\n`);
  assert.equal(read(workDir, 'build/organelle_mitochondrion/genome.gff3'), '##gff-version 3\n###\n');
  assert.equal(existsSync(join(workDir, 'build/organelle_mitochondrion/chromosomeMap.txt')), false);
});

test('a partition whose GFF holds only a region line has featureCount 0, gffLines 1 and no final GFF', async () => {
  const mt = 'MT000003.1';
  const { workDir, apiCommonData } = await surveyedWorkDir({
    gff: TINY_GFF.replace(/###\n$/, `##sequence-region ${mt} 1 40\n${gffLine(mt, 'region', 1, 40, '+', `ID=${mt}:1..40;gbkey=Src`)}\n###\n`),
    fasta: `${TINY_FASTA}>${mt} Testus tinyus mitochondrion\n${'GATC'.repeat(10)}\n`,
    report: reportText([
      ['chr1', 'assembled-molecule', 'Chromosome', CM, 'NC_000001.1'],
      ['scaffold2', 'unplaced-scaffold', 'na', KZ, 'NW_000002.1'],
      ['MT', 'assembled-molecule', 'Mitochondrion', mt]
    ])
  });
  writeRecipe(workDir);
  const record = await runBuild({ workDir, apiCommonData, now: FIXED_NOW });
  const last = record.partitions.at(-1);
  assert.deepEqual([last.dir, last.featureCount, last.gffLines, last.final.gff], ['final/organelle_mitochondrion', 0, 1, null]);
});

test('an ids.tsv sequence line renames the GFF, the FASTA and the partition', async () => {
  const { workDir, apiCommonData } = await surveyedWorkDir();
  writeFileSync(join(workDir, 'ids.tsv'), 'level\told\tnew\nsequence\tKZ000002.1\tscaffold2\n');
  writeRecipe(workDir, { ...TINY_RECIPE, ids: 'ids.tsv' });
  const record = await runBuild({ workDir, apiCommonData, now: FIXED_NOW });
  assert.equal(record.ids.applied, 1);
  assert.match(read(workDir, 'build/secondary_supercontig/genome.gff3'), /^##sequence-region scaffold2 1 600\nscaffold2\tEMBL\tgene\t10\t300\t/m);
  assert.match(read(workDir, 'build/secondary_supercontig/genome.fasta'), /^>scaffold2 Testus tinyus scaffold2\n/);
});

test('ids.tsv errors stop build after ids.default.tsv is written', async () => {
  const { workDir, apiCommonData } = await surveyedWorkDir();
  writeFileSync(join(workDir, 'ids.tsv'), 'level\told\tnew\ngene\tnot-there\tX\n');
  writeRecipe(workDir, { ...TINY_RECIPE, ids: 'ids.tsv' });
  await assert.rejects(runBuild({ workDir, apiCommonData }), (e) =>
    isBuildError(e) && /ids\.tsv line 2: gene not-there is not an input gene ID/.test(e.problem) && /fix those ids\.tsv lines/.test(e.next));
  assert.equal(read(workDir, 'ids.default.tsv'), TINY_IDS_DEFAULT);
  assert.equal(existsSync(join(workDir, 'build')), false);
});

test('a malformed ids.tsv is a build error', async () => {
  const { workDir, apiCommonData } = await surveyedWorkDir();
  writeFileSync(join(workDir, 'ids.tsv'), 'level\told\tnew\ngene\tgene-TST_0010\tA\ngene\tgene-TST_0010\tB\n');
  writeRecipe(workDir, { ...TINY_RECIPE, ids: 'ids.tsv' });
  await assert.rejects(runBuild({ workDir, apiCommonData }), (e) => isBuildError(e) && /line 3: old gene-TST_0010 is repeated/.test(e.problem));
});

test('an input GFF with duplicate IDs is refused', async () => {
  const gff = TINY_GFF.replace(`##sequence-region ${KZ}`, `${gffLine(CM, 'snRNA', 1600, 1700, '+', 'ID=gene-TST_0010')}\n##sequence-region ${KZ}`);
  const { workDir, apiCommonData } = await surveyedWorkDir({ gff });
  writeRecipe(workDir);
  await assert.rejects(runBuild({ workDir, apiCommonData }), (e) => isBuildError(e) && /IDs used by several features: gene-TST_0010/.test(e.problem));
});

test('a partitions.tsv named in the recipe is applied and recorded', async () => {
  const { workDir, apiCommonData } = await surveyedWorkDir();
  writeFileSync(join(workDir, 'partitions.tsv'), `sequence\trole\tsoTerm\torganelle\n${KZ}\tsecondary\tcontig\t\n`);
  writeRecipe(workDir, { ...TINY_RECIPE, partitions: 'partitions.tsv' });
  const record = await runBuild({ workDir, apiCommonData, now: FIXED_NOW });
  assert.deepEqual(record.partitions.map((p) => p.dir), ['final/primary_chromosome', 'final/secondary_contig']);
  assert.equal(record.partitionsTsv.file, 'partitions.tsv');
  assert.equal(existsSync(join(workDir, 'build/secondary_contig/genome.gff3')), true);
});
