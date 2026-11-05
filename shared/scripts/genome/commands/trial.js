import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, rmdirSync, rmSync, statSync, writeSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { defaultExec } from '../../lib/tools/exec.js';
import { BUILD_FILES, SCHEMA_VERSION } from '../record.js';
import { finding } from '../checks.js';
import { containerName, hostUser, inspectImage, readImageFile, removeContainer, runGa, runningContainers, selectRows, tail } from '../trial/gus.js';
import { ensureModelImage } from '../trial/model-image.js';
import {
  expectedModels, genesSql, internalStopsSql, invocationRowFindings, invocationRowsSql, leftoversSql, parseTranscriptInfo, profileDiff, profileEntry,
  profileFindings, profileSource, qaFindings, releasesSql, snapshot, sqlList, sqlString, TABLES_PROBE, transcriptsSql
} from '../trial/qa.js';
import {
  committedFailure, isDone, loadedDigests, newTrialRecord, readTrialRecord, recoverInvocationIds, saveTrialRecord, staleProblem, trialPaths
} from '../trial/record.js';
import {
  ISF_KINDS, isfFiles, isfMapIn, partitionName, planSteps, releaseVersion, stepKey, TRANSCRIPT_IDS, TRANSCRIPT_INFO, trialDatabaseName, undoPlan
} from '../trial/steps.js';
import { PipelineError, readJson, readText, sha256, sha256File, workPaths } from '../workdir.js';

export const DATABASE_SQL = '-- trial:database\nSELECT current_database() AS name';
export const SO_SQL = '-- trial:soRelease\nSELECT count(*) AS n FROM sres.externaldatabase d'
  + " JOIN sres.externaldatabaserelease r ON r.external_database_id = d.external_database_id WHERE d.name = 'SO_RSRC'";
export const taxonSql = (taxonId) => '-- trial:taxon\nSELECT t.taxon_id, t.genetic_code_id,'
  + ' (SELECT count(*) FROM sres.geneticcode g WHERE g.genetic_code_id = t.genetic_code_id) AS codes'
  + ` FROM sres.taxon t WHERE t.ncbi_tax_id = ${Number(taxonId)}`;

/** Every external database this accession's trials create. A prefix compare, not LIKE, so `_` is not a wildcard. */
export const leftoverDatabasesSql = (accession) => {
  const prefix = `curatorTrial_${accession}_`;
  return '-- trial:leftoverDatabases\nSELECT d.name FROM sres.externaldatabase d'
    + ` WHERE left(d.name, ${prefix.length}) = ${sqlString(prefix)} ORDER BY d.name`;
};
/** Sequences already loaded under these IDs; dots.nasequenceimp.source_id is unique across the whole database. */
export const takenSourceIdsSql = (ids) => '-- trial:takenSourceIds\nSELECT s.source_id, d.name FROM dots.nasequenceimp s'
  + ' LEFT JOIN sres.externaldatabaserelease r ON r.external_database_release_id = s.external_database_release_id'
  + ' LEFT JOIN sres.externaldatabase d ON d.external_database_id = r.external_database_id'
  + ` WHERE s.source_id IN (${sqlList(ids)}) ORDER BY s.source_id`;
const SOURCE_ID_BATCH = 1000;

/** The IDs LoadFastaSequences takes (--regexSourceId '^>(\S+)') from every partition's final FASTA. */
export function fastaSourceIds(build, workDir) {
  return build.partitions.flatMap((part) => headerIds(join(workDir, part.dir, part.final.fasta)));
}

