import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runSurvey } from '../shared/scripts/genome/commands/survey.js';
import { PipelineError, sha256, sha256File } from '../shared/scripts/genome/workdir.js';
import { CM, fakeApiCommonData, fetchedWorkDir, FIXED_NOW, gffLine, KZ, TINY_ASSEMBLY, TINY_COLLIDING_GFF, TINY_GFF, TINY_REPORT } from './genome-helpers.js';

const fetchShas = (workDir) => readdirSync(join(workDir, 'fetch')).map((name) => [name, sha256File(join(workDir, 'fetch', name))]);

test('survey writes findings, a suggested recipe and partitions, and never touches its inputs', async () => {
  const workDir = await fetchedWorkDir();
  const before = fetchShas(workDir);
  const survey = await runSurvey({ workDir, apiCommonData: fakeApiCommonData(), now: FIXED_NOW });
  assert.deepEqual(survey.findings.map((f) => [f.stage, f.check, f.count]), [
    ['raw', 'geneCdsNoRna', 3], ['raw', 'repeatedGeneLines', 1], ['raw', 'parentlessRna', 1], ['raw', 'unhandledType', 5], ['raw', 'partitionCounts', 2],
    ['suggested', 'unhandledType', 1], ['suggested', 'attributeNotInMap', 1], ['suggested', 'partitionCounts', 2]
  ]);
  assert.deepEqual(survey.suggestedRecipe, {
    idPolicy: 'ncbiDefault',
    transforms: [
      { name: 'collapseSplitGenes' }, { name: 'addMrnaToGeneCds' }, { name: 'parentOrphanRnas' }, { name: 'addExonPerCds' },
      { name: 'stripAttributes', args: { type: 'gene', keys: ['is_ordered'] } }
    ]
  });
  assert.deepEqual(survey.partitions, [
    { role: 'primary', soTerm: 'chromosome', organelle: null, sequenceCount: 1, dir: 'final/primary_chromosome' },
    { role: 'secondary', soTerm: 'supercontig', organelle: null, sequenceCount: 1, dir: 'final/secondary_supercontig' }
  ]);
  assert.equal(survey.accession, 'GCA_000000001.1');
  assert.equal(survey.surveyedAt, FIXED_NOW());
  assert.deepEqual(survey.inputs.report, { name: `${TINY_ASSEMBLY}_assembly_report.txt`, sha256: sha256(TINY_REPORT) });
  assert.deepEqual(JSON.parse(readFileSync(join(workDir, 'survey.json'), 'utf-8')), survey);
  assert.deepEqual(fetchShas(workDir), before);
});

test('survey shows a policy collision with the ids.tsv line that settles it, then previews with ids.tsv', async () => {
  const workDir = await fetchedWorkDir({ gff: TINY_COLLIDING_GFF });
  const apiCommonData = fakeApiCommonData();
  const first = await runSurvey({ workDir, apiCommonData, now: FIXED_NOW });
  const suggested = first.findings.filter((f) => f.stage === 'suggested');
  assert.deepEqual(suggested.map((f) => f.check), ['duplicateId']);
  assert.equal(suggested[0].message, 'the ID policy gives one ID to several features: TST_0050 ← gene-TST_0050 and rna-TST_0050');
  assert.deepEqual(suggested[0].fix, { ids: ['transcript\trna-TST_0050\t<new id>'] });
  writeFileSync(join(workDir, 'ids.tsv'), 'level\told\tnew\ntranscript\trna-TST_0050\tTST_0050.1\n');
  const second = await runSurvey({ workDir, apiCommonData, now: FIXED_NOW });
  assert.equal(second.findings.some((f) => f.check === 'duplicateId'), false);
  assert.equal(second.suggestedRecipe.ids, 'ids.tsv');
  writeFileSync(join(workDir, 'ids.tsv'), 'level\told\tnew\ngene\tTST_0050\tX\n');
  const third = await runSurvey({ workDir, apiCommonData, now: FIXED_NOW });
  assert.deepEqual(third.findings.filter((f) => f.stage === 'suggested').map((f) => [f.check, f.message]), [
    ['idsTsvLine', 'ids.tsv line 2: gene TST_0050 is not an input gene ID (old must be the ID as written in the input GFF)']
  ]);
});

