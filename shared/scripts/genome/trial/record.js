import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GENERATOR } from '../record.js';
import { PipelineError, readJson, sha256File, writeJsonAtomic } from '../workdir.js';
import { parseAlgInvocationId } from './gus.js';
import { partitionName } from '../genome-build.js';

/** The trial.json contract; bump when its shape changes. */
export const TRIAL_SCHEMA_VERSION = 2;

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
    const digest = (key) => {
      if (!part.final[key]) return null;
      const path = join(workDir, part.dir, part.final[key]);
      if (!existsSync(path)) throw new PipelineError('trial', path, 'is missing', 'finalize the genome again, then run trial');
      return sha256File(path);
    };
    return [partitionName(part), { gff: digest('gff'), fasta: digest('fasta'), chromosomeMap: digest('chromosomeMap') }];
  }));
}

export function newTrialRecord({ genomeBuildSha256, loaded, release, taxonId, image, trialDatabases, startedAt }) {
  return {
    schemaVersion: TRIAL_SCHEMA_VERSION, generator: { ...GENERATOR }, genomeBuild: { sha256: genomeBuildSha256 }, loaded,
    image, database: null, release, taxonId, trialDatabases, startedAt,
    steps: [], outputs: {}, findings: [], profile: {}, kept: false, undone: false, result: 'incomplete'
  };
}

const UNREADABLE_NEXT = 'if trial rows may be loaded, read the AlgInvocationId lines in trial/logs/*.log and undo those invocations, then delete it';
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** The first required field the record lacks, or null. */
function missingField(record) {
  const checks = {
    genomeBuild: isObject(record.genomeBuild) && typeof record.genomeBuild.sha256 === 'string',
    loaded: isObject(record.loaded),
    image: isObject(record.image) && typeof record.image.digest === 'string',
    release: typeof record.release === 'string',
    taxonId: record.taxonId != null,
    trialDatabases: isObject(record.trialDatabases),
    startedAt: typeof record.startedAt === 'string',
    steps: Array.isArray(record.steps) && record.steps.every((s) => isObject(s) && typeof s.key === 'string'),
    outputs: isObject(record.outputs),
    findings: Array.isArray(record.findings),
    profile: isObject(record.profile)
  };
  return Object.keys(checks).find((field) => !checks[field]) ?? null;
}

export function readTrialRecord(path) {
  if (!existsSync(path)) return null;
  const record = readJson(path, 'trial', UNREADABLE_NEXT);
  if (record?.schemaVersion < TRIAL_SCHEMA_VERSION) {
    throw new PipelineError('trial', path, `has schemaVersion ${record.schemaVersion}: written by an older trial`,
      'run trial --undo with the older version or delete it if nothing is loaded');
  }
  if (record?.schemaVersion !== TRIAL_SCHEMA_VERSION) {
    throw new PipelineError('trial', path, `has schemaVersion ${record?.schemaVersion}, not ${TRIAL_SCHEMA_VERSION}`,
      'undo it with the version of trial that wrote it, then delete it');
  }
  const field = missingField(record);
  if (field) throw new PipelineError('trial', path, `is missing or has a malformed ${field}`, UNREADABLE_NEXT);
  return record;
}

export function staleProblem(record, { genomeBuildSha256, loaded, taxonId }) {
  if (record.genomeBuild.sha256 !== genomeBuildSha256 || JSON.stringify(record.loaded) !== JSON.stringify(loaded)) return 'trial is for an older build';
  if (record.taxonId !== taxonId) return `trial ran with --taxonId ${record.taxonId}`;
  return null;
}

export const lastAttempt = (record, key) => record.steps.filter((s) => s.key === key).at(-1) ?? null;
export const isDone = (record, key) => lastAttempt(record, key)?.status === 'done';

/** A run that died before its result was saved still has its AlgInvocationId in the log. */
export function recoverInvocationIds(record, workDir) {
  for (const attempt of record.steps) {
    if (attempt.status !== 'running' || attempt.algInvocationId != null || !attempt.log) continue;
    const log = join(workDir, attempt.log);
    if (existsSync(log)) attempt.algInvocationId = parseAlgInvocationId(readFileSync(log, 'utf-8'));
  }
}

/**
 * A step that ran with --commit and failed after its invocation existed may have left rows; resuming would load them twice.
 * An attempt still `running` was cut off at an unknown point, and one that exited 0 without a parsable ID may have committed, so both count the same.
 */
export function committedFailure(record) {
  const keys = [...new Set(record.steps.map((s) => s.key))];
  return keys.map((key) => lastAttempt(record, key))
    .find((s) => s.commit && s.kind !== 'undo' && (s.status === 'running' || (s.status === 'failed' && (s.algInvocationId != null || s.exitCode === 0)))) ?? null;
}

/** passed: every step done, QA run, no error finding. failed: an error finding or a step whose last attempt failed. Otherwise incomplete. */
export function trialResult(record) {
  const last = [...new Set(record.steps.map((s) => s.key))].map((key) => lastAttempt(record, key));
  if (record.findings.some((f) => f.severity === 'error') || last.some((s) => s.status === 'failed')) return 'failed';
  return last.every((s) => s.status === 'done') && isDone(record, 'qa') ? 'passed' : 'incomplete';
}

export function saveTrialRecord(path, record) {
  record.result = trialResult(record);
  writeJsonAtomic(path, record);
}
