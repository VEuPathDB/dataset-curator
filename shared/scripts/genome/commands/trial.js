import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, rmdirSync, rmSync, statSync, writeSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { defaultExec } from '../../lib/tools/exec.js';
import { BUILD_FILES, SCHEMA_VERSION } from '../record.js';
import { hostUser, inspectImage, readImageFile, runGa, selectRows, tail } from '../trial/gus.js';
import { ensureModelImage } from '../trial/model-image.js';
import { profileDiff, profileEntry, profileSource, releasesSql, snapshot, sqlString } from '../trial/qa.js';
import {
  committedFailure, isDone, loadedDigests, newTrialRecord, readTrialRecord, recoverInvocationIds, saveTrialRecord, staleProblem, trialPaths
} from '../trial/record.js';
import {
  ISF_KINDS, isfMapIn, partitionName, planSteps, releaseVersion, stepKey, TRANSCRIPT_IDS, TRANSCRIPT_INFO, trialDatabaseName
} from '../trial/steps.js';
import { PipelineError, readJson, sha256, sha256File, workPaths } from '../workdir.js';

export const DATABASE_SQL = '-- trial:database\nSELECT current_database() AS name';
export const SO_SQL = '-- trial:soRelease\nSELECT count(*) AS n FROM sres.externaldatabase d'
  + " JOIN sres.externaldatabaserelease r ON r.external_database_id = d.external_database_id WHERE d.name = 'SO_RSRC'";
export const taxonSql = (taxonId) => '-- trial:taxon\nSELECT t.taxon_id, t.genetic_code_id,'
  + ' (SELECT count(*) FROM sres.geneticcode g WHERE g.genetic_code_id = t.genetic_code_id) AS codes'
  + ` FROM sres.taxon t WHERE t.ncbi_tax_id = ${Number(taxonId)}`;
const likeEscape = (text) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Every external database this accession's trials create, matched exactly: `_` is a LIKE wildcard, so it is escaped. */
export const leftoverDatabasesSql = (accession) => '-- trial:leftoverDatabases\nSELECT d.name FROM sres.externaldatabase d'
  + ` WHERE d.name LIKE ${sqlString(`${likeEscape('curatorTrial_')}${likeEscape(accession)}${likeEscape('_')}%`)} ESCAPE '\\'`
  + ' ORDER BY d.name';
const REFINALIZE = 'run build and finalize again';
const GUS_CONFIG_NEXT = 'pass --gusConfig <the gus.config naming the target database>';

export function checkTrialOptions({ image, gusConfig, taxonId }, { undo = false } = {}) {
  if (!image) throw new PipelineError('trial', '--image', 'is required', 'pass --image <a gus_isf image>');
  if (!gusConfig) throw new PipelineError('trial', '--gusConfig', 'is required', GUS_CONFIG_NEXT);
  if (!existsSync(gusConfig)) throw new PipelineError('trial', gusConfig, 'is missing', GUS_CONFIG_NEXT);
  if (!statSync(gusConfig).isFile()) throw new PipelineError('trial', gusConfig, 'is not a file', GUS_CONFIG_NEXT);
  if (!undo && !(Number.isInteger(taxonId) && taxonId > 0)) {
    throw new PipelineError('trial', '--taxonId', 'must be an NCBI taxon id', 'pass --taxonId <ncbi taxon id>');
  }
}