/** Read in chunks: a genome FASTA can be larger than a string may be. */
function headerIds(file) {
  const ids = [];
  const fd = openSync(file, 'r');
  const buffer = Buffer.alloc(1 << 20);
  let carry = '';
  try {
    for (let n; (n = readSync(fd, buffer, 0, buffer.length, null)) > 0;) {
      const lines = (carry + buffer.toString('latin1', 0, n)).split('\n');
      carry = lines.pop();
      if (carry.length > 1 << 16 && !carry.startsWith('>')) carry = '';
      for (const line of lines) if (line.startsWith('>')) ids.push(line.match(/^>(\S+)/)?.[1] ?? '');
    }
    if (carry.startsWith('>')) ids.push(carry.match(/^>(\S+)/)?.[1] ?? '');
  } finally {
    closeSync(fd);
  }
  return ids.filter(Boolean);
}
const hasContent = (file) => existsSync(file) && statSync(file).size > 0;
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
    if (!part.final.fasta) throw new PipelineError('trial', p.genomeBuildJson, `${partitionName(part)} has no final FASTA`, REFINALIZE);
    if (part.featureCount > 0 && !part.final.gff) {
      throw new PipelineError('trial', p.genomeBuildJson, `${partitionName(part)} has featureCount ${part.featureCount} but no final GFF`, REFINALIZE);
    }
    for (const name of Object.values(part.final).filter(Boolean)) {
      const file = join(workDir, part.dir, name);
      if (!hasContent(file)) throw new PipelineError('trial', file, 'is missing or empty', 'run finalize again');
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
export function preflightReferenceData(ctx, { database, accession, taxonId, names, release, fresh, sourceIds = [] }, { exec }) {
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
  const taken = [];
  for (let i = 0; i < sourceIds.length; i += SOURCE_ID_BATCH) taken.push(...select(takenSourceIdsSql(sourceIds.slice(i, i + SOURCE_ID_BATCH))));
  if (taken.length) {
    const holders = [...new Set(taken.map((r) => r.name ?? 'no external database'))].join(', ');
    const sample = taken.slice(0, 3).map((r) => r.source_id).join(', ');
    throw new PipelineError('trial', database, `already has ${taken.length} of this genome's ${sourceIds.length} sequence IDs (${sample}${taken.length > 3 ? ', ...' : ''}) in ${holders}`,
      'source_id is unique in dots.nasequenceimp: remove that load (GUS Undo of its LoadFastaSequences run), or use a database without this genome');
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
    const held = readLock(lock);
    if (!held) throw new PipelineError('trial', lock, 'is held by another trial', 'wait for the process that wrote it to end; once it is gone, delete this lock file');
    const holder = `trial process ${held.pid}, started ${held.startedAt}`;
    if (!processExists(held.pid)) {
      throw new PipelineError('trial', lock, `is stale: ${holder}, and that process is gone`, `delete ${lock}, then run trial again`);
    }
    throw new PipelineError('trial', lock, `is held by ${holder}`, `wait for process ${held.pid} to end; once it is gone, delete this lock file`);
  }
  try {
    writeSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  } catch (e) {
    rmSync(lock, { force: true });
    throw e;
  } finally {
    closeSync(fd);
  }
  return () => {
    if (readLock(lock)?.pid === process.pid) rmSync(lock, { force: true });
    try {
      rmdirSync(paths.trialDir);
    } catch { /* it holds the record, logs or another run's lock */ }
  };
}

function readLock(lock) {
  try {
    const { pid, startedAt } = JSON.parse(readFileSync(lock, 'utf-8'));
    return Number.isInteger(pid) ? { pid, startedAt } : null;
  } catch {
    return null;
  }
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code !== 'ESRCH';
  }
}

function useModelImage(record, ctx, env) {
  const model = ensureModelImage(ctx, record.database, { exec: env.exec, logPath: env.paths.logOf('modelImage') });
  record.image = { ...record.image, modelTag: model.modelTag, schemaFingerprint: model.schemaFingerprint };
  env.save();
  return { ...ctx, image: model.modelTag };
}

/** One ga run, recorded as an attempt saved as `running` first, so a crash leaves its log to recover the invocation from. */
function runStep(record, step, ctx, env, next, { onSuccess = null } = {}) {
  const logPath = env.paths.logOf(step.key);
  const committing = step.commit && step.kind !== 'undo';
  const interruptedError = () => Object.assign(
    new PipelineError('trial', logPath, `${step.key} (${step.plugin}) was interrupted by ${env.interrupted}; its container was removed`, committing ? UNDO_FIRST : next),
    { exitCode: env.interrupted === 'SIGINT' ? 130 : 143 }
  );
  if (env.interrupted) throw interruptedError();
  const started = env.now();
  const attempt = {
    key: step.key, kind: step.kind, plugin: step.plugin, partition: step.partition, commit: step.commit,
    status: 'running', exitCode: null, algInvocationId: null, container: containerName(step.key), log: relative(env.workDir, logPath),
    startedAt: started.toISOString(), seconds: null
  };
  record.steps.push(attempt);
  env.save();
  let result;
  try {
    result = runGa(ctx, step, logPath, { exec: env.exec });
  } catch (e) {
    if (env.interrupted) {
      removeContainer(attempt.container, { exec: env.exec });
      throw interruptedError();
    }
    if (!(e instanceof PipelineError)) throw e;
    if (e.neverStarted) {
      Object.assign(attempt, { status: 'failed', seconds: 0 });
      env.save();
      throw e;
    }
    const log = existsSync(logPath) ? readFileSync(logPath, 'utf-8') : '';
    throw new PipelineError('trial', logPath, `${step.key} (${step.plugin}) ${e.problem}; last lines of its log:\n${tail(log)}`, committing ? UNDO_FIRST : next);
  }
  if (env.interrupted) {
    removeContainer(attempt.container, { exec: env.exec });
    throw interruptedError();
  }
  const { exitCode, algInvocationId, log } = result;
  let ok = exitCode === 0 && algInvocationId !== null;
  let failure = null;
  if (ok && onSuccess) {
    try {
      onSuccess();
    } catch (e) {
      ok = false;
      failure = e;
    }
  }
  Object.assign(attempt, { status: ok ? 'done' : 'failed', exitCode, algInvocationId, seconds: (env.now() - started) / 1000 });
  env.save();
  if (ok) return attempt;
  if (failure) throw failure;
  const lostInvocation = exitCode === 0 && committing;
  const loadedRows = committing && (algInvocationId != null || exitCode === 0);
  const why = exitCode === 0
    ? `logged no AlgInvocationId${lostInvocation ? `, so its rows cannot be undone by invocation; look in ${attempt.log} and find them by release ${record.release}` : ''}`
    : `exited ${exitCode}`;
  throw new PipelineError('trial', logPath, `${step.key} (${step.plugin}) ${why}; last lines of its log:\n${tail(log)}`, loadedRows ? UNDO_FIRST : next);
}

