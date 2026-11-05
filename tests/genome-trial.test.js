import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runTrial, runTrialUndo } from '../shared/scripts/genome/commands/trial.js';
import { parseTsv } from '../shared/scripts/genome/trial/gus.js';
import { modelTag, schemaFingerprint } from '../shared/scripts/genome/trial/model-image.js';
import { PipelineError, sha256, sha256File } from '../shared/scripts/genome/workdir.js';
import { tempDir } from './genome-helpers.js';
import {
  ACD_COMMIT, DATABASE, fakeClock, fakeDocker, gaLog, IMAGE, IMAGE_ID, INSPECT_BASE, ORGANELLE, PLUGIN, PRIMARY, RELEASE, SELECTS, START,
  TAXON_ID, TRANSCRIPT_IDS_TEXT, trialBuild, trialDb, trialWorkDir, USER
} from './genome-trial-helpers.js';

const trial = (ctx, docker, options = {}) =>
  runTrial({ ...ctx, image: IMAGE, taxonId: TAXON_ID, keep: true, exec: docker.exec, now: fakeClock(), user: USER, ...options });
const readRecord = (workDir) => JSON.parse(readFileSync(join(workDir, 'trial/trial.json'), 'utf-8'));
const FORWARD = [
  `externalDatabase:${PRIMARY}`, `externalDatabaseRls:${PRIMARY}`, `sequences:${PRIMARY}`,
  `externalDatabase:${ORGANELLE}`, `externalDatabaseRls:${ORGANELLE}`, `sequences:${ORGANELLE}`,
  `isfPrint:${PRIMARY}`, `isfSet:${PRIMARY}`
];
const FINGERPRINT = schemaFingerprint(parseTsv(SELECTS.schemaFingerprint), parseTsv(SELECTS.schemaColumns));
const RESUME_OR_UNDO = 'fix the cause, then run trial again to resume, or trial --undo to remove what it loaded';
const UNDO_FIRST = 'run trial --undo, then trial again';
const isPrint = (call) => call.directive === 'PRINT_TRANSCRIPT_IDS';
const killed = () => Object.assign(new Error('killed'), { signal: 'SIGKILL' });
const logOf = (call, key) => join(call.host, 'trial/logs', `${key}.log`);

test('trial loads sequences for every partition, runs both ISF passes where there are features, and records each step', async () => {
  const ctx = trialWorkDir();
  const docker = fakeDocker();
  const record = await trial(ctx, docker);
  assert.deepEqual(docker.gaCalls().map((c) => c.plugin), [
    PLUGIN.externalDatabase, PLUGIN.externalDatabaseRls, PLUGIN.sequences, PLUGIN.externalDatabase, PLUGIN.externalDatabaseRls, PLUGIN.sequences,
    PLUGIN.isf, PLUGIN.isf
  ]);
  const forward = record.steps.slice(0, FORWARD.length);
  assert.deepEqual(forward.map((s) => s.key), FORWARD);
  assert.deepEqual(forward.map((s) => s.algInvocationId), [7319, 7320, 7321, 7322, 7323, 7324, 7325, 7326]);
  assert.deepEqual(forward[0], {
    key: `externalDatabase:${PRIMARY}`, kind: 'externalDatabase', plugin: PLUGIN.externalDatabase, partition: PRIMARY, commit: true,
    status: 'done', exitCode: 0, algInvocationId: 7319, container: `curator-trial-${process.pid}-externalDatabase_${PRIMARY}`,
    log: `trial/logs/externalDatabase:${PRIMARY}.log`,
    startedAt: '2026-11-05T10:23:46.000Z', seconds: 1
  });
  assert.equal(forward[6].commit, false);
  assert.match(readFileSync(join(ctx.workDir, forward[2].log), 'utf-8'), /\tAlgInvocationId\t7321\n/);
  assert.equal(readFileSync(join(ctx.workDir, `final/${PRIMARY}/transcriptInfoAndIds`), 'utf-8'), TRANSCRIPT_IDS_TEXT);
  assert.deepEqual(record.image, {
    name: IMAGE, digest: IMAGE_ID, apiCommonDataCommit: ACD_COMMIT, modelTag: modelTag(DATABASE, FINGERPRINT), schemaFingerprint: FINGERPRINT
  });
  assert.equal(record.database, DATABASE);
  assert.equal(record.release, RELEASE);
  assert.equal(record.startedAt, START.toISOString());
  assert.equal(record.taxonId, TAXON_ID);
  assert.deepEqual(record.trialDatabases, { [PRIMARY]: trialDb(PRIMARY), [ORGANELLE]: trialDb(ORGANELLE) });
  assert.equal(record.genomeBuild.sha256, sha256File(join(ctx.workDir, 'genome-build.json')));
  assert.equal(record.kept, true);
  assert.equal(record.undone, false);
  assert.deepEqual(Object.keys(record.profile), [`isfPrint:${PRIMARY}`, `isfSet:${PRIMARY}`]);
  assert.equal(record.profile[`isfPrint:${PRIMARY}`].source, 'pg_stat_statements');
  assert.equal(record.profile[`isfPrint:${PRIMARY}`].secondsPerGene, 0.5);
  assert.deepEqual(readRecord(ctx.workDir), record);
  assert.equal(existsSync(join(ctx.workDir, 'trial/.lock')), false);
});

