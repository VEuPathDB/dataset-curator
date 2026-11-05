import { basename, posix } from 'node:path';
import { MAP_PATH } from '../preprocess-gff3.js';
import { PipelineError } from '../workdir.js';
import { inWork } from './gus.js';

export const PLUGINS = Object.freeze({
  externalDatabase: 'GUS::Supported::Plugin::InsertExternalDatabase',
  externalDatabaseRls: 'GUS::Supported::Plugin::InsertExternalDatabaseRls',
  sequences: 'GUS::Supported::Plugin::LoadFastaSequences',
  isfPrint: 'GUS::Supported::Plugin::InsertSequenceFeatures',
  isfSet: 'GUS::Supported::Plugin::InsertSequenceFeatures'
});
export const ISF_UNDO = 'GUS::Supported::Plugin::InsertSequenceFeaturesUndo';
export const UNDO = 'GUS::Community::Plugin::Undo';
export const ISF_KINDS = new Set(['isfPrint', 'isfSet']);
export const TRANSCRIPT_IDS = 'transcriptIds';
export const TRANSCRIPT_INFO = 'transcriptInfoAndIds';

export const partitionName = (part) => basename(part.dir);
export const trialDatabaseName = (accession, part) => `curatorTrial_${accession}_${partitionName(part)}_RSRC`;
export const releaseVersion = (date) => date.toISOString().slice(0, 19).replace(/[-:]/g, '');
export const isfMapIn = (gusHome) => posix.join(gusHome, 'lib/xml/isf', posix.basename(MAP_PATH));
export const stepKey = (kind, partition) => `${kind}:${partition}`;
export const isfFiles = (kind, partition) => ({
  validationLog: `trial/${partition}/${kind}.validation.log`,
  bioperlTree: `trial/${partition}/${kind}.bioperlTree.out`
});

/** Sequences for every partition, then ISF run 1 and run 2 where ISF loads anything: cheap failures first. */
export function planSteps(build, { taxonId, release, gusHome }) {
  const parts = build.partitions.map((part) => ({ part, name: partitionName(part), database: trialDatabaseName(build.accession, part) }));
  for (const p of parts) {
    if (p.part.featureCount > 0 && p.part.final.gff == null) {
      throw new PipelineError('trial', 'genome-build.json', `${p.name} has featureCount ${p.part.featureCount} but no final GFF`, 'build and finalize the genome again');
    }
  }
  const step = (kind, p, args) => ({
    key: stepKey(kind, p.name), kind, plugin: PLUGINS[kind], partition: p.name, dir: p.part.dir,
    commit: kind !== 'isfPrint', args: kind === 'isfPrint' ? args : [...args, '--commit']
  });
  const file = (p, key) => inWork(p.part.dir, p.part.final[key]);
  const chromosomeMap = (p) => (p.part.final.chromosomeMap ? ['--chromosomeMapFile', file(p, 'chromosomeMap')] : []);
  const sequences = parts.flatMap((p) => [
    step('externalDatabase', p, ['--name', p.database]),
    step('externalDatabaseRls', p, ['--databaseName', p.database, '--databaseVersion', release]),
    step('sequences', p, [
      '--externalDatabaseName', p.database, '--externalDatabaseVersion', release, '--ncbiTaxId', String(taxonId),
      '--sequenceFile', file(p, 'fasta'), ...chromosomeMap(p), '--soTermName', p.part.soTerm,
      '--SOExtDbRlsSpec', 'SO_RSRC|%', '--regexSourceId', '^>(\\S+)', '--tableName', 'DoTS::ExternalNASequence'
    ])
  ]);
  const annotated = parts.filter((p) => p.part.featureCount > 0);
  const isf = (kind, directive, postprocessingDir) => annotated.map((p) => {
    const files = isfFiles(kind, p.name);
    return step(kind, p, [
      '--extDbName', p.database, '--extDbRlsVer', release, '--mapFile', isfMapIn(gusHome),
      '--inputFileOrDir', file(p, 'gff'), '--inputFileExtension', 'gff', ...chromosomeMap(p),
      '--fileFormat', 'gff3', '--soExtDbSpec', 'SO_RSRC|%', '--defaultOrganism', String(taxonId), '--seqSoTerm', p.part.soTerm,
      '--validationLog', inWork(files.validationLog), '--bioperlTreeOutput', inWork(files.bioperlTree),
      '--seqIdColumn', 'source_id', '--naSequenceSubclass', 'ExternalNASequence',
      '--postprocessingDirective', directive, '--postprocessingDir', `${postprocessingDir(p)}/`
    ]);
  });
  return [
    ...sequences,
    ...isf('isfPrint', 'PRINT_TRANSCRIPT_IDS', (p) => inWork('trial', p.name)),
    ...isf('isfSet', 'SET_TRANSCRIPT_IDS', (p) => inWork(p.part.dir))
  ];
}

/** Every committed invocation, failed or not, newest first. isfPrint never commits, so it has nothing to undo. */
export function undoPlan(steps, { gusHome }) {
  return steps
    .filter((s) => s.commit && s.kind !== 'undo' && s.algInvocationId != null)
    .reverse()
    .map((s) => ({
      key: `undo:${s.key}`, kind: 'undo', partition: s.partition, commit: true,
      plugin: ISF_KINDS.has(s.kind) ? ISF_UNDO : UNDO,
      args: ISF_KINDS.has(s.kind)
        ? ['--mapFile', isfMapIn(gusHome), '--algInvocationId', String(s.algInvocationId), '--commit']
        : ['--plugin', s.plugin, '--algInvocationId', String(s.algInvocationId), '--commit']
    }));
}
