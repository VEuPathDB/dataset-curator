import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GENERATOR } from '../shared/scripts/genome/record.js';
import {
  committedFailure, isDone, lastAttempt, loadedDigests, newTrialRecord, readTrialRecord, saveTrialRecord, staleProblem, trialPaths,
  TRIAL_SCHEMA_VERSION
} from '../shared/scripts/genome/trial/record.js';
import { PipelineError, sha256 } from '../shared/scripts/genome/workdir.js';
import { tempDir } from './genome-helpers.js';
import {
  IMAGE, ORGANELLE, ORGANELLE_FASTA, PRIMARY, PRIMARY_CHROMOSOME_MAP, PRIMARY_FASTA, PRIMARY_GFF, RELEASE, START, TAXON_ID, trialBuild,
  trialDb, trialWorkDir
} from './genome-trial-helpers.js';

const LOADED = {
  [PRIMARY]: { gff: sha256(PRIMARY_GFF), fasta: sha256(PRIMARY_FASTA), chromosomeMap: sha256(PRIMARY_CHROMOSOME_MAP) },
  [ORGANELLE]: { gff: null, fasta: sha256(ORGANELLE_FASTA), chromosomeMap: null }
};
const fresh = () => newTrialRecord({
  genomeBuildSha256: 'b'.repeat(64), loaded: LOADED, release: RELEASE, taxonId: TAXON_ID, startedAt: START.toISOString(),
  image: { name: IMAGE, digest: 'sha256:1', apiCommonDataCommit: null, modelTag: null, schemaFingerprint: null },
  trialDatabases: { [PRIMARY]: trialDb(PRIMARY), [ORGANELLE]: trialDb(ORGANELLE) }
});
const attempt = (key, fields) => ({ key, kind: key.split(':')[0], plugin: 'p', partition: PRIMARY, commit: true, status: 'done', exitCode: 0, algInvocationId: 1, log: null, startedAt: null, seconds: 1, ...fields });

test('trialPaths puts trial.json, logs and per-partition files under <workDir>/trial', () => {
  const p = trialPaths('/w');
  assert.equal(p.trialDir, '/w/trial');
  assert.equal(p.trialJson, '/w/trial/trial.json');
  assert.equal(p.logOf(`isfSet:${PRIMARY}`), `/w/trial/logs/isfSet:${PRIMARY}.log`);
  assert.equal(p.partitionDir(PRIMARY), `/w/trial/${PRIMARY}`);
});

test('loadedDigests hashes the final/ files each partition loads, null where it has none', () => {
  const { workDir } = trialWorkDir();
  assert.deepEqual(loadedDigests(trialBuild(), workDir), LOADED);
});

test('a new record starts with no steps, findings or profile, neither kept nor undone', () => {
  assert.deepEqual(fresh(), {
    schemaVersion: TRIAL_SCHEMA_VERSION, generator: { ...GENERATOR }, genomeBuild: { sha256: 'b'.repeat(64) }, loaded: LOADED,
    image: { name: IMAGE, digest: 'sha256:1', apiCommonDataCommit: null, modelTag: null, schemaFingerprint: null },
    database: null, release: RELEASE, taxonId: TAXON_ID, trialDatabases: { [PRIMARY]: trialDb(PRIMARY), [ORGANELLE]: trialDb(ORGANELLE) },
    startedAt: START.toISOString(), steps: [], findings: [], profile: {}, kept: false, undone: false
  });
});

test('saveTrialRecord writes atomically and readTrialRecord reads it back; no file reads as null', () => {
  const dir = tempDir('trial-record-');
  const path = join(dir, 'trial', 'trial.json');
  assert.equal(readTrialRecord(path), null);
  const record = fresh();
  saveTrialRecord(path, record);
  assert.deepEqual(readTrialRecord(path), record);
  assert.equal(existsSync(`${path}.part`), false);
});

test('readTrialRecord refuses another schemaVersion', () => {
  const dir = tempDir('trial-record-');
  mkdirSync(join(dir, 'trial'));
  const path = join(dir, 'trial', 'trial.json');
  writeFileSync(path, JSON.stringify({ ...fresh(), schemaVersion: 2 }));
  assert.throws(() => readTrialRecord(path), (e) => e instanceof PipelineError && e.problem === 'has schemaVersion 2, not 1');
});

test('staleProblem: D output or the taxon changed since the trial started', () => {
  const record = fresh();
  const now = { genomeBuildSha256: 'b'.repeat(64), loaded: LOADED, taxonId: TAXON_ID };
  assert.equal(staleProblem(record, now), null);
  assert.equal(staleProblem(record, { ...now, genomeBuildSha256: 'c'.repeat(64) }), 'trial is for an older build');
  assert.equal(staleProblem(record, { ...now, loaded: { ...LOADED, [ORGANELLE]: { ...LOADED[ORGANELLE], fasta: 'x' } } }), 'trial is for an older build');
  assert.equal(staleProblem(record, { ...now, taxonId: 6035 }), `trial ran with --taxonId ${TAXON_ID}`);
});

test('the last attempt of a key decides whether it is done', () => {
  const record = { ...fresh(), steps: [attempt('sequences:p', { status: 'failed', algInvocationId: null }), attempt('sequences:p', {})] };
  assert.equal(isDone(record, 'sequences:p'), true);
  assert.equal(lastAttempt(record, 'isfSet:p'), null);
  assert.equal(isDone(record, 'isfSet:p'), false);
});

test('committedFailure finds a committed step whose last attempt failed after logging an invocation', () => {
  const ok = { ...fresh(), steps: [attempt('isfPrint:p', { commit: false, status: 'failed' }), attempt('sequences:p', { status: 'failed', algInvocationId: null })] };
  assert.equal(committedFailure(ok), null);
  const bad = { ...fresh(), steps: [attempt('isfSet:p', { status: 'failed', algInvocationId: 7326 })] };
  assert.equal(committedFailure(bad).algInvocationId, 7326);
  const undo = { ...fresh(), steps: [attempt('undo:isfSet:p', { kind: 'undo', status: 'failed', algInvocationId: 7330 })] };
  assert.equal(committedFailure(undo), null);
});