test('ISF run 1 finds its postprocessing directory made, and run 2 finds transcriptInfoAndIds already in final/', async () => {
  const ctx = trialWorkDir();
  const seen = {};
  const docker = fakeDocker({
    ga: (call) => {
      if (call.directive === 'PRINT_TRANSCRIPT_IDS') seen.printDir = existsSync(join(call.host, 'trial', PRIMARY));
      if (call.directive === 'SET_TRANSCRIPT_IDS') {
        seen.infoBeforeSet = existsSync(join(call.host, `final/${PRIMARY}/transcriptInfoAndIds`));
        seen.setDir = existsSync(join(call.host, `final/${PRIMARY}`));
      }
      return undefined;
    }
  });
  await trial(ctx, docker);
  assert.deepEqual(seen, { printDir: true, infoBeforeSet: true, setDir: true });
});

test('each attempt is saved as running before ga starts, and a clean run leaves none running', async () => {
  const ctx = trialWorkDir();
  const sawRunning = [];
  const docker = fakeDocker({
    ga: (call) => {
      const last = readRecord(call.host).steps.at(-1);
      sawRunning.push([last.status, last.algInvocationId, last.exitCode]);
      return undefined;
    }
  });
  const record = await trial(ctx, docker);
  assert.equal(sawRunning.length, 8);
  assert.ok(sawRunning.every((s) => s[0] === 'running' && s[1] === null && s[2] === null));
  assert.ok(record.steps.every((s) => s.status === 'done'));
});

test('a failed PRINT run leaves its partial transcriptIds uncopied; the rerun resumes at that step', async () => {
  const ctx = trialWorkDir();
  const docker = fakeDocker({
    ga: (call, state) => {
      if (!isPrint(call) || state.printFailed) return undefined;
      state.printFailed = true;
      return { exitCode: 255, writes: { [`/work/trial/${PRIMARY}/transcriptIds`]: 'TST_0010\tATG\t1\t100,400\tTST_0010_mRNA\n' } };
    }
  });
  await assert.rejects(trial(ctx, docker), (e) => e instanceof PipelineError
    && e.file === join(ctx.workDir, `trial/logs/isfPrint:${PRIMARY}.log`)
    && /^isfPrint:primary_chromosome \(GUS::Supported::Plugin::InsertSequenceFeatures\) exited 255; last lines of its log:\n[\s\S]*ERROR:\ndied/.test(e.problem)
    && e.next === RESUME_OR_UNDO);
  assert.equal(existsSync(join(ctx.workDir, `final/${PRIMARY}/transcriptInfoAndIds`)), false);
  assert.deepEqual(readRecord(ctx.workDir).steps.at(-1).status, 'failed');
  assert.equal(docker.gaCalls().length, 7);
  assert.equal(existsSync(join(ctx.workDir, 'trial/.lock')), false);
  const record = await trial(ctx, docker);
  assert.equal(docker.gaCalls().length, 9);
  assert.equal(readFileSync(join(ctx.workDir, `final/${PRIMARY}/transcriptInfoAndIds`), 'utf-8'), TRANSCRIPT_IDS_TEXT);
  assert.equal(record.steps.filter((s) => s.key === `isfPrint:${PRIMARY}`).length, 2);
});

test('a committing ga that exits 0 without an AlgInvocationId may have committed: no resume, find its rows by release', async () => {
  const ctx = trialWorkDir();
  const docker = fakeDocker({ ga: (call) => (call.plugin === PLUGIN.externalDatabase ? { id: null } : undefined) });
  await assert.rejects(trial(ctx, docker), (e) => /^externalDatabase:primary_chromosome \(GUS::Supported::Plugin::InsertExternalDatabase\) logged no AlgInvocationId/.test(e.problem)
    && e.problem.includes(`find them by release ${RELEASE}`) && e.next === UNDO_FIRST);
  assert.deepEqual(readRecord(ctx.workDir).steps.map((s) => [s.status, s.exitCode, s.algInvocationId]), [['failed', 0, null]]);
  await assert.rejects(trial(ctx, docker), (e) => e.file === join(ctx.workDir, `trial/logs/externalDatabase:${PRIMARY}.log`)
    && e.problem === `externalDatabase:${PRIMARY} exited 0 but its AlgInvocationId could not be parsed, so its rows have to be found by release ${RELEASE}`
    && e.next.startsWith(UNDO_FIRST) && e.next.includes(`trial/logs/externalDatabase:${PRIMARY}.log`));
  assert.equal(docker.gaCalls().length, 1);
});

test('--undo cannot target rows whose invocation was never parsed, and says rows remain by release', async () => {
  const ctx = trialWorkDir();
  const docker = fakeDocker({
    ga: (call) => (call.plugin === PLUGIN.externalDatabase ? { id: null } : undefined),
    selects: { leftovers: 'what\tn\ntrialRelease\t1\n' }
  });
  await assert.rejects(trial(ctx, docker), /logged no AlgInvocationId/);
  await assert.rejects(undo(ctx, docker), /rows remain after Undo: trialRelease 1/);
  assert.equal(docker.gaCalls().length, 1);
});

test('a failed isfSet that logged an AlgInvocationId may have committed trees: resume refuses', async () => {
  const ctx = trialWorkDir();
  const docker = fakeDocker({ ga: (call) => (call.directive === 'SET_TRANSCRIPT_IDS' ? { exitCode: 255 } : undefined) });
  await assert.rejects(trial(ctx, docker), (e) => e.next === UNDO_FIRST);
  await assert.rejects(trial(ctx, docker), (e) => e.problem === `isfSet:${PRIMARY} failed after loading rows (AlgInvocationId 7326)` && e.next === UNDO_FIRST);
  assert.equal(docker.gaCalls().length, 8);
});

