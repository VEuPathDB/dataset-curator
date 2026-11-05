import { test } from 'node:test';
import assert from 'node:assert/strict';
import { partitionName } from '../shared/scripts/genome/genome-build.js';
import {
  ISF_UNDO, isfFiles, isfMapIn, planSteps, PLUGINS, releaseVersion, trialDatabaseName, UNDO, undoPlan
} from '../shared/scripts/genome/trial/steps.js';
import { PipelineError } from '../shared/scripts/genome/workdir.js';
import { GUS_HOME, MAP_IN_IMAGE, ORGANELLE, PRIMARY, RELEASE, START, TAXON_ID, trialBuild, trialDb } from './genome-trial-helpers.js';

const build = trialBuild();
const steps = planSteps(build, { taxonId: TAXON_ID, release: RELEASE, gusHome: GUS_HOME });
const byKey = (key) => steps.find((s) => s.key === key);

test('names: partition, trial database, release version, map in the image', () => {
  assert.equal(partitionName(build.partitions[0]), PRIMARY);
  assert.equal(trialDatabaseName(build.accession, build.partitions[1]), trialDb(ORGANELLE));
  assert.equal(releaseVersion(new Date('2026-11-05T10:23:45.678Z')), RELEASE);
  assert.equal(isfMapIn(GUS_HOME), MAP_IN_IMAGE);
  assert.deepEqual(isfFiles('isfSet', PRIMARY), {
    validationLog: `trial/${PRIMARY}/isfSet.validation.log`, bioperlTree: `trial/${PRIMARY}/isfSet.bioperlTree.out`
  });
});

test('sequences load for every partition first, then ISF run 1 and run 2 for partitions with features', () => {
  assert.deepEqual(steps.map((s) => s.key), [
    `externalDatabase:${PRIMARY}`, `externalDatabaseRls:${PRIMARY}`, `sequences:${PRIMARY}`,
    `externalDatabase:${ORGANELLE}`, `externalDatabaseRls:${ORGANELLE}`, `sequences:${ORGANELLE}`,
    `isfPrint:${PRIMARY}`, `isfSet:${PRIMARY}`
  ]);
  assert.deepEqual(steps.map((s) => s.commit), [true, true, true, true, true, true, false, true]);
});

test('the external database and its release are the trial names, with --commit', () => {
  assert.deepEqual(byKey(`externalDatabase:${PRIMARY}`), {
    key: `externalDatabase:${PRIMARY}`, kind: 'externalDatabase', plugin: PLUGINS.externalDatabase, partition: PRIMARY,
    dir: `final/${PRIMARY}`, commit: true, args: ['--name', trialDb(PRIMARY), '--commit']
  });
  assert.deepEqual(byKey(`externalDatabaseRls:${PRIMARY}`).args, ['--databaseName', trialDb(PRIMARY), '--databaseVersion', RELEASE, '--commit']);
});

test('LoadFastaSequences takes the class arguments, and a chromosome map only where the partition has one', () => {
  assert.deepEqual(byKey(`sequences:${PRIMARY}`).args, [
    '--externalDatabaseName', trialDb(PRIMARY), '--externalDatabaseVersion', RELEASE, '--ncbiTaxId', '284813',
    '--sequenceFile', `/work/final/${PRIMARY}/genome.fasta`, '--chromosomeMapFile', `/work/final/${PRIMARY}/chromosomeMap.txt`,
    '--soTermName', 'chromosome', '--SOExtDbRlsSpec', 'SO_RSRC|%', '--regexSourceId', '^>(\\S+)',
    '--tableName', 'DoTS::ExternalNASequence', '--commit'
  ]);
  assert.deepEqual(byKey(`sequences:${ORGANELLE}`).args, [
    '--externalDatabaseName', trialDb(ORGANELLE), '--externalDatabaseVersion', RELEASE, '--ncbiTaxId', '284813',
    '--sequenceFile', `/work/final/${ORGANELLE}/genome.fasta`,
    '--soTermName', 'mitochondrial_chromosome', '--SOExtDbRlsSpec', 'SO_RSRC|%', '--regexSourceId', '^>(\\S+)',
    '--tableName', 'DoTS::ExternalNASequence', '--commit'
  ]);
});

const isfArgs = (kind, directive, postprocessingDir) => [
  '--extDbName', trialDb(PRIMARY), '--extDbRlsVer', RELEASE, '--mapFile', MAP_IN_IMAGE,
  '--inputFileOrDir', `/work/final/${PRIMARY}/genome.gff`, '--inputFileExtension', 'gff',
  '--chromosomeMapFile', `/work/final/${PRIMARY}/chromosomeMap.txt`,
  '--fileFormat', 'gff3', '--soExtDbSpec', 'SO_RSRC|%', '--defaultOrganism', '284813', '--seqSoTerm', 'chromosome',
  '--validationLog', `/work/trial/${PRIMARY}/${kind}.validation.log`, '--bioperlTreeOutput', `/work/trial/${PRIMARY}/${kind}.bioperlTree.out`,
  '--seqIdColumn', 'source_id', '--naSequenceSubclass', 'ExternalNASequence',
  '--postprocessingDirective', directive, '--postprocessingDir', postprocessingDir
];

