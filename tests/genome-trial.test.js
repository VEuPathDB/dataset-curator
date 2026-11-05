import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runTrial } from '../shared/scripts/genome/commands/trial.js';
import { parseTsv } from '../shared/scripts/genome/trial/gus.js';
import { modelTag, schemaFingerprint } from '../shared/scripts/genome/trial/model-image.js';
import { PipelineError, sha256File } from '../shared/scripts/genome/workdir.js';
import {
  ACD_COMMIT, DATABASE, fakeClock, fakeDocker, gaLog, IMAGE, IMAGE_ID, INSPECT_BASE, ORGANELLE, PLUGIN, PRIMARY, RELEASE, SELECTS, START,
  TAXON_ID, TRANSCRIPT_IDS_TEXT, trialDb, trialWorkDir, USER
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
    status: 'done', exitCode: 0, algInvocationId: 7319, log: `trial/logs/externalDatabase:${PRIMARY}.log`,
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

test('a ga that exits 0 without logging an AlgInvocationId fails its step', async () => {
  const ctx = trialWorkDir();
  const docker = fakeDocker({ ga: (call) => (call.plugin === PLUGIN.externalDatabase ? { id: null } : undefined) });
  await assert.rejects(trial(ctx, docker), (e) => /^externalDatabase:primary_chromosome \(GUS::Supported::Plugin::InsertExternalDatabase\) logged no AlgInvocationId/.test(e.problem)
    && e.next === RESUME_OR_UNDO);
  assert.deepEqual(readRecord(ctx.workDir).steps.map((s) => [s.status, s.exitCode, s.algInvocationId]), [['failed', 0, null]]);
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
  writeFileSync(otherLock, JSON.stringify({ pid: 4242, startedAt: '2026-11-05T09:00:00.000Z' }));
  const docker = fakeDocker();
  await assert.rejects(trial(other, docker), (e) => e instanceof PipelineError && e.file === otherLock
    && e.problem === 'is held by trial process 4242, started 2026-11-05T09:00:00.000Z'
    && e.next === 'wait for process 4242 to end; once it is gone, delete this lock file');
  assert.equal(existsSync(otherLock), true);
  assert.deepEqual(docker.calls, []);
});