test('a ga killed by a signal fails with the log tail, and a committing step points at trial --undo', async () => {
  const ctx = trialWorkDir();
  const docker = fakeDocker({
    ga: (call) => {
      if (call.plugin !== PLUGIN.sequences) return undefined;
      appendFileSync(logOf(call, `sequences:${PRIMARY}`), 'loading sequence 12 of 40\n');
      throw killed();
    }
  });
  await assert.rejects(trial(ctx, docker), (e) => e instanceof PipelineError && e.file === join(ctx.workDir, `trial/logs/sequences:${PRIMARY}.log`)
    && /^sequences:primary_chromosome \(GUS::Supported::Plugin::LoadFastaSequences\) could not be run: SIGKILL; last lines of its log:\nloading sequence 12 of 40/.test(e.problem)
    && e.next === UNDO_FIRST);
  const noCommit = trialWorkDir();
  const printKilled = fakeDocker({ ga: (call) => { if (isPrint(call)) throw killed(); return undefined; } });
  await assert.rejects(trial(noCommit, printKilled), (e) => e.next === RESUME_OR_UNDO);
});

test('when Docker never started, the attempt is failed with no ID, so a resume does not demand an undo', async () => {
  const ctx = trialWorkDir();
  const docker = fakeDocker({
    ga: (call, state) => {
      if (state.tried) return undefined;
      state.tried = true;
      throw Object.assign(new Error('spawn docker ENOENT'), { code: 'ENOENT' });
    }
  });
  await assert.rejects(trial(ctx, docker), (e) => e instanceof PipelineError && e.problem === 'is not on PATH');
  assert.deepEqual(readRecord(ctx.workDir).steps.map((s) => [s.key, s.status, s.algInvocationId]), [[`externalDatabase:${PRIMARY}`, 'failed', null]]);
  const record = await trial(ctx, docker);
  assert.deepEqual(record.steps.slice(0, 2).map((s) => [s.key, s.status]), [[`externalDatabase:${PRIMARY}`, 'failed'], [`externalDatabase:${PRIMARY}`, 'done']]);
});

test('a stale transcriptInfoAndIds from an earlier trial is removed before ISF run 1 and never used', async () => {
  const ctx = trialWorkDir();
  const stale = join(ctx.workDir, `final/${PRIMARY}/transcriptInfoAndIds`);
  writeFileSync(stale, 'STALE\tAAA\t1\t1,2\tOLD_mRNA\n');
  let during = null;
  const docker = fakeDocker({
    ga: (call, state) => {
      if (!isPrint(call) || state.once) return undefined;
      state.once = true;
      during = existsSync(stale);
      return { exitCode: 255 };
    }
  });
  await assert.rejects(trial(ctx, docker), /isfPrint:primary_chromosome .* exited 255/);
  assert.equal(during, false);
  assert.equal(existsSync(stale), false);
  await trial(ctx, docker);
  assert.equal(readFileSync(stale, 'utf-8'), TRANSCRIPT_IDS_TEXT);
  assert.deepEqual(readdirSync(join(ctx.workDir, `final/${PRIMARY}`)).filter((f) => f.includes('.tmp-')), []);
});

test('a PRINT run that exits 0 but whose copy fails is not done, and the rerun runs it again', async () => {
  const ctx = trialWorkDir();
  const docker = fakeDocker({ ga: (call, state) => (isPrint(call) && !state.once ? (state.once = true, { writes: { [`/work/trial/${PRIMARY}/transcriptIds`]: '' } }) : undefined) });
  await assert.rejects(trial(ctx, docker), (e) => /is missing or empty after a successful PRINT_TRANSCRIPT_IDS run/.test(e.problem));
  const last = readRecord(ctx.workDir).steps.at(-1);
  assert.deepEqual([last.key, last.status, last.exitCode], [`isfPrint:${PRIMARY}`, 'failed', 0]);
  const record = await trial(ctx, docker);
  assert.deepEqual(record.steps.filter((s) => s.key === `isfPrint:${PRIMARY}`).map((s) => s.status), ['failed', 'done']);
  assert.equal(readFileSync(join(ctx.workDir, `final/${PRIMARY}/transcriptInfoAndIds`), 'utf-8'), TRANSCRIPT_IDS_TEXT);
});

test('a resumed trial whose transcriptInfoAndIds is empty reruns ISF run 1 even though it is recorded done', async () => {
  const ctx = trialWorkDir();
  const docker = fakeDocker({ ga: (call, state) => (call.directive === 'SET_TRANSCRIPT_IDS' && !state.once ? (state.once = true, { exitCode: 255, id: null }) : undefined) });
  await assert.rejects(trial(ctx, docker), /isfSet/);
  writeFileSync(join(ctx.workDir, `final/${PRIMARY}/transcriptInfoAndIds`), '');
  await trial(ctx, docker);
  assert.deepEqual(docker.gaCalls().slice(8).map((c) => c.args[c.args.indexOf('--postprocessingDirective') + 1]), ['PRINT_TRANSCRIPT_IDS', 'SET_TRANSCRIPT_IDS']);
});

const broken = (stderr) => () => { throw Object.assign(new Error('failed'), { status: 1, stdout: '', stderr }); };