/** The printed IDs go to a temp name beside the destination and are renamed, so a half copy is never mistaken for the file. */
function copyTranscriptIds(from, to) {
  if (!hasContent(from)) {
    throw new PipelineError('trial', from, 'is missing or empty after a successful PRINT_TRANSCRIPT_IDS run', RESUME_OR_UNDO);
  }
  const temp = `${to}.tmp-${process.pid}`;
  try {
    copyFileSync(from, temp);
    renameSync(temp, to);
  } finally {
    rmSync(temp, { force: true });
  }
}

/** Whole-database statistics around one ISF run; a probe or snapshot that fails never aborts the trial. */
function profiler(select) {
  const attempt = (probe) => {
    try {
      return { probe, rows: snapshot(probe, select) };
    } catch (e) {
      return { probe, error: e.problem ?? e.message };
    }
  };
  let probe = null;
  let fallback = null;
  return {
    before() {
      if (!probe) {
        try {
          probe = profileSource(select);
        } catch (e) {
          probe = TABLES_PROBE;
          fallback = e.problem ?? e.message;
        }
      }
      let taken = attempt(probe);
      if (taken.error && probe !== TABLES_PROBE) {
        fallback = taken.error;
        probe = TABLES_PROBE;
        taken = attempt(probe);
      }
      return taken;
    },
    entry(before, { seconds, genes }) {
      let diff = before.error ? { error: before.error } : null;
      if (!diff) {
        const after = attempt(before.probe);
        diff = after.error ? { error: after.error } : profileDiff(before.probe.source, before.rows, after.rows);
      }
      return { scope: 'database', ...(fallback && !diff.error ? { fallback } : {}), ...profileEntry(diff, { seconds, genes }) };
    }
  };
}

function runForward(record, build, ctx, env) {
  const select = (sql) => selectRows(ctx, sql, { exec: env.exec });
  const profile = profiler(select);
  for (const step of planSteps(build, { taxonId: record.taxonId, release: record.release, gusHome: ctx.gusHome })) {
    const printed = join(env.workDir, step.dir, TRANSCRIPT_INFO);
    const isPrint = step.kind === 'isfPrint';
    const needed = !isDone(record, step.key) || (isPrint && !hasContent(printed) && !isDone(record, stepKey('isfSet', step.partition)));
    if (!needed) continue;
    const isf = ISF_KINDS.has(step.kind);
    const transcriptIds = join(env.paths.partitionDir(step.partition), TRANSCRIPT_IDS);
    if (isf) mkdirSync(env.paths.partitionDir(step.partition), { recursive: true });
    if (isPrint) {
      rmSync(transcriptIds, { force: true });
      rmSync(printed, { force: true });
      delete record.outputs[step.partition];
    }
    const before = isf ? profile.before() : null;
    const keepPrinted = () => {
      copyTranscriptIds(transcriptIds, printed);
      record.outputs[step.partition] = { transcriptInfoAndIds: sha256File(printed) };
    };
    const attempt = runStep(record, step, ctx, env, RESUME_OR_UNDO, { onSuccess: isPrint ? keepPrinted : null });
    if (isf) {
      const genes = build.partitions.find((part) => partitionName(part) === step.partition).featureCount;
      record.profile[step.key] = profile.entry(before, { seconds: attempt.seconds, genes });
      env.save();
    }
  }
}