/** genome-build.json as finalize wrote it, every final/ file it lists, and the build GFF3 QA reads gene trees from. */
export function readGenomeBuild(workDir) {
  const p = workPaths(workDir);
  const build = readJson(p.genomeBuildJson, 'trial', 'run finalize first');
  if (build?.schemaVersion !== SCHEMA_VERSION) {
    throw new PipelineError('trial', p.genomeBuildJson, `has schemaVersion ${build?.schemaVersion}, not ${SCHEMA_VERSION}`, REFINALIZE);
  }
  const complete = /^[\w.]+$/.test(build.accession ?? '') && typeof build.apiCommonData?.isfMap?.sha256 === 'string'
    && Array.isArray(build.partitions) && build.partitions.length > 0
    && build.partitions.every((part) => typeof part?.dir === 'string' && part.final && typeof part.soTerm === 'string' && Number.isInteger(part.featureCount));
  if (!complete) throw new PipelineError('trial', p.genomeBuildJson, 'is incomplete: it needs accession, apiCommonData.isfMap.sha256 and partitions', REFINALIZE);
  for (const part of build.partitions) {
    for (const name of Object.values(part.final).filter(Boolean)) {
      const file = join(workDir, part.dir, name);
      if (!existsSync(file) || statSync(file).size === 0) throw new PipelineError('trial', file, 'is missing or empty', 'run finalize again');
    }
    const gff3 = join(p.buildDir, partitionName(part), BUILD_FILES.gff3);
    if (part.featureCount > 0 && (!existsSync(gff3) || sha256File(gff3) !== part.buildFiles?.gff3)) {
      throw new PipelineError('trial', gff3, 'does not match genome-build.json', REFINALIZE);
    }
  }
  return { build, sha256: sha256File(p.genomeBuildJson) };
}

export function imageInfo(image, { exec }) {
  const info = inspectImage(image, { exec });
  if (!info) throw new PipelineError('trial', image, 'is not a local Docker image', 'build gus_isf (docker-tools gus_isf/Dockerfile) and tag it, or pass another --image');
  if (!info.gusHome) throw new PipelineError('trial', image, 'sets no GUS_HOME', 'pass a gus_isf image');
  return info;
}

export function checkImageMap(image, gusHome, build, { exec }) {
  const text = readImageFile(image, isfMapIn(gusHome), { exec });
  if (text === null || sha256(text) !== build.apiCommonData.isfMap.sha256) {
    throw new PipelineError('trial', `${image}:${isfMapIn(gusHome)}`, 'differs from the ISF map genome-build.json was built against',
      'use a gus_isf image built at the ApiCommonData commit finalize used, or run build and finalize with this one');
  }
}

export const contextOf = ({ workDir, image, gusConfig, user }, gusHome) =>
  ({ workDir: resolve(workDir), image, gusHome, gusConfig: resolve(gusConfig), user });

export function currentDatabase(ctx, expected, { exec }) {
  const database = selectRows(ctx, DATABASE_SQL, { exec, mounted: true })[0]?.name ?? null;
  if (expected && database !== expected) {
    throw new PipelineError('trial', ctx.gusConfig, `names database ${database}, but the trial loaded into ${expected}`,
      `pass the gus.config for ${expected}; to remove a half-loaded trial, run trial --undo with it`);
  }
  return database;
}

/** The global rows the trial reads (SO, taxon, genetic code), and, for a fresh trial, no database or release left by an earlier one. */
export function preflightReferenceData(ctx, { database, accession, taxonId, names, release, fresh }, { exec }) {
  const select = (sql) => selectRows(ctx, sql, { exec, mounted: true });
  if (Number(select(SO_SQL)[0]?.n ?? 0) === 0) {
    throw new PipelineError('trial', database, 'has no SO_RSRC release', 'load the Sequence Ontology (InsertSequenceOntologyOBO), or use a seeded database');
  }
  const [taxon] = select(taxonSql(taxonId));
  if (!taxon) throw new PipelineError('trial', database, `has no sres.taxon row for NCBI taxon ${taxonId}`, 'check --taxonId, or load the taxon (LoadTaxon or a taxonomy patch)');
  if (taxon.genetic_code_id === null || Number(taxon.codes) === 0) {
    throw new PipelineError('trial', database, `has no genetic code for NCBI taxon ${taxonId}`, 'load NCBI genetic codes with the taxonomy');
  }
  if (!fresh) return;
  const leftover = select(leftoverDatabasesSql(accession));
  if (leftover.length) {
    throw new PipelineError('trial', database, `already has trial database ${leftover.map((r) => r.name).join(', ')}`,
      'InsertExternalDatabase would reuse it and its Undo would delete nothing: run trial --undo for the earlier trial, or remove the rows by hand');
  }
  const existing = select(releasesSql(names, release));
  if (existing.length) {
    throw new PipelineError('trial', database, `already has release ${release} of ${existing.map((r) => r.name).join(', ')}`,
      'run trial --undo, or run trial again in a second');
  }
}

