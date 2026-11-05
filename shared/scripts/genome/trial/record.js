import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { GENERATOR } from '../record.js';
import { PipelineError, readJson, sha256File, writeJsonAtomic } from '../workdir.js';
import { partitionName } from './steps.js';

/** The trial.json contract; bump when its shape changes. */
export const TRIAL_SCHEMA_VERSION = 1;

export function trialPaths(workDir) {
  const trialDir = join(workDir, 'trial');
  return {
    trialDir,
    trialJson: join(trialDir, 'trial.json'),
    logOf: (key) => join(trialDir, 'logs', `${key}.log`),
    partitionDir: (name) => join(trialDir, name)
  };
}

/** final/ has no checksums from D, so the trial records the sha256 of each file it loads. */
export function loadedDigests(build, workDir) {
  return Object.fromEntries(build.partitions.map((part) => {
    const digest = (key) => (part.final[key] ? sha256File(join(workDir, part.dir, part.final[key])) : null);
    return [partitionName(part), { gff: digest('gff'), fasta: digest('fasta'), chromosomeMap: digest('chromosomeMap') }];
  }));
}

export function newTrialRecord({ genomeBuildSha256, loaded, release, taxonId, image, trialDatabases, startedAt }) {
  return {
    schemaVersion: TRIAL_SCHEMA_VERSION, generator: { ...GENERATOR }, genomeBuild: { sha256: genomeBuildSha256 }, loaded,
    image, database: null, release, taxonId, trialDatabases, startedAt,
    steps: [], findings: [], profile: {}, kept: false, undone: false
  };
}

export function readTrialRecord(path) {
  if (!existsSync(path)) return null;
  const record = readJson(path, 'trial', 'delete it if no trial rows are loaded, then run trial again');
  if (record?.schemaVersion !== TRIAL_SCHEMA_VERSION) {
    throw new PipelineError('trial', path, `has schemaVersion ${record?.schemaVersion}, not ${TRIAL_SCHEMA_VERSION}`,
      'undo it with the version of trial that wrote it, then delete it');
  }
  return record;
}

export function staleProblem(record, { genomeBuildSha256, loaded, taxonId }) {
  if (record.genomeBuild.sha256 !== genomeBuildSha256 || JSON.stringify(record.loaded) !== JSON.stringify(loaded)) return 'trial is for an older build';
  if (record.taxonId !== taxonId) return `trial ran with --taxonId ${record.taxonId}`;
  return null;
}

export const lastAttempt = (record, key) => record.steps.filter((s) => s.key === key).at(-1) ?? null;
export const isDone = (record, key) => lastAttempt(record, key)?.status === 'done';

/** A step that ran with --commit and failed after its invocation existed may have left rows; resuming would load them twice. */
export function committedFailure(record) {
  const keys = [...new Set(record.steps.map((s) => s.key))];
  return keys.map((key) => lastAttempt(record, key))
    .find((s) => s.status === 'failed' && s.commit && s.kind !== 'undo' && s.algInvocationId !== null) ?? null;
}

export const saveTrialRecord = (path, record) => writeJsonAtomic(path, record);