function runQa(record, build, ctx, env) {
  if (isDone(record, 'qa')) return;
  const started = env.now();
  const select = (sql) => selectRows(ctx, sql, { exec: env.exec });
  const readIfThere = (rel) => {
    const file = join(env.workDir, rel);
    return existsSync(file) ? readFileSync(file, 'utf-8') : '';
  };
  const annotated = build.partitions.filter((part) => part.featureCount > 0);
  const names = annotated.map((part) => record.trialDatabases[partitionName(part)]);
  const releases = new Map(names.length ? select(releasesSql(names, record.release)).map((r) => [r.name, r.release_id]) : []);
  const parts = annotated.map((part) => {
    const name = partitionName(part);
    return {
      name, featureCount: part.featureCount, releaseId: releases.get(record.trialDatabases[name]) ?? null,
      expected: expectedModels(readText(join(workPaths(env.workDir).buildDir, name, BUILD_FILES.gff3))),
      transcriptInfo: parseTranscriptInfo(readIfThere(join(part.dir, TRANSCRIPT_INFO))),
      validationLogs: ['isfPrint', 'isfSet'].map((kind) => ({ key: stepKey(kind, name), text: readIfThere(isfFiles(kind, name).validationLog) }))
    };
  });
  const ids = parts.map((p) => p.releaseId).filter((id) => id !== null);
  const rows = ids.length
    ? { genes: select(genesSql(ids)), transcripts: select(transcriptsSql(ids)), internalStops: select(internalStopsSql(ids)) }
    : { genes: [], transcripts: [], internalStops: [] };
  record.findings = [...qaFindings(parts, rows), ...profileFindings(record.profile)];
  record.steps.push({
    key: 'qa', kind: 'qa', plugin: null, partition: null, commit: false, status: 'done', exitCode: null, algInvocationId: null, log: null,
    startedAt: started.toISOString(), seconds: (env.now() - started) / 1000
  });
  env.save();
}

/** A run cut off by SIGTERM or SIGKILL can leave its container running; it may still be loading rows. */
function assertNoRunningContainers(record, exec) {
  const recorded = new Set(record.steps.filter((s) => s.status === 'running' && s.container).map((s) => s.container));
  if (recorded.size === 0) return;
  const running = runningContainers({ exec }).filter((name) => recorded.has(name));
  if (running.length) {
    throw new PipelineError('trial', 'docker', `container ${running.join(', ')} of this trial is still running`, `wait for it, or docker rm -f ${running.join(' ')}`);
  }
}

const settleRunning = (record) => {
  for (const attempt of record.steps) if (attempt.status === 'running') attempt.status = 'failed';
};

/** A trial.json that may be resumed: D's output and --taxonId unchanged, nothing committed that failed or was cut off. */
function checkResumable(record, { workDir, genomeBuildSha256, loaded, taxonId, trialJson, exec }) {
  const problem = staleProblem(record, { genomeBuildSha256, loaded, taxonId });
  if (problem) throw new PipelineError('trial', trialJson, problem, UNDO_FIRST);
  assertNoRunningContainers(record, exec);
  recoverInvocationIds(record, workDir);
  const failed = committedFailure(record);
  if (failed) {
    saveTrialRecord(trialJson, record);
    const file = join(workDir, failed.log);
    if (failed.status === 'failed' && failed.algInvocationId == null) {
      throw new PipelineError('trial', file, `${failed.key} exited 0 but its AlgInvocationId could not be parsed, so its rows have to be found by release ${record.release}`,
        `${UNDO_FIRST}; --undo cannot target rows without the ID, so read ${failed.log} and remove what it loaded by hand`);
    }
    throw new PipelineError('trial', file, `${failed.key} failed after loading rows (AlgInvocationId ${failed.algInvocationId ?? 'not logged'})`, UNDO_FIRST);
  }
  settleRunning(record);
}

function startOrResume({ workDir, image, gusConfig, taxonId, exec, now, user }, { build, genomeBuildSha256, paths }) {
  const loaded = loadedDigests(build, workDir);
  const previous = readTrialRecord(paths.trialJson);
  const resuming = previous !== null && !previous.undone;
  if (resuming) checkResumable(previous, { workDir, genomeBuildSha256, loaded, taxonId, trialJson: paths.trialJson, exec });
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
    database: record.database, accession: build.accession, taxonId, names: Object.values(record.trialDatabases), release: record.release, fresh: !resuming,
    sourceIds: resuming ? [] : fastaSourceIds(build, workDir)
  }, { exec });
  return { record, ctx };
}