const RESUME_OR_UNDO = 'fix the cause, then run trial again to resume, or trial --undo to remove what it loaded';
const UNDO_FIRST = 'run trial --undo, then trial again';

/** O_EXCL makes the lock exclusive; whoever creates it removes it, and a refused run leaves the holder's alone. */
export function acquireTrialLock(paths) {
  const lock = join(paths.trialDir, '.lock');
  mkdirSync(paths.trialDir, { recursive: true });
  let fd;
  try {
    fd = openSync(lock, 'wx');
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    let holder = 'another trial';
    let who = 'the process that wrote it';
    try {
      const { pid, startedAt } = JSON.parse(readFileSync(lock, 'utf-8'));
      holder = `trial process ${pid}, started ${startedAt}`;
      who = `process ${pid}`;
    } catch { /* an unreadable lock is still a lock */ }
    throw new PipelineError('trial', lock, `is held by ${holder}`, `wait for ${who} to end; once it is gone, delete this lock file`);
  }
  try {
    writeSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  } finally {
    closeSync(fd);
  }
  return () => {
    rmSync(lock, { force: true });
    try {
      rmdirSync(paths.trialDir);
    } catch { /* it holds the record or logs */ }
  };
}

function useModelImage(record, ctx, env) {
  const model = ensureModelImage(ctx, record.database, { exec: env.exec, logPath: env.paths.logOf('modelImage') });
  record.image = { ...record.image, modelTag: model.modelTag, schemaFingerprint: model.schemaFingerprint };
  env.save();
  return { ...ctx, image: model.modelTag };
}

/** One ga run, recorded as an attempt saved as `running` first, so a crash leaves its log to recover the invocation from. */
function runStep(record, step, ctx, env, next) {
  const logPath = env.paths.logOf(step.key);
  const started = env.now();
  const attempt = {
    key: step.key, kind: step.kind, plugin: step.plugin, partition: step.partition, commit: step.commit,
    status: 'running', exitCode: null, algInvocationId: null, log: relative(env.workDir, logPath), startedAt: started.toISOString(), seconds: null
  };
  record.steps.push(attempt);
  env.save();
  const { exitCode, algInvocationId, log } = runGa(ctx, step, logPath, { exec: env.exec });
  const ok = exitCode === 0 && algInvocationId !== null;
  Object.assign(attempt, { status: ok ? 'done' : 'failed', exitCode, algInvocationId, seconds: (env.now() - started) / 1000 });
  env.save();
  if (ok) return attempt;
  const why = exitCode === 0 ? 'logged no AlgInvocationId' : `exited ${exitCode}`;
  const loadedRows = step.commit && algInvocationId != null;
  throw new PipelineError('trial', logPath, `${step.key} (${step.plugin}) ${why}; last lines of its log:\n${tail(log)}`, loadedRows ? UNDO_FIRST : next);
}

function copyTranscriptIds(from, to) {
  if (!existsSync(from) || statSync(from).size === 0) {
    throw new PipelineError('trial', from, 'is missing or empty after a successful PRINT_TRANSCRIPT_IDS run', RESUME_OR_UNDO);
  }
  copyFileSync(from, to);
}

function runForward(record, build, ctx, env) {
  const select = (sql) => selectRows(ctx, sql, { exec: env.exec });
  let source = null;
  for (const step of planSteps(build, { taxonId: record.taxonId, release: record.release, gusHome: ctx.gusHome })) {
    const printed = join(env.workDir, step.dir, TRANSCRIPT_INFO);
    const reprint = step.kind === 'isfPrint' && !existsSync(printed) && !isDone(record, stepKey('isfSet', step.partition));
    if (isDone(record, step.key) && !reprint) continue;
    const isf = ISF_KINDS.has(step.kind);
    const transcriptIds = join(env.paths.partitionDir(step.partition), TRANSCRIPT_IDS);
    if (isf) mkdirSync(env.paths.partitionDir(step.partition), { recursive: true });
    if (step.kind === 'isfPrint') rmSync(transcriptIds, { force: true });
    if (isf && !source) source = profileSource(select);
    const before = isf ? snapshot(source, select) : null;
    const attempt = runStep(record, step, ctx, env, RESUME_OR_UNDO);
    if (step.kind === 'isfPrint') copyTranscriptIds(transcriptIds, printed);
    if (isf) {
      const genes = build.partitions.find((part) => partitionName(part) === step.partition).featureCount;
      record.profile[step.key] = profileEntry(profileDiff(source, before, snapshot(source, select)), { seconds: attempt.seconds, genes });
      env.save();
    }
  }
}