test('a transform-created ID that collides is reported as a suggested duplicateId naming the input gene', async () => {
  const gff = TINY_GFF.replace(`##sequence-region ${KZ}`, `${gffLine(CM, 'gene', 1600, 1700, '+', 'ID=TST_0010_mRNA')}\n##sequence-region ${KZ}`);
  const workDir = await fetchedWorkDir({ gff });
  const survey = await runSurvey({ workDir, apiCommonData: fakeApiCommonData(), now: FIXED_NOW });
  const suggested = survey.findings.filter((f) => f.stage === 'suggested');
  assert.deepEqual(suggested.map((f) => f.check), ['duplicateId']);
  assert.deepEqual(suggested[0].fix, { ids: ['gene\tgene-TST_0010\t<new id>'] });
});

test('a malformed GFF is a survey error naming the file', async () => {
  const workDir = await fetchedWorkDir({ gff: `##gff-version 3\n${CM}\tEMBL\tgene\t1\t9\t.\t+\tID=g\n` });
  await assert.rejects(runSurvey({ workDir, apiCommonData: fakeApiCommonData() }), (e) =>
    e instanceof PipelineError && e.command === 'survey' && e.file.endsWith(`${TINY_ASSEMBLY}_genomic.gff.gz`));
});

test('ids.tsv errors become a raw finding, the preview is skipped and survey.json is still written', async () => {
  const workDir = await fetchedWorkDir();
  writeFileSync(join(workDir, 'ids.tsv'), 'level\told\tnew\ngene\tgene-TST_0010\tA\ngene\tgene-TST_0010\tB\n');
  const survey = await runSurvey({ workDir, apiCommonData: fakeApiCommonData(), now: FIXED_NOW });
  const idsFinding = survey.findings.find((f) => f.check === 'idsTsvLine');
  assert.equal(idsFinding.stage, 'raw');
  assert.match(idsFinding.message, /ids\.tsv line 3: old gene-TST_0010 is repeated/);
  assert.equal(survey.findings.some((f) => f.stage === 'suggested'), false);
  assert.deepEqual(JSON.parse(readFileSync(join(workDir, 'survey.json'), 'utf-8')), survey);
});

test('a partitions.tsv override changes the partitions and is named in the suggested recipe', async () => {
  const workDir = await fetchedWorkDir();
  writeFileSync(join(workDir, 'partitions.tsv'), `sequence\trole\tsoTerm\torganelle\n${KZ}\tsecondary\tcontig\t\n`);
  const survey = await runSurvey({ workDir, apiCommonData: fakeApiCommonData(), now: FIXED_NOW });
  assert.equal(survey.suggestedRecipe.partitions, 'partitions.tsv');
  assert.deepEqual(survey.partitions.map((p) => p.dir), ['final/primary_chromosome', 'final/secondary_contig']);
});

test('a bad partitions.tsv row is a survey error', async () => {
  const workDir = await fetchedWorkDir();
  writeFileSync(join(workDir, 'partitions.tsv'), `sequence\trole\tsoTerm\torganelle\n${KZ}\tbogus\tcontig\t\n`);
  await assert.rejects(runSurvey({ workDir, apiCommonData: fakeApiCommonData() }), /^PipelineError: survey: .*partitions\.tsv: partitions\.tsv line 2: role must be one of/s);
});

test('survey needs --apiCommonData and an intact fetch', async () => {
  const workDir = await fetchedWorkDir();
  await assert.rejects(runSurvey({ workDir }), /survey: --apiCommonData: is required\nNext: pass --apiCommonData <an ApiCommonData checkout>/);
  writeFileSync(join(workDir, 'fetch', `${TINY_ASSEMBLY}_genomic.fna.gz`), 'x');
  await assert.rejects(runSurvey({ workDir, apiCommonData: fakeApiCommonData() }), /genomic\.fna\.gz: does not match fetch\/fetch\.json/);
});
