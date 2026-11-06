import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validatorsFor } from '../shared/scripts/dataset-types/validators.js';
import { datasetsOf } from '../shared/scripts/dataset-types/_common.js';
import { runValidators } from '../shared/scripts/lib/validation.js';
import { readPreprocessed } from '../shared/scripts/dataset-types/genome-assembly/preprocess.js';
import { entryShape, entryShapeProblems } from '../shared/scripts/dataset-types/genome-assembly/validators/entry-shape.js';
import { organismRecord } from '../shared/scripts/dataset-types/genome-assembly/validators/organism-record.js';
import { records } from '../shared/scripts/dataset-types/genome-assembly/validators/records.js';
import { ids } from '../shared/scripts/dataset-types/genome-assembly/validators/ids.js';
import { matchesBuild } from '../shared/scripts/dataset-types/genome-assembly/validators/matches-build.js';
import { pipelineFindings } from '../shared/scripts/dataset-types/genome-assembly/validators/pipeline-findings.js';
import { genomeWorkArea, amendedProposal, editJson } from './genome-work-area.js';

const messages = async (validator, { dir, manifest }, ctx = {}) => (await validator.run({ proposalDir: dir, manifest, ...ctx })).map((f) => f.message);
const AMEND = 'run amend-proposal.js and publish';

test('genome-assembly registers its validators, the work-area ones first', () => {
  assert.deepEqual(validatorsFor('genome-assembly').map((v) => [v.name, v.kind]), [
    ['records', 'preprocess'], ['matchesBuild', 'preprocess'], ['ids', 'preprocess'], ['pipelineFindings', 'preprocess'],
    ['entryShape', 'content'], ['organismRecord', 'content']
  ]);
});

test('entryShape passes an amended genome', async () => {
  assert.deepEqual(await messages(entryShape, amendedProposal(genomeWorkArea())), []);
});

test('entryShape refuses each shape a genome cannot load', () => {
  const { dir, manifest } = amendedProposal(genomeWorkArea());
  const [primary, contig, mito, primaryFeatures, contigFeatures, products] = datasetsOf(dir, manifest);
  const annotated = (list) => entryShapeProblems(list, { source: 'genbank' });
  assert.deepEqual(annotated([contig, contigFeatures, products]), [`a genome needs exactly one fasta_primary_genome_sequence entry; this one has 0; ${AMEND}`]);
  assert.deepEqual(annotated([primary, primary, primaryFeatures, products]), [`a genome needs exactly one fasta_primary_genome_sequence entry; this one has 2; ${AMEND}`]);
  assert.deepEqual(annotated([primary, contig, contig, primaryFeatures, products]), ['two fasta_secondary_genome entries have soTerm contig; each lower sequence type needs its own']);
  assert.deepEqual(annotated([primary, mito, mito, primaryFeatures, products]), ['two fasta_organelle_genome entries are for organelle mitochondrion']);
  assert.deepEqual(annotated([primary, contigFeatures, primaryFeatures, products]),
    ['NoPreprocess_secondary_genome_features $$genomeSource$$ (contig) has no secondary sequence entry with soTerm contig']);
  assert.deepEqual(annotated([primary, primaryFeatures]), [`an annotated genome needs a productNames entry; ${AMEND}`]);
  assert.deepEqual(annotated([primary, products]), [`an annotated genome needs at least one features entry; ${AMEND}`]);
  const unannotated = (list) => entryShapeProblems(list, { source: 'none' });
  assert.deepEqual(unannotated([primary, contig, mito]), []);
  assert.deepEqual(unannotated([primary, primaryFeatures]),
    ['an unannotated genome loads sequence entries only, not NoPreprocess_primary_genome_features $$genomeSource$$ (chromosome)']);
});

test('organismRecord passes an amended record', async () => {
  assert.deepEqual(await messages(organismRecord, amendedProposal(genomeWorkArea())), []);
});