test('ISF run 1 prints transcript IDs into trial/<p>/ without --commit; run 2 sets them from final/<p>/ with --commit', () => {
  assert.deepEqual(byKey(`isfPrint:${PRIMARY}`).args, isfArgs('isfPrint', 'PRINT_TRANSCRIPT_IDS', `/work/trial/${PRIMARY}/`));
  assert.deepEqual(byKey(`isfSet:${PRIMARY}`).args, [...isfArgs('isfSet', 'SET_TRANSCRIPT_IDS', `/work/final/${PRIMARY}/`), '--commit']);
  assert.equal(byKey(`isfSet:${PRIMARY}`).plugin, PLUGINS.isfSet);
});

test('a build with no features anywhere loads sequences only', () => {
  const bare = trialBuild();
  bare.partitions[0] = { ...bare.partitions[0], featureCount: 0, final: { ...bare.partitions[0].final, gff: null } };
  const kinds = planSteps(bare, { taxonId: TAXON_ID, release: RELEASE, gusHome: GUS_HOME }).map((s) => s.kind);
  assert.deepEqual([...new Set(kinds)], ['externalDatabase', 'externalDatabaseRls', 'sequences']);
});

test('features with no final GFF is a PipelineError, not a silent skip', () => {
  const broken = trialBuild();
  broken.partitions[0] = { ...broken.partitions[0], final: { ...broken.partitions[0].final, gff: null } };
  assert.throws(() => planSteps(broken, { taxonId: TAXON_ID, release: RELEASE, gusHome: GUS_HOME }),
    (e) => e instanceof PipelineError && e.problem === `${PRIMARY} has featureCount 2 but no final GFF`);
  broken.partitions[0].final.gff = undefined;
  assert.throws(() => planSteps(broken, { taxonId: TAXON_ID, release: RELEASE, gusHome: GUS_HOME }), PipelineError);
});

const attempt = (key, kind, plugin, commit, algInvocationId, status = 'done') => ({
  key, kind, plugin, partition: PRIMARY, commit, status, exitCode: status === 'done' ? 0 : 255, algInvocationId,
  log: `trial/logs/${key}.log`, startedAt: START.toISOString(), seconds: 1
});

test('undoPlan undoes every committed invocation newest first, ISF with its Undo, the rest with Community Undo', () => {
  const recorded = [
    attempt(`externalDatabase:${PRIMARY}`, 'externalDatabase', PLUGINS.externalDatabase, true, 7319),
    attempt(`externalDatabaseRls:${PRIMARY}`, 'externalDatabaseRls', PLUGINS.externalDatabaseRls, true, 7320),
    attempt(`sequences:${PRIMARY}`, 'sequences', PLUGINS.sequences, true, null, 'failed'),
    attempt(`sequences:${PRIMARY}`, 'sequences', PLUGINS.sequences, true, 7322),
    attempt(`isfPrint:${PRIMARY}`, 'isfPrint', PLUGINS.isfPrint, false, 7323),
    attempt(`isfSet:${PRIMARY}`, 'isfSet', PLUGINS.isfSet, true, 7324, 'failed'),
    attempt('qa', 'qa', null, false, null),
    attempt(`undo:isfSet:${PRIMARY}`, 'undo', ISF_UNDO, true, 7330)
  ];
  const step = (key, plugin, args) => ({ key, kind: 'undo', partition: PRIMARY, commit: true, plugin, args });
  assert.deepEqual(undoPlan(recorded, { gusHome: GUS_HOME }), [
    step(`undo:isfSet:${PRIMARY}`, ISF_UNDO, ['--mapFile', MAP_IN_IMAGE, '--algInvocationId', '7324', '--commit']),
    step(`undo:sequences:${PRIMARY}`, UNDO, ['--plugin', PLUGINS.sequences, '--algInvocationId', '7322', '--commit']),
    step(`undo:externalDatabaseRls:${PRIMARY}`, UNDO, ['--plugin', PLUGINS.externalDatabaseRls, '--algInvocationId', '7320', '--commit']),
    step(`undo:externalDatabase:${PRIMARY}`, UNDO, ['--plugin', PLUGINS.externalDatabase, '--algInvocationId', '7319', '--commit'])
  ]);
});

test('undoPlan skips an attempt whose invocation ID is null or missing', () => {
  const missing = attempt(`sequences:${PRIMARY}`, 'sequences', PLUGINS.sequences, true, undefined, 'failed');
  delete missing.algInvocationId;
  const recorded = [missing, attempt(`externalDatabase:${PRIMARY}`, 'externalDatabase', PLUGINS.externalDatabase, true, null)];
  assert.deepEqual(undoPlan(recorded, { gusHome: GUS_HOME }), []);
});