/** A trial.json that may be resumed: D's output and --taxonId unchanged, nothing committed that failed or was cut off. */
function checkResumable(record, { workDir, genomeBuildSha256, loaded, taxonId, trialJson }) {
  const problem = staleProblem(record, { genomeBuildSha256, loaded, taxonId });
  if (problem) throw new PipelineError('trial', trialJson, problem, UNDO_FIRST);
  recoverInvocationIds(record, workDir);
  const failed = committedFailure(record);
  if (failed) {
    saveTrialRecord(trialJson, record);
    throw new PipelineError('trial', join(workDir, failed.log), `${failed.key} failed after loading rows (AlgInvocationId ${failed.algInvocationId ?? 'not logged'})`, UNDO_FIRST);
  }
  for (const attempt of record.steps) if (attempt.status === 'running') attempt.status = 'failed';
}

function startOrResume({ workDir, image, gusConfig, taxonId, keep, exec, now, user }, { build, genomeBuildSha256, paths }) {
  const loaded = loadedDigests(build, workDir);
  const previous = readTrialRecord(paths.trialJson);
  const resuming = previous !== null && !previous.undone;
  if (resuming) checkResumable(previous, { workDir, genomeBuildSha256, loaded, taxonId, trialJson: paths.trialJson });
  const info = imageInfo(image, { exec });
  if (resuming && info.id !== previous.image.digest) {
    throw new PipelineError('trial', image, `is not the image the trial started with (${previous.image.digest})`,
      'pass the original --image to resume, or run trial --undo with it');
  }
  checkImageMap(image, info.gusHome, build, { exec });
  const ctx = contextOf({ workDir, image, gusConfig, user }, info.gusHome);
  const startedAt = now();
  const record = resuming ? previous : newTrialRecord({
    genomeBuildSha256, loaded, taxonId, release: releaseVersion(startedAt), startedAt: startedAt.toISOString(),
    trialDatabases: Object.fromEntries(build.partitions.map((part) => [partitionName(part), trialDatabaseName(build.accession, part)])),
    image: {
      name: image, digest: info.id, apiCommonDataCommit: readImageFile(image, `${info.gusHome}/APICOMMONDATA_COMMIT`, { exec })?.trim() ?? null,
      modelTag: null, schemaFingerprint: null
    }
  });
  record.database = currentDatabase(ctx, resuming ? record.database : null, { exec });
  preflightReferenceData(ctx, {
    database: record.database, accession: build.accession, taxonId, names: Object.values(record.trialDatabases), release: record.release, fresh: !resuming
  }, { exec });
  return { record, ctx };
}

export async function runTrial(options) {
  const { workDir, image, gusConfig, taxonId, keep = false, exec = defaultExec, now = () => new Date(), user = hostUser() } = options;
  checkTrialOptions({ image, gusConfig, taxonId });
  const paths = trialPaths(workDir);
  const { build, sha256: genomeBuildSha256 } = readGenomeBuild(workDir);
  const release = acquireTrialLock(paths);
  try {
    const { record, ctx } = startOrResume({ workDir, image, gusConfig, taxonId, keep, exec, now, user }, { build, genomeBuildSha256, paths });
    const env = { exec, now, workDir, paths, save: () => saveTrialRecord(paths.trialJson, record) };
    runForward(record, build, useModelImage(record, ctx, env), env);
    record.kept = keep;
    env.save();
    return record;
  } finally {
    release();
  }
}