test('organismRecord asks for an amendment of a Phase 1 record, and checks each amended prop', async () => {
  const proposal = amendedProposal(genomeWorkArea());
  const path = join(proposal.dir, 'curated/organism.json');
  const amended = JSON.parse(readFileSync(path, 'utf-8'));
  const check = async (record) => { writeFileSync(path, JSON.stringify(record)); return messages(organismRecord, proposal); };
  assert.deepEqual(await check({ ...amended, schemaVersion: 1 }), [`curated/organism.json is schema version 1, without the props preprocessing adds; ${AMEND}`]);
  const { isCore, ...withoutIsCore } = amended;
  assert.deepEqual(await check(withoutIsCore), [`curated/organism.json has no isCore; ${AMEND}`]);
  assert.deepEqual(await check({ ...amended, isHugeGenome: 'yes' }), ['isHugeGenome must be "true" or "false", not "yes"']);
  assert.deepEqual(await check({ ...amended, maxIntronSize: '0' }), ['maxIntronSize must be a positive integer, not "0"']);
  assert.deepEqual(await check({ ...amended, orthomclAbbrev: 'TFAK' }), ['orthomclAbbrev must be 4 to 8 lowercase letters, not "TFAK"']);
  assert.deepEqual(await check({ ...amended, genomeVersion: '2025-01-01' }),
    [`constant genomeVersion is "2024-03-05" but the organism record says "2025-01-01"; ${AMEND}`]);
  assert.deepEqual(await check({ ...amended, isFamilyRepresentative: 'true' }), [
    'a family representative needs familyNcbiTaxonIds; run amend-proposal.js --organism familyNcbiTaxonIds=... and publish',
    'a family representative needs familyNameForFiles; run amend-proposal.js --organism familyNameForFiles=... and publish'
  ]);
});

test('records passes a deliverable work area and keeps its record sha256s for the report', async () => {
  const workArea = genomeWorkArea();
  const extras = {};
  assert.deepEqual(await records.run({ workArea, extras }), []);
  assert.deepEqual(extras.preprocess, readPreprocessed(workArea).sha256);
});

test('records reports each problem that makes the work area undeliverable as an error', async () => {
  const findings = await records.run({ workArea: genomeWorkArea({ trial: { result: 'failed' } }), extras: {} });
  assert.deepEqual(findings.map((f) => [f.validator, f.severity]), [['records', 'error']]);
  assert.match(findings[0].message, /the trial result is "failed"/);
});

test('the other preprocess validators leave an unreadable work area to records', async () => {
  const { dir, manifest } = amendedProposal(genomeWorkArea());
  const empty = mkdtempSync(join(tmpdir(), 'empty-work-area-'));
  for (const v of [ids, matchesBuild, pipelineFindings]) assert.deepEqual(await v.run({ workArea: empty, proposalDir: dir, manifest }), [], v.name);
  const findings = await runValidators([records], { workArea: empty, extras: {} }, () => ({}));
  assert.match(findings[0].message, /^failed: verify: .*genome-build\.json: is missing/);
});

test('ids passes functional files whose IDs ISF loads, and names the rest with a sample', async () => {
  const workArea = genomeWorkArea();
  assert.deepEqual(await ids.run({ workArea }), []);
  appendFileSync(join(workArea, 'final/function/productNames/GenBank/products.txt'), 'TST_9999_mRNA\tghost\t1\nTST_0010\tgene id\t1\n');
  assert.deepEqual((await ids.run({ workArea })).map((f) => f.message),
    ['productNames GenBank: 2 transcript IDs are not in transcriptInfoAndIds, such as TST_9999_mRNA, TST_0010']);
});

test('ids reads protein IDs as <transcript>-p1 and GAF IDs from column 2', async () => {
  const workArea = genomeWorkArea({ functionalDatasets: [
    { datasetClass: 'EnzymeCommissionAssociations', name: 'GenBank', file: 'ec.txt', level: 'protein', text: 'TST_0010_mRNA-p1\t1.1.1.1\nTST_0010_mRNA\t1.1.1.2\n', props: {} },
    { datasetClass: 'GeneOntologyAssociations', name: 'GenBank', file: 'associations.gas', level: 'transcript', text: 'GenBank\tTST_0040_mRNA\tTST_0040_mRNA\t\tGO:0000001\n', props: {} }
  ] });
  assert.deepEqual((await ids.run({ workArea })).map((f) => f.message),
    ['EnzymeCommissionAssociations GenBank: 1 protein IDs are not in transcriptInfoAndIds, such as TST_0010_mRNA']);
});

test('matchesBuild passes a proposal amended from this build and refuses one amended from another', async () => {
  const workArea = genomeWorkArea();
  const MESSAGE = 'the proposal was amended from another build; re-run amend-proposal and publish';
  const p = amendedProposal(workArea);
  const ctx = { workArea, proposalDir: p.dir, manifest: p.manifest };
  assert.deepEqual(await matchesBuild.run(ctx), []);
  editJson(join(p.dir, 'curated/datasets.json'), (d) => ({ ...d, datasets: d.datasets.slice(0, -1) }));
  assert.deepEqual((await matchesBuild.run(ctx)).map((f) => f.message), [MESSAGE]);
  const other = amendedProposal(workArea);
  editJson(join(other.dir, 'curated/organism.json'), (r) => ({ ...r, constants: { ...r.constants, functAnnotVersion: '2020-01-01' } }));
  assert.deepEqual((await matchesBuild.run({ workArea, proposalDir: other.dir, manifest: other.manifest })).map((f) => f.message), [MESSAGE]);
});

