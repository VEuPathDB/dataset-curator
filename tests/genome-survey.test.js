import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runSurvey } from '../shared/scripts/genome/commands/survey.js';
import { sha256, sha256File } from '../shared/scripts/genome/workdir.js';
import { fakeApiCommonData, fetchedWorkDir, FIXED_NOW, TINY_ASSEMBLY, TINY_COLLIDING_GFF, TINY_REPORT } from './genome-helpers.js';

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

test('survey needs --apiCommonData and an intact fetch', async () => {
  const workDir = await fetchedWorkDir();
  await assert.rejects(runSurvey({ workDir }), /survey: --apiCommonData: is required\nNext: pass --apiCommonData <an ApiCommonData checkout>/);
  writeFileSync(join(workDir, 'fetch', `${TINY_ASSEMBLY}_genomic.fna.gz`), 'x');
  await assert.rejects(runSurvey({ workDir, apiCommonData: fakeApiCommonData() }), /genomic\.fna\.gz: does not match fetch\/fetch\.json/);
});