export async function runTrial(options) {
  const { workDir, image, gusConfig, taxonId, keep = false, exec = defaultExec, now = () => new Date(), user = hostUser() } = options;
  checkTrialOptions({ image, gusConfig, taxonId });
  const paths = trialPaths(workDir);
  const { build, sha256: genomeBuildSha256 } = readGenomeBuild(workDir);
  const release = acquireTrialLock(paths);
  let record = null;
  const env = { exec, now, workDir, paths, interrupted: null, save: () => saveTrialRecord(paths.trialJson, record) };
  const stopWatching = watchInterrupts(env);
  try {
    const started = startOrResume({ workDir, image, gusConfig, taxonId, exec, now, user }, { build, genomeBuildSha256, paths });
    record = started.record;
    const modelCtx = useModelImage(record, started.ctx, env);
    runForward(record, build, modelCtx, env);
    checkInterrupted(env);
    runQa(record, build, modelCtx, env);
    checkInterrupted(env);
    if (keep) {
      record.kept = true;
      env.save();
    } else {
      runUndo(record, modelCtx, env);
    }
    return record;
  } finally {
    stopWatching();
    release();
  }
}

/**
 * Exec is synchronous, so a handler only runs once the blocked docker call returns. A terminal Ctrl-C reaches docker too, which ends
 * that call; the handler then keeps Node alive long enough to remove the container and release the lock. SIGTERM sent to Node alone
 * cannot be served this way, so it keeps its default: the process dies at once.
 */
function watchInterrupts(env) {
  const onSigint = () => { env.interrupted = 'SIGINT'; };
  process.on('SIGINT', onSigint);
  return () => process.off('SIGINT', onSigint);
}

function checkInterrupted(env) {
  if (!env.interrupted) return;
  throw Object.assign(new PipelineError('trial', env.paths.trialJson, `was interrupted by ${env.interrupted}`, UNDO_FIRST), { exitCode: 130 });
}

function runUndo(record, ctx, env) {
  for (const step of undoPlan(record.steps, { gusHome: ctx.gusHome })) {
    if (isDone(record, step.key)) continue;
    runStep(record, step, ctx, env, 'fix the cause, then run trial --undo again');
  }
  const invocations = record.steps.filter((s) => s.commit && s.kind !== 'undo' && s.algInvocationId != null).map((s) => s.algInvocationId);
  const left = selectRows(ctx, leftoversSql(Object.values(record.trialDatabases), record.release, invocations), { exec: env.exec })
    .filter((r) => Number(r.n) > 0);
  if (left.length) {
    throw new PipelineError('trial', env.paths.trialJson, `rows remain after Undo: ${left.map((r) => `${r.what} ${r.n}`).join(', ')}`,
      'read the Undo logs under trial/logs, remove the rows, then run trial --undo again');
  }
  const orphans = invocations.length ? selectRows(ctx, invocationRowsSql(invocations), { exec: env.exec }) : [];
  record.findings = [...record.findings.filter((f) => f.check !== 'invocationNotRemovable'), ...invocationRowFindings(orphans)];
  record.kept = false;
  record.undone = true;
  env.save();
}

export async function runTrialUndo({ workDir, image, gusConfig, exec = defaultExec, now = () => new Date(), user = hostUser() }) {
  checkTrialOptions({ image, gusConfig }, { undo: true });
  const paths = trialPaths(workDir);
  const release = acquireTrialLock(paths);
  let record = null;
  const env = { exec, now, workDir, paths, interrupted: null, save: () => saveTrialRecord(paths.trialJson, record) };
  const stopWatching = watchInterrupts(env);
  try {
    record = readTrialRecord(paths.trialJson);
    if (!record) throw new PipelineError('trial', paths.trialJson, 'is missing; there is nothing to undo', 'run trial first');
    if (record.undone) return record;
    assertNoRunningContainers(record, exec);
    recoverInvocationIds(record, workDir);
    const info = imageInfo(image, { exec });
    if (info.id !== record.image.digest) {
      record.findings.push(finding('trial', 'imageChanged', 'warning', [], `--undo ran with image ${info.id}, but the trial loaded with ${record.image.digest}`, null, 1));
    }
    const ctx = contextOf({ workDir, image, gusConfig, user }, info.gusHome);
    currentDatabase(ctx, record.database, { exec });
    runUndo(record, useModelImage(record, ctx, env), env);
    settleRunning(record);
    env.save();
    return record;
  } finally {
    stopWatching();
    release();
  }
}