test('profiling never aborts a trial: a failing statements snapshot falls back to table statistics', async () => {
  const ctx = trialWorkDir();
  const docker = fakeDocker({ selects: { statements: broken('permission denied for pg_stat_statements') } });
  const record = await trial(ctx, docker);
  assert.equal(record.profile[`isfPrint:${PRIMARY}`].source, 'pg_stat_user_tables');
  assert.equal(record.profile[`isfPrint:${PRIMARY}`].scope, 'database');
  assert.match(record.profile[`isfSet:${PRIMARY}`].fallback, /permission denied for pg_stat_statements/);
  assert.ok(record.findings.some((f) => f.check === 'isfProfile' && /\(pg_stat_user_tables; pg_stat_statements failed: .*permission denied/.test(f.message)));
  assert.ok(record.steps.every((s) => s.status === 'done'));
});

test('the statements snapshot names the schema the extension lives in', async () => {
  const docker = fakeDocker({ selects: { profileSource: 'schema\nmonitoring\n' } });
  await trial(trialWorkDir(), docker);
  assert.match(docker.calls.find((c) => c.input?.startsWith('-- trial:statements')).input, /FROM "monitoring"\.pg_stat_statements/);
});

test('profiling never aborts a trial: when both snapshots fail the error is recorded and the trial continues', async () => {
  const ctx = trialWorkDir();
  const docker = fakeDocker({ selects: { statements: broken('boom statements'), tables: broken('boom tables') } });
  const record = await trial(ctx, docker);
  const entry = record.profile[`isfSet:${PRIMARY}`];
  assert.equal(entry.scope, 'database');
  assert.match(entry.error, /boom tables/);
  assert.equal(entry.secondsPerGene, 0.5);
  assert.ok(record.steps.every((s) => s.status === 'done'));
  assert.equal(record.steps.at(-1).key, 'qa');
  assert.ok(record.findings.some((f) => f.check === 'isfProfile' && /profiling unavailable: .*boom tables/.test(f.message)));
});

test('a failing profile probe falls back too', async () => {
  const docker = fakeDocker({ selects: { profileSource: broken('no such relation') } });
  const record = await trial(trialWorkDir(), docker);
  assert.equal(record.profile[`isfPrint:${PRIMARY}`].source, 'pg_stat_user_tables');
  assert.match(record.profile[`isfPrint:${PRIMARY}`].fallback, /no such relation/);
});

test('no query ever resets pg_stat_statements', async () => {
  const docker = fakeDocker();
  await trial(trialWorkDir(), docker);
  assert.ok(docker.calls.length > 0);
  assert.ok(docker.calls.every((c) => !(c.input ?? '').includes('pg_stat_statements_reset')));
});

test('a committed step that failed after its invocation existed is not resumed; the next step is trial --undo', async () => {
  const ctx = trialWorkDir();
  const docker = fakeDocker({ ga: (call) => (call.plugin === PLUGIN.sequences && call.args.includes(trialDb(PRIMARY)) ? { exitCode: 255 } : undefined) });
  await assert.rejects(trial(ctx, docker), (e) => e.next === UNDO_FIRST);
  await assert.rejects(trial(ctx, docker), (e) => e.problem === `sequences:${PRIMARY} failed after loading rows (AlgInvocationId 7321)` && e.next === UNDO_FIRST);
  assert.equal(docker.gaCalls().length, 3);
});

test('a run killed before its result was saved is recovered from its log: the running committing step is a committed failure', async () => {
  const ctx = trialWorkDir();
  const docker = fakeDocker({
    ga: (call) => {
      if (call.plugin !== PLUGIN.sequences) return undefined;
      appendFileSync(logOf(call, `sequences:${PRIMARY}`), gaLog(7321, call.plugin));
      throw killed();
    }
  });
  await assert.rejects(trial(ctx, docker), (e) => e instanceof PipelineError && /could not be run: SIGKILL/.test(e.problem));
  assert.deepEqual(readRecord(ctx.workDir).steps.at(-1).status, 'running');
  assert.equal(existsSync(join(ctx.workDir, 'trial/.lock')), false);
  await assert.rejects(trial(ctx, docker), (e) => e.problem === `sequences:${PRIMARY} failed after loading rows (AlgInvocationId 7321)` && e.next === UNDO_FIRST);
  const saved = readRecord(ctx.workDir).steps.at(-1);
  assert.deepEqual([saved.status, saved.algInvocationId], ['running', 7321]);
  assert.equal(docker.gaCalls().length, 3);
});

test('a running committing step whose log has no AlgInvocationId still refuses to resume', async () => {
  const ctx = trialWorkDir();
  const docker = fakeDocker({ ga: (call) => (call.plugin === PLUGIN.externalDatabase ? (() => { throw killed(); })() : undefined) });
  await assert.rejects(trial(ctx, docker), /could not be run/);
  await assert.rejects(trial(ctx, docker), (e) => e.problem === `externalDatabase:${PRIMARY} failed after loading rows (AlgInvocationId not logged)` && e.next === UNDO_FIRST);
});

test('a running step that never commits is interrupted, not refused: the rerun runs it again', async () => {
  const ctx = trialWorkDir();
  const docker = fakeDocker({
    ga: (call, state) => {
      if (!isPrint(call) || state.killed) return undefined;
      state.killed = true;
      throw killed();
    }
  });
  await assert.rejects(trial(ctx, docker), /could not be run/);
  assert.equal(readRecord(ctx.workDir).steps.at(-1).status, 'running');
  const record = await trial(ctx, docker);
  const prints = record.steps.filter((s) => s.key === `isfPrint:${PRIMARY}`);
  assert.deepEqual(prints.map((s) => s.status), ['failed', 'done']);
});

test('a missing transcriptInfoAndIds before ISF run 2 has run reruns ISF run 1', async () => {
  const ctx = trialWorkDir();
  const docker = fakeDocker({
    ga: (call, state) => {
      if (call.directive !== 'SET_TRANSCRIPT_IDS' || state.setFailed) return undefined;
      state.setFailed = true;
      return { exitCode: 255, id: null };
    }
  });
  await assert.rejects(trial(ctx, docker), /isfSet:primary_chromosome .* exited 255/);
  rmSync(join(ctx.workDir, `final/${PRIMARY}/transcriptInfoAndIds`));
  await trial(ctx, docker);
  assert.deepEqual(docker.gaCalls().slice(8).map((c) => c.args[c.args.indexOf('--postprocessingDirective') + 1]), ['PRINT_TRANSCRIPT_IDS', 'SET_TRANSCRIPT_IDS']);
});

test('trial refuses to resume once D output or the taxon changed', async () => {
  const ctx = trialWorkDir();
  const docker = fakeDocker();
  await trial(ctx, docker);
  await assert.rejects(trial(ctx, docker, { taxonId: 6035 }), (e) => e.problem === `trial ran with --taxonId ${TAXON_ID}` && e.next === UNDO_FIRST);
  appendFileSync(join(ctx.workDir, `final/${ORGANELLE}/genome.fasta`), 'ACGT\n');
  await assert.rejects(trial(ctx, docker), (e) => e.file === join(ctx.workDir, 'trial/trial.json') && e.problem === 'trial is for an older build' && e.next === UNDO_FIRST);
});

test('trial refuses to resume against another database, and runs no ga', async () => {
  const ctx = trialWorkDir();
  await trial(ctx, fakeDocker());
  const other = fakeDocker({ selects: { database: 'name\nother_db\n' } });
  await assert.rejects(trial(ctx, other), (e) => e instanceof PipelineError && e.problem === `names database other_db, but the trial loaded into ${DATABASE}` && /trial --undo/.test(e.next));
  assert.deepEqual(other.gaCalls(), []);
});

test('trial refuses to resume with an image whose id is not the one the trial started with', async () => {
  const ctx = trialWorkDir();
  await trial(ctx, fakeDocker());
  const rebuilt = fakeDocker({ images: { [IMAGE]: INSPECT_BASE.replace(IMAGE_ID, 'sha256:0000000000000000') } });
  await assert.rejects(trial(ctx, rebuilt), (e) => e instanceof PipelineError && /is not the image the trial started with/.test(e.problem) && /trial --undo/.test(e.next));
  assert.deepEqual(rebuilt.gaCalls(), []);
});

test('a refused preflight writes nothing and runs no ga', async () => {
  const ctx = trialWorkDir();
  const docker = fakeDocker({ selects: { taxon: 'taxon_id\tgenetic_code_id\tcodes\n' } });
  await assert.rejects(trial(ctx, docker), /has no sres\.taxon row for NCBI taxon 284813/);
  assert.equal(existsSync(join(ctx.workDir, 'trial')), false);
  assert.deepEqual(docker.gaCalls(), []);
});

test('a leftover trial database of this accession refuses a fresh trial before any ga', async () => {
  const ctx = trialWorkDir();
  const docker = fakeDocker({ selects: { leftoverDatabases: `name\n${trialDb(PRIMARY)}\n` } });
  await assert.rejects(trial(ctx, docker), (e) => e.problem.startsWith(`already has trial database ${trialDb(PRIMARY)}`));
  assert.deepEqual(docker.gaCalls(), []);
});

test('QA runs scoped to the trial release and records only info findings for a clean load', async () => {
  const ctx = trialWorkDir();
  const docker = fakeDocker();
  const record = await trial(ctx, docker);
  assert.equal(record.steps.at(-1).key, 'qa');
  assert.equal(record.steps.at(-1).status, 'done');
  assert.deepEqual(record.findings.map((f) => [f.check, f.severity]), [['isfTime', 'info'], ['isfProfile', 'info'], ['isfTime', 'info'], ['isfProfile', 'info']]);
  assert.equal(record.findings[0].message, `isfPrint:${PRIMARY}: 1 s, 0.5 s per gene`);
  const genes = docker.calls.find((c) => c.input?.startsWith('-- trial:genes')).input;
  assert.match(genes, /IN \(501\)$/);
  assert.match(docker.calls.filter((c) => c.input?.startsWith('-- trial:releases')).at(-1).input, new RegExp(`IN \\('${trialDb(PRIMARY)}'\\)`));
  assert.deepEqual(readRecord(ctx.workDir), record);
});

test('a gene missing from the database is an error finding, and a validation.log line a warning', async () => {
  const ctx = trialWorkDir();
  const docker = fakeDocker({
    selects: { genes: 'release_id\tsource_id\n501\tTST_0010\n' },
    ga: (call) => (call.directive === 'SET_TRANSCRIPT_IDS'
      ? { writes: { [`/work/trial/${PRIMARY}/isfSet.validation.log`]: 'Feature tRNA rna-TST_0030 has no product\n' } } : undefined)
  });
  const record = await trial(ctx, docker);
  const problems = record.findings.filter((f) => f.severity !== 'info').map((f) => [f.check, f.severity, f.sample]);
  assert.deepEqual(problems, [['geneCount', 'error', ['TST_0030']], ['validationLog', 'warning', ['Feature tRNA rna-TST_0030 has no product']]]);
});

test('a resumed trial whose QA is done does not run it again', async () => {
  const ctx = trialWorkDir();
  const docker = fakeDocker();
  await trial(ctx, docker);
  const asked = docker.queries().filter((q) => q === 'genes').length;
  await trial(ctx, docker);
  assert.equal(docker.queries().filter((q) => q === 'genes').length, asked);
});

test('trial/.lock keeps a second run out, names itself, and is removed when the run ends', async () => {
  const ctx = trialWorkDir();
  const lock = join(ctx.workDir, 'trial/.lock');
  let held;
  await trial(ctx, fakeDocker({
    ga: (call, state) => {
      if (!state.read) held = JSON.parse(readFileSync(lock, 'utf-8'));
      state.read = true;
      return undefined;
    }
  }));
  assert.equal(held.pid, process.pid);
  assert.equal(typeof held.startedAt, 'string');
  assert.equal(existsSync(lock), false);

  const other = trialWorkDir();
  const otherLock = join(other.workDir, 'trial/.lock');
  mkdirSync(join(other.workDir, 'trial'), { recursive: true });
  writeFileSync(otherLock, JSON.stringify({ pid: process.pid, startedAt: '2026-11-05T09:00:00.000Z' }));
  const docker = fakeDocker();
  await assert.rejects(trial(other, docker), (e) => e instanceof PipelineError && e.file === otherLock
    && e.problem === `is held by trial process ${process.pid}, started 2026-11-05T09:00:00.000Z`
    && e.next === `wait for process ${process.pid} to end; once it is gone, delete this lock file`);
  assert.equal(existsSync(otherLock), true);
  assert.deepEqual(docker.calls, []);
});

test('a lock whose process is gone is called stale and named, but not deleted', async () => {
  const ctx = trialWorkDir();
  const lock = join(ctx.workDir, 'trial/.lock');
  const gone = spawnSync('true').pid;
  mkdirSync(join(ctx.workDir, 'trial'), { recursive: true });
  writeFileSync(lock, JSON.stringify({ pid: gone, startedAt: '2026-11-05T09:00:00.000Z' }));
  await assert.rejects(trial(ctx, fakeDocker()), (e) => e.file === lock
    && e.problem === `is stale: trial process ${gone}, started 2026-11-05T09:00:00.000Z, and that process is gone` && e.next === `delete ${lock}, then run trial again`);
  assert.equal(existsSync(lock), true);
});

test('a release does not remove a lock that another process now holds', async () => {
  const ctx = trialWorkDir();
  const lock = join(ctx.workDir, 'trial/.lock');
  await trial(ctx, fakeDocker({ ga: (call, state) => (state.swapped ? undefined : (state.swapped = true, writeFileSync(lock, JSON.stringify({ pid: 1, startedAt: 'x' })), undefined)) }));
  assert.equal(existsSync(lock), true);
});

test('a directory for --gusConfig is refused with no docker call', async () => {
  const ctx = trialWorkDir();
  const docker = fakeDocker();
  await assert.rejects(trial({ ...ctx, gusConfig: tempDir('trial-config-dir-') }, docker), (e) => e instanceof PipelineError && e.problem === 'is not a file');
  assert.deepEqual(docker.calls, []);
});

test('a final GFF missing for a partition with features, or a missing FASTA, is refused offline, before the lock', async () => {
  for (const edit of [(part) => { part.final.gff = null; }, (part) => { part.final.fasta = null; }]) {
    const build = trialBuild();
    edit(build.partitions[0]);
    const ctx = trialWorkDir(build);
    const docker = fakeDocker();
    await assert.rejects(trial(ctx, docker), (e) => e instanceof PipelineError && /no final (GFF|FASTA)/.test(e.problem));
    assert.deepEqual(docker.calls, []);
    assert.equal(existsSync(join(ctx.workDir, 'trial')), false);
  }
});

const MAP = '/opt/veupathdb/gus_home/lib/xml/isf/genemRNAExonCDS2Gus.xml';
const communityUndo = (plugin, id) => ({ plugin: PLUGIN.undo, args: ['--plugin', plugin, '--algInvocationId', String(id), '--commit'] });
const UNDO_CALLS = [
  { plugin: PLUGIN.isfUndo, args: ['--mapFile', MAP, '--algInvocationId', '7326', '--commit'] },
  communityUndo(PLUGIN.sequences, 7324), communityUndo(PLUGIN.externalDatabaseRls, 7323), communityUndo(PLUGIN.externalDatabase, 7322),
  communityUndo(PLUGIN.sequences, 7321), communityUndo(PLUGIN.externalDatabaseRls, 7320), communityUndo(PLUGIN.externalDatabase, 7319)
];
const undo = (ctx, docker) => runTrialUndo({ ...ctx, image: IMAGE, exec: docker.exec, now: fakeClock(), user: USER });

test('trial undoes every committed invocation newest first, then checks nothing is left', async () => {
  const ctx = trialWorkDir();
  const docker = fakeDocker();
  const record = await trial(ctx, docker, { keep: false });
  assert.deepEqual(docker.gaCalls().slice(FORWARD.length), UNDO_CALLS);
  assert.deepEqual(record.steps.slice(FORWARD.length + 1).map((s) => [s.key, s.status]), [
    `undo:isfSet:${PRIMARY}`, `undo:sequences:${ORGANELLE}`, `undo:externalDatabaseRls:${ORGANELLE}`, `undo:externalDatabase:${ORGANELLE}`,
    `undo:sequences:${PRIMARY}`, `undo:externalDatabaseRls:${PRIMARY}`, `undo:externalDatabase:${PRIMARY}`
  ].map((key) => [key, 'done']));
  const leftovers = docker.calls.find((c) => c.input?.startsWith('-- trial:leftovers')).input;
  assert.match(leftovers, /row_alg_invocation_id IN \(7319, 7320, 7321, 7322, 7323, 7324, 7326\)/);
  assert.ok(!leftovers.includes('core.algorithminvocation'));
  assert.match(leftovers, /'trialDatabases', count\(\*\) FROM sres\.externaldatabase WHERE name IN/);
  assert.match(docker.calls.find((c) => c.input?.startsWith('-- trial:invocationRows')).input, /algorithm_invocation_id IN \(7319, 7320, 7321, 7322, 7323, 7324, 7326\)/);
  assert.equal(record.undone, true);
  assert.equal(record.kept, false);
  assert.deepEqual(readRecord(ctx.workDir), record);
  assert.equal(existsSync(join(ctx.workDir, 'trial/.lock')), false);
});

test('--keep leaves the rows; --undo removes them later with the cached model image', async () => {
  const ctx = trialWorkDir();
  const docker = fakeDocker();
  await trial(ctx, docker);
  const record = await undo(ctx, docker);
  assert.deepEqual(docker.gaCalls().slice(FORWARD.length), UNDO_CALLS);
  assert.equal(docker.calls.filter((c) => c.args.includes('bash')).length, 1);
  assert.equal(record.undone, true);
  assert.equal(record.kept, false);
  assert.equal(existsSync(join(ctx.workDir, 'trial/.lock')), false);
  const calls = docker.calls.length;
  assert.equal((await undo(ctx, docker)).undone, true);
  assert.equal(docker.calls.length, calls);
});

test('--undo removes what a failed committed step loaded, and a new trial can then start', async () => {
  const ctx = trialWorkDir();
  const docker = fakeDocker({ ga: (call, state) => (call.plugin === PLUGIN.sequences && !state.failedOnce ? (state.failedOnce = true, { exitCode: 255 }) : undefined) });
  await assert.rejects(trial(ctx, docker), (e) => e.next === UNDO_FIRST);
  await undo(ctx, docker);
  assert.deepEqual(docker.gaCalls().slice(3), [
    communityUndo(PLUGIN.sequences, 7321), communityUndo(PLUGIN.externalDatabaseRls, 7320), communityUndo(PLUGIN.externalDatabase, 7319)
  ]);
  const again = await trial(ctx, docker, { now: fakeClock(new Date('2026-11-06T08:00:00.000Z')) });
  assert.equal(again.release, '20261106T080000');
  assert.equal(again.steps[0].key, `externalDatabase:${PRIMARY}`);
  assert.equal(again.undone, false);
});

test('--undo recovers the invocation of a run killed before its result was saved, from its log', async () => {
  const ctx = trialWorkDir();
  const docker = fakeDocker({
    ga: (call) => {
      if (call.plugin !== PLUGIN.sequences) return undefined;
      appendFileSync(logOf(call, `sequences:${PRIMARY}`), gaLog(7321, call.plugin));
      throw killed();
    }
  });
  await assert.rejects(trial(ctx, docker), /could not be run/);
  const record = await undo(ctx, docker);
  assert.deepEqual(docker.gaCalls().slice(3), [
    communityUndo(PLUGIN.sequences, 7321), communityUndo(PLUGIN.externalDatabaseRls, 7320), communityUndo(PLUGIN.externalDatabase, 7319)
  ]);
  assert.equal(record.undone, true);
  assert.match(docker.calls.find((c) => c.input?.startsWith('-- trial:leftovers')).input, /row_alg_invocation_id IN \(7319, 7320, 7321\)/);
  assert.ok(record.steps.every((s) => s.status !== 'running'));
});

test('rows left after Undo fail the run and leave it not undone', async () => {
  const ctx = trialWorkDir();
  const docker = fakeDocker({ selects: { leftovers: 'what\tn\ntrialRelease\t0\ndots.nafeatureimp\t3\n' } });
  await assert.rejects(trial(ctx, docker, { keep: false }), /rows remain after Undo: dots\.nafeatureimp 3/);
  assert.equal(readRecord(ctx.workDir).undone, false);
  assert.equal(existsSync(join(ctx.workDir, 'trial/.lock')), false);
});

test('a failed Undo step names the log and says to run --undo again', async () => {
  const ctx = trialWorkDir();
  const docker = fakeDocker({ ga: (call) => (call.plugin === PLUGIN.isfUndo ? { exitCode: 255, id: null } : undefined) });
  await assert.rejects(trial(ctx, docker, { keep: false }), (e) => e.file === join(ctx.workDir, `trial/logs/undo:isfSet:${PRIMARY}.log`)
    && e.next === 'fix the cause, then run trial --undo again');
});

test('--undo needs a trial.json and the database the trial loaded into', async () => {
  const empty = trialWorkDir();
  await assert.rejects(undo(empty, fakeDocker()), /trial\.json: is missing; there is nothing to undo\nNext: run trial first/);
  assert.equal(existsSync(join(empty.workDir, 'trial')), false);
  const ctx = trialWorkDir();
  await trial(ctx, fakeDocker());
  await assert.rejects(undo(ctx, fakeDocker({ selects: { database: 'name\nother_db\n' } })), /names database other_db, but the trial loaded into UniDB_shu_m/);
  assert.equal(existsSync(join(ctx.workDir, 'trial/.lock')), false);
});

test('--undo takes trial/.lock and refuses while another run holds it', async () => {
  const ctx = trialWorkDir();
  await trial(ctx, fakeDocker());
  const lock = join(ctx.workDir, 'trial/.lock');
  writeFileSync(lock, JSON.stringify({ pid: process.pid, startedAt: '2026-11-05T09:00:00.000Z' }));
  const docker = fakeDocker();
  await assert.rejects(undo(ctx, docker), (e) => e instanceof PipelineError && e.file === lock && e.problem.includes(`process ${process.pid}`));
  assert.deepEqual(docker.calls, []);
  assert.equal(existsSync(lock), true);
  rmSync(lock);
  let held = false;
  await undo(ctx, fakeDocker({ ga: (call, state) => { held ||= existsSync(lock); return undefined; } }));
  assert.equal(held, true);
});

const containerOf = (key) => `curator-trial-${process.pid}-${key.replace(/[^A-Za-z0-9_.-]/g, '_')}`;
const sigintHandler = () => process.listeners('SIGINT').at(-1);

test('every ga runs in a named container, and the name is recorded on its attempt', async () => {
  const containers = [];
  const record = await trial(trialWorkDir(), fakeDocker({ ga: (call) => { containers.push(call.container); return undefined; } }));
  assert.deepEqual(containers, FORWARD.map(containerOf));
  assert.deepEqual(record.steps.slice(0, FORWARD.length).map((s) => s.container), containers);
});

test('Ctrl-C during a step removes its container, leaves the attempt running, releases the lock and carries exit code 130', async () => {
  const ctx = trialWorkDir();
  const before = process.listenerCount('SIGINT');
  const docker = fakeDocker({ ga: (call) => { if (call.plugin === PLUGIN.sequences) sigintHandler()(); return undefined; } });
  await assert.rejects(trial(ctx, docker), (e) => e instanceof PipelineError && e.exitCode === 130
    && /^sequences:primary_chromosome \(.*\) was interrupted by SIGINT; its container was removed$/.test(e.problem) && e.next === UNDO_FIRST);
  assert.ok(docker.calls.some((c) => c.args.join(' ') === `rm -f ${containerOf(`sequences:${PRIMARY}`)}`));
  const saved = readRecord(ctx.workDir);
  assert.equal(saved.steps.at(-1).status, 'running');
  assert.equal(saved.result, 'incomplete');
  assert.equal(docker.gaCalls().length, 3);
  assert.equal(existsSync(join(ctx.workDir, 'trial/.lock')), false);
  assert.equal(process.listenerCount('SIGINT'), before);
});

test('a resume or --undo refuses while a container of this trial is still running, and names it', async () => {
  const ctx = trialWorkDir();
  const killedRun = fakeDocker({ ga: (call) => { if (call.plugin === PLUGIN.sequences) throw killed(); return undefined; } });
  await assert.rejects(trial(ctx, killedRun), /could not be run/);
  const name = containerOf(`sequences:${PRIMARY}`);
  for (const attempt of [(d) => trial(ctx, d), (d) => undo(ctx, d)]) {
    const busy = fakeDocker({ running: [name, 'curator-trial-1-other'] });
    await assert.rejects(attempt(busy), (e) => e instanceof PipelineError && e.problem === `container ${name} of this trial is still running` && e.next === `wait for it, or docker rm -f ${name}`);
    assert.deepEqual(busy.gaCalls(), []);
    assert.equal(existsSync(join(ctx.workDir, 'trial/.lock')), false);
  }
  const free = fakeDocker({ running: ['curator-trial-1-other'] });
  await assert.rejects(trial(ctx, free), (e) => e.next === UNDO_FIRST);
});

test('trial.json records the sha256 of transcriptInfoAndIds per partition, and a derived result', async () => {
  const ctx = trialWorkDir();
  const record = await trial(ctx, fakeDocker());
  assert.deepEqual(record.outputs, { [PRIMARY]: { transcriptInfoAndIds: sha256File(join(ctx.workDir, `final/${PRIMARY}/transcriptInfoAndIds`)) } });
  assert.equal(record.outputs[PRIMARY].transcriptInfoAndIds, sha256(TRANSCRIPT_IDS_TEXT));
  assert.equal(record.result, 'passed');
  assert.equal(readRecord(ctx.workDir).result, 'passed');
  const failing = await trial(trialWorkDir(), fakeDocker({ selects: { genes: 'release_id\tsource_id\n501\tTST_0010\n' } }));
  assert.equal(failing.result, 'failed');
  const stopped = trialWorkDir();
  await assert.rejects(trial(stopped, fakeDocker({ ga: (call) => (isPrint(call) ? { exitCode: 255 } : undefined) })), /exited 255/);
  assert.equal(readRecord(stopped.workDir).result, 'failed');
});

test('a failed PRINT rerun drops the recorded output until the copy succeeds again', async () => {
  const ctx = trialWorkDir();
  const docker = fakeDocker({ ga: (call, state) => (isPrint(call) && !state.once ? (state.once = true, { exitCode: 255 }) : undefined) });
  await assert.rejects(trial(ctx, docker), /exited 255/);
  assert.deepEqual(readRecord(ctx.workDir).outputs, {});
  assert.equal((await trial(ctx, docker)).outputs[PRIMARY].transcriptInfoAndIds, sha256(TRANSCRIPT_IDS_TEXT));
});

test('an invocation row Undo could not remove is a warning with the manual delete, not a failure', async () => {
  const ctx = trialWorkDir();
  const docker = fakeDocker({ selects: { invocationRows: 'algorithm_invocation_id\n7322\n' } });
  const record = await trial(ctx, docker, { keep: false });
  assert.equal(record.undone, true);
  const warning = record.findings.find((f) => f.check === 'invocationNotRemovable');
  assert.equal(warning.severity, 'warning');
  assert.equal(warning.message, 'invocation 7322 not removable by Undo (run was killed); delete it by hand: core.algorithmparam then core.algorithminvocation where algorithm_invocation_id = 7322');
});

test('--undo with another image id than the trial loaded with warns and goes on', async () => {
  const ctx = trialWorkDir();
  await trial(ctx, fakeDocker());
  const other = fakeDocker({ images: { [IMAGE]: INSPECT_BASE.replace(IMAGE_ID, 'sha256:0000000000000000') } });
  const record = await undo(ctx, other);
  assert.equal(record.undone, true);
  const warning = record.findings.find((f) => f.check === 'imageChanged');
  assert.equal(warning.severity, 'warning');
  assert.match(warning.message, /sha256:0000000000000000.*but the trial loaded with sha256:4f1c2a9b/);
});