test('pipelineFindings reports D, C and E findings at their own severities, tagged by step', async () => {
  const f = (group, check, severity, message, sample = []) => ({ group, check, severity, count: sample.length || 1, sample, message, fix: null });
  const workArea = genomeWorkArea({
    buildWarnings: ['addExonPerCds changed nothing; the recipe declares a transform this genome does not need'],
    buildFindings: [f('sequences', 'partitionCounts', 'info', 'chromosome 1')],
    trial: { findings: [f('qa', 'internalStop', 'warning', 'proteins with an internal stop codon', ['p1', 'p2'])] },
    functionalFindings: [f('functional', 'unknownDbxrefPrefix', 'warning', 'no URL for these prefixes', ['EnsemblGenomes-Gn'])]
  });
  assert.deepEqual((await pipelineFindings.run({ workArea })).map((x) => [x.severity, x.message]), [
    ['warning', '[build] addExonPerCds changed nothing; the recipe declares a transform this genome does not need'],
    ['info', '[build] sequences/partitionCounts (1): chromosome 1'],
    ['warning', '[trial] qa/internalStop (2): proteins with an internal stop codon [p1, p2]'],
    ['warning', '[functional] functional/unknownDbxrefPrefix (1): no URL for these prefixes [EnsemblGenomes-Gn]']
  ]);
});

test('ids skips files that are gone, and records reports each of them once', async () => {
  const workArea = genomeWorkArea();
  rmSync(join(workArea, 'final/function/productNames/GenBank/products.txt'));
  rmSync(join(workArea, 'final/primary_chromosome/transcriptInfoAndIds'));
  assert.deepEqual(await ids.run({ workArea }), []);
  const messagesOf = (await records.run({ workArea, extras: {} })).map((f) => f.message);
  assert.equal(messagesOf.filter((m) => m.includes('products.txt')).length, 1);
  assert.equal(messagesOf.filter((m) => m.includes('primary_chromosome/transcriptInfoAndIds')).length, 1);
});

test('ids refuses an ID level it does not know, and checks gene-level files against gene IDs', async () => {
  const bad = genomeWorkArea({ functionalDatasets: [{ datasetClass: 'productNames', name: 'GenBank', file: 'products.txt', level: 'exon', text: 'x\ty\t1\n', props: {} }] });
  assert.deepEqual((await ids.run({ workArea: bad })).map((f) => f.message), ['productNames GenBank: ID level "exon" is not gene, transcript or protein']);
  const gene = genomeWorkArea({ functionalDatasets: [{ datasetClass: 'geneName', name: 'GenBank', file: 'geneName.txt', level: 'gene', text: 'TST_0010\tabcA\nTST_ghost\tz\n', props: {} }] });
  assert.deepEqual((await ids.run({ workArea: gene })).map((f) => f.message), ['geneName GenBank: 1 gene IDs are not in transcriptInfoAndIds, such as TST_ghost']);
});

test('pipelineFindings keeps an error finding and turns an unknown severity into a warning', async () => {
  const f = (severity, message) => ({ group: 'g', check: 'c', severity, count: 1, sample: [], message, fix: null });
  const workArea = genomeWorkArea({ trial: { findings: [f('error', 'bad trial')] }, functionalFindings: [f('bogus', 'odd')] });
  assert.deepEqual((await pipelineFindings.run({ workArea })).map((x) => [x.severity, x.message]), [
    ['error', '[trial] g/c (1): bad trial'],
    ['warning', '[functional] g/c (1): odd']
  ]);
});

test('organismRecord reports a missing prop once, a non-string value, a newer schema, and a constant that differs on its own', async () => {
  const proposal = amendedProposal(genomeWorkArea());
  const path = join(proposal.dir, 'curated/organism.json');
  const amended = JSON.parse(readFileSync(path, 'utf-8'));
  const check = async (record) => { writeFileSync(path, JSON.stringify(record)); return messages(organismRecord, proposal); };
  const { genomeVersion, ...withoutVersion } = amended;
  assert.deepEqual(await check(withoutVersion), []);
  assert.deepEqual(await check({ ...amended, isCore: true }), ['isCore must be a string']);
  assert.deepEqual(await check({ ...amended, schemaVersion: 3 }), ['curated/organism.json is schema version 3, newer than this tool knows; update the tool']);
  assert.deepEqual(await check({ ...amended, genomeSource: 'RefSeq' }), [`constant genomeSource is "GenBank" but the organism record says "RefSeq"; ${AMEND}`]);
});
