import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, readFileSync, writeFileSync, existsSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { CLASSES_RELATIVE_PATH, readDatasetClass } from '../shared/scripts/lib/dataset-classes.js';
import * as dnaseq from '../shared/scripts/dataset-types/dnaseq.js';
import { readPreprocessed } from '../shared/scripts/dataset-types/genome-assembly/preprocess.js';
import { genomeWorkArea, amendedProposal } from './genome-work-area.js';
import { createGit } from '../shared/scripts/lib/git-ops.js';
import { validateProposal, contentValidation, reportPath } from '../shared/scripts/lib/validation-ops.js';
import { markReady, requestRevision } from '../shared/scripts/lib/verification-ops.js';
import { parseReportComment, formatReportComment, verifiedComment, latestDeliveryRecord, formatDeliveryComment } from '../shared/scripts/lib/validation.js';
import { fixtures, convertToDatasetsJson, initRepo, stubTicket, stubGh, validationRoot, initToolRemote } from './helpers.js';

const TICKET = { system: 'github', id: '43', url: 'https://r/issues/43' };

/** A proposal merged to origin/master with a ticket, no update open. */
function setupMerged(accession = 'PRJNA000002', proposalId = accession, from = join(fixtures, 'proposals', accession)) {
  const { repo } = initRepo('validation-ops-');
  const dir = join(repo, 'Proposals', proposalId);
  cpSync(from, dir, { recursive: true });
  const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf-8'));
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ ...m, ticket: TICKET }, null, 2) + '\n');
  execFileSync('git', ['-C', repo, 'add', '-A']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', `merge ${accession}`]);
  execFileSync('git', ['-C', repo, 'push', '-q']);
  return { repo, git: createGit(repo, { exec: stubGh().exec }) };
}

/** The PRJNA000010 fixture with its curated dataset.json derived, as a dnaseq proposal on master has it. */
function stagedDnaseq() {
  const classes = mkdtempSync(join(tmpdir(), 'classes-'));
  mkdirSync(join(classes, 'Model/lib/xml/datasetClass'), { recursive: true });
  cpSync(join(fixtures, 'classes.xml'), join(classes, CLASSES_RELATIVE_PATH));
  const dir = join(mkdtempSync(join(tmpdir(), 'dnaseq-')), 'PRJNA000010');
  cpSync(join(fixtures, 'proposals/PRJNA000010'), dir, { recursive: true, filter: (p) => !/expected/.test(p) });
  dnaseq.normalizeCurated(dir);
  writeFileSync(join(dir, 'curated/dataset.json'), JSON.stringify(dnaseq.deriveDataset(dir, readDatasetClass(classes, 'dnaseqExperiment'), {}), null, 2) + '\n');
  return dir;
}

const careful = [{ name: 'careful', tools: [], run: async () => [{ validator: 'careful', severity: 'warning', message: 'thin reads' }] }];

test('validateProposal writes the report, posts it on the ticket and names the proposal tree', async () => {
  const { repo, git } = setupMerged();
  const ticket = stubTicket();
  const { report, path } = await validateProposal({ git, ticket, repoPath: repo, proposalId: 'PRJNA000002', validators: careful });
  assert.equal(report.verdict, 'needs-review');
  assert.equal(report.proposalTree, git.objectId('origin/master', 'Proposals/PRJNA000002'));
  assert.equal(path, reportPath(repo, 'PRJNA000002'));
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf-8')), report);
  assert.deepEqual(parseReportComment(ticket.notes.at(-1)), report);
});

test('validateProposal reports a bulk-rnaseq sibling (another type holds the accession) under its id', async () => {
  const { repo, git } = setupMerged('PRJNA000002', 'PRJNA000002_bulk-rnaseq');
  const { report, path } = await validateProposal({ git, ticket: stubTicket(), repoPath: repo, proposalId: 'PRJNA000002_bulk-rnaseq', validators: careful });
  assert.equal(path, join(repo, '.curation/tmp/verify/PRJNA000002_bulk-rnaseq.json'));
  assert.equal(report.accession, 'PRJNA000002');
  assert.equal(report.proposalId, 'PRJNA000002_bulk-rnaseq');
  assert.equal(report.proposalTree, git.objectId('origin/master', 'Proposals/PRJNA000002_bulk-rnaseq'));
});

test('post: false keeps the report local', async () => {
  const { repo, git } = setupMerged();
  const ticket = stubTicket();
  await validateProposal({ git, ticket, repoPath: repo, proposalId: 'PRJNA000002', validators: careful, post: false });
  assert.deepEqual(ticket.notes, []);
});

test('validators see the proposal as origin/master has it, not the working tree', async () => {
  const { repo, git } = setupMerged();
  writeFileSync(join(repo, 'Proposals/PRJNA000002/curated/dataset.json'), '{}');
  let seen;
  const peek = [{ name: 'peek', tools: [], run: async ({ proposalDir }) => { seen = readFileSync(join(proposalDir, 'curated/dataset.json'), 'utf-8'); return []; } }];
  await validateProposal({ git, ticket: stubTicket(), repoPath: repo, proposalId: 'PRJNA000002', validators: peek, post: false });
  assert.match(seen, /"limitNU"/);
});

test('without a workspace the tool validators cannot verify, so the verdict is fail', async () => {
  const { repo, git } = setupMerged();
  const { report } = await validateProposal({ git, ticket: stubTicket(), repoPath: repo, proposalId: 'PRJNA000002', post: false });
  assert.equal(report.verdict, 'fail');
  assert.equal(report.workspace, null);
  for (const v of ['perlParse', 'stf']) {
    assert.ok(report.findings.some((f) => f.validator === v && /could not verify: No validation workspace given; ask the data loader/.test(f.message)), v);
  }
});

test('a missing --against ref is refused before any validator runs', async () => {
  const { repo, git } = setupMerged();
  await assert.rejects(validateProposal({ git, ticket: stubTicket(), repoPath: repo, proposalId: 'PRJNA000002', against: 'origin/rebuild99', validators: careful }),
    /origin\/rebuild99 does not exist/);
});

test('a type without validators is refused', async () => {
  const { repo, git } = setupMerged('PRJNA000010');
  await assert.rejects(validateProposal({ git, ticket: stubTicket(), repoPath: repo, proposalId: 'PRJNA000010' }),
    /No validators for datasetType "dnaseq"; verify PRJNA000010 by hand/);
});

test('contentValidation runs the type validators on a directory', async () => {
  const proposalDir = join(fixtures, 'proposals/PRJNA000002');
  const manifest = JSON.parse(readFileSync(join(proposalDir, 'manifest.json'), 'utf-8'));
  const findings = await contentValidation({ workspace: '/no/such/workspace' })({ proposalDir, manifest });
  assert.ok(findings.some((f) => f.validator === 'perlParse' && f.severity === 'error'));
  assert.ok(findings.every((f) => f.validator !== 'buildFitness'));
});

test('contentValidation refuses a type with validators when no workspace was given, but lets a type without validators through', async () => {
  const proposalDir = join(fixtures, 'proposals/PRJNA000002');
  const manifest = JSON.parse(readFileSync(join(proposalDir, 'manifest.json'), 'utf-8'));
  await assert.rejects(contentValidation({})({ proposalDir, manifest }),
    /--workspace is required for bulk-rnaseq: ask the data loader which validation workspace root to use/);
  assert.deepEqual(await contentValidation({})({ proposalDir, manifest: { ...manifest, datasetType: 'chipseq' } }), []);
});

const removedAfter = (t, dir) => { t.after(() => rmSync(dir, { recursive: true, force: true })); return dir; };

/** A root whose rnaseq-validation has one repo and a build that installs nothing. */
function emptyToolRoot(t) {
  const remotes = removedAfter(t, mkdtempSync(join(tmpdir(), 'tool-remotes-')));
  const acd = initToolRemote(remotes, 'ApiCommonData', { branches: ['rebuild70'] });
  // process.execPath stands in for perl: it always exists, and the modules check fails first.
  const r = validationRoot({ ApiCommonData: { url: acd.url, ref: 'master', followsRebuild: true } }, { executables: { perl: process.execPath } });
  removedAfter(t, r.root);
  return r;
}

test('validateProposal validates in proposals/<proposalId>/ and records each repo commit', async (t) => {
  const { repo, git } = setupMerged();
  const { root, typeDir } = emptyToolRoot(t);
  const { report } = await validateProposal({ git, ticket: stubTicket(), repoPath: repo, proposalId: 'PRJNA000002', workspace: root, post: false });
  assert.equal(report.workspace, join(typeDir, 'proposals/PRJNA000002'));
  assert.deepEqual(Object.keys(report.repos), ['ApiCommonData']);
  assert.equal(report.repos.ApiCommonData.ref, 'master');
  assert.match(report.repos.ApiCommonData.sha, /^[0-9a-f]{40}$/);
  assert.ok(report.findings.some((f) => f.validator === 'perlParse' && /could not verify: .*has no AnalysisConfigParser\.pm/.test(f.message)));
});

test('contentValidation validates in loads/<rebuild>/', async (t) => {
  const proposalDir = join(fixtures, 'proposals/PRJNA000002');
  const manifest = JSON.parse(readFileSync(join(proposalDir, 'manifest.json'), 'utf-8'));
  const { root, typeDir } = emptyToolRoot(t);
  await contentValidation({ workspace: root, rebuildBranch: 'rebuild70' })({ proposalDir, manifest });
  assert.ok(existsSync(join(typeDir, 'loads/rebuild70/ApiCommonData')));
});

const reportFor = (git, verdict, findings = [], tree) => ({
  schemaVersion: 1, accession: 'PRJNA000002', datasetType: 'bulk-rnaseq',
  proposalTree: tree ?? git.objectId('origin/master', 'Proposals/PRJNA000002'), against: null, workspace: '/ws',
  tools: { apiCommonData: 'c0ffee', studyWrangler: '1.0.41' }, findings, verdict
});
const setsStatus = (ticket) => ticket.calls.some((c) => c[0] === 'setStatus');

/** A disposal that records its calls; refuse makes assertDisposable throw, failDispose makes dispose throw, none finds nothing. */
const disposalStub = ({ refuse = false, failDispose = false, none = false } = {}) => {
  const calls = [];
  return {
    calls,
    assertDisposable(type) { calls.push(['assert', type]); if (refuse) throw new Error('proposals/PRJNA000002 cannot be removed; push them'); },
    where: () => ({ typeDir: '/ws', dir: '/ws/proposals/PRJNA000002' }),
    dispose(type) {
      calls.push(['dispose', type]);
      if (failDispose) throw new Error('worktree remove failed');
      return none ? null : '/ws/proposals/PRJNA000002';
    }
  };
};

const deliveryStub = (git, { tree, none = false, against = 'origin/master' } = {}) => ({
  read: () => none ? null : { record: { proposalTree: tree ?? git.objectId('origin/master', 'Proposals/PRJNA000002'), against, settlement: [{ proposed: 'tfakST1', abbrev: 'tfakST1' }], build: '02', release: '2026-10', corpusStep: 'ssh yew x', handoff: 'Copy\n  rsync -a' }, sha: 'e'.repeat(64), dir: '/ws/delivery/PRJNA000002' }
});

test('markReady checks entries against the classes of the ref the delivery was prepared against', async () => {
  const { repo, git } = setupMerged();
  execFileSync('git', ['-C', repo, 'push', '-q', 'origin', 'HEAD:rebuild02']);
  execFileSync('git', ['-C', repo, 'rm', '-q', CLASSES_RELATIVE_PATH]);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'classes gone from master']);
  execFileSync('git', ['-C', repo, 'push', '-q']);
  const ticket = stubTicket({ status: 'verifying', existingComments: [formatReportComment(reportFor(git, 'pass'))] });
  git.fetch();
  const result = await markReady({ git, ticket, proposalId: 'PRJNA000002', workspace: disposalStub(), delivery: deliveryStub(git, { against: 'origin/rebuild02' }) });
  assert.equal(result.status, 'ready');
});

test('markReady refuses entries whose class is missing on the delivery ref even though master has it, before posting anything', async () => {
  const { repo, git } = setupMerged();
  execFileSync('git', ['-C', repo, 'rm', '-q', CLASSES_RELATIVE_PATH]);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'classes gone from the rebuild branch']);
  execFileSync('git', ['-C', repo, 'push', '-q', 'origin', 'HEAD:rebuild02']);
  execFileSync('git', ['-C', repo, 'reset', '-q', '--hard', 'HEAD~1']);
  git.fetch();
  const ticket = stubTicket({ status: 'verifying', existingComments: [formatReportComment(reportFor(git, 'pass'))] });
  await assert.rejects(markReady({ git, ticket, proposalId: 'PRJNA000002', workspace: disposalStub(), delivery: deliveryStub(git, { against: 'origin/rebuild02' }) }),
    /classes\.xml/);
  assert.equal(setsStatus(ticket), false);
  assert.equal(ticket.comments(), 0);
});

test('markReady refuses a delivery prepared against a ref that no longer exists, before posting anything', async () => {
  const { git } = setupMerged();
  const ticket = stubTicket({ status: 'verifying', existingComments: [formatReportComment(reportFor(git, 'pass'))] });
  await assert.rejects(markReady({ git, ticket, proposalId: 'PRJNA000002', workspace: disposalStub(), delivery: deliveryStub(git, { against: 'origin/rebuild99' }) }),
    /The delivery of PRJNA000002 was prepared against origin\/rebuild99, which does not exist here; fetch it, or run prepare-delivery\.js again/);
  assert.equal(setsStatus(ticket), false);
  assert.equal(ticket.comments(), 0);
});

test('markReady refuses a type with a dataset class without a current delivery', async () => {
  const { git } = setupMerged();
  const ticket = stubTicket({ status: 'verifying', existingComments: [formatReportComment(reportFor(git, 'pass'))] });
  await assert.rejects(markReady({ git, ticket, proposalId: 'PRJNA000002', workspace: disposalStub(), delivery: deliveryStub(git, { none: true }) }),
    /No delivery for PRJNA000002; run prepare-delivery\.js --workspace <root> --against origin\/rebuild<RR> PRJNA000002 first/);
  await assert.rejects(markReady({ git, ticket, proposalId: 'PRJNA000002', workspace: disposalStub(), delivery: deliveryStub(git, { tree: 'old' }) }),
    /The delivery of PRJNA000002 is for an earlier version of it; run prepare-delivery\.js again/);
  assert.equal(setsStatus(ticket), false);
});

test('markReady refuses a missing or stale delivery before posting any comment', async () => {
  const { git } = setupMerged();
  for (const delivery of [deliveryStub(git, { none: true }), deliveryStub(git, { tree: 'old' }), undefined]) {
    const ticket = stubTicket({ status: 'verifying', existingComments: [formatReportComment(reportFor(git, 'pass'))] });
    await assert.rejects(markReady({ git, ticket, proposalId: 'PRJNA000002', note: 'n', workspace: disposalStub(), delivery }));
    assert.deepEqual(ticket.calls.filter((c) => c[0] === 'comment' || c[0] === 'setStatus'), []);
  }
});

test('markReady refuses a delivery prepared for another build or release, before posting any comment', async () => {
  const { git } = setupMerged();
  const report = formatReportComment(reportFor(git, 'pass'));
  for (const [opts, drift] of [[{ build: '03' }, /build 02 \/ release 2026-10; the ticket now says build 03 \/ release 2026-10; run prepare-delivery\.js again/],
    [{ release: '2026-11' }, /build 02 \/ release 2026-10; the ticket now says build 02 \/ release 2026-11; run prepare-delivery\.js again/]]) {
    const ticket = stubTicket({ status: 'verifying', existingComments: [report], ...opts });
    await assert.rejects(markReady({ git, ticket, proposalId: 'PRJNA000002', note: 'n', workspace: disposalStub(), delivery: deliveryStub(git) }),
      new RegExp(`The delivery of PRJNA000002 was prepared for ${drift.source}`));
    assert.deepEqual(ticket.calls.filter((c) => c[0] === 'comment' || c[0] === 'setStatus'), []);
  }
});

test('markReady posts the delivery record even when an identical one is already on the ticket', async () => {
  const { git } = setupMerged();
  const delivery = deliveryStub(git);
  const { record, sha } = delivery.read();
  const earlier = formatDeliveryComment(record, sha);
  const other = formatDeliveryComment({ ...record, proposalTree: 'B' }, sha);
  const ticket = stubTicket({ status: 'verifying', existingComments: [formatReportComment(reportFor(git, 'pass')), earlier, other] });
  await markReady({ git, ticket, proposalId: 'PRJNA000002', workspace: disposalStub(), delivery });
  assert.equal(latestDeliveryRecord(ticket.notes).record.proposalTree, record.proposalTree);
});

test('markReady re-run on a ready ticket is refused, so it never posts a duplicate delivery record', async () => {
  const { git } = setupMerged();
  const ticket = stubTicket({ status: 'ready', existingComments: [formatReportComment(reportFor(git, 'pass'))] });
  await assert.rejects(markReady({ git, ticket, proposalId: 'PRJNA000002', workspace: disposalStub(), delivery: deliveryStub(git) }), /is at "Ready to load"; only a "Proposed" or "Preprocessing" proposal can be marked ready/);
  assert.deepEqual(ticket.calls.filter((c) => c[0] === 'comment'), []);
});

test('markReady posts the delivery record with the handoff before setting ready', async () => {
  const { repo, git } = setupMerged();
  execFileSync('git', ['-C', repo, 'push', '-q', 'origin', 'HEAD:rebuild02']);
  git.fetch();
  const ticket = stubTicket({ status: 'verifying', existingComments: [formatReportComment(reportFor(git, 'pass'))] });
  await markReady({ git, ticket, proposalId: 'PRJNA000002', workspace: disposalStub(), delivery: deliveryStub(git, { against: 'origin/rebuild02' }) });
  const posted = ticket.calls.filter((c) => c[0] === 'comment').map((c) => c[2]);
  const record = latestDeliveryRecord(posted).record;
  assert.equal(record.against, 'origin/rebuild02');
  assert.equal(record.build, '02');
  assert.ok(posted.at(-1).includes('rsync -a'));
  assert.deepEqual(ticket.calls.at(-1), ['setStatus', '43', 'ready']);
});

test('markReady refuses a validated type with no report on the ticket', async () => {
  const { git } = setupMerged();
  const ticket = stubTicket({ status: 'verifying' });
  await assert.rejects(markReady({ git, ticket, proposalId: 'PRJNA000002', workspace: disposalStub() }), /has no verification report; run validate-proposal\.js --workspace <root> PRJNA000002 first/);
  assert.equal(setsStatus(ticket), false);
});

test('markReady refuses a report for an earlier version of the proposal', async () => {
  const { git } = setupMerged();
  const ticket = stubTicket({ status: 'verifying', existingComments: [formatReportComment(reportFor(git, 'pass', [], '0'.repeat(40)))] });
  await assert.rejects(markReady({ git, ticket, proposalId: 'PRJNA000002', workspace: disposalStub() }), /is for an earlier version of PRJNA000002; run validate-proposal\.js --workspace <root> PRJNA000002 again/);
  assert.equal(setsStatus(ticket), false);
});

test('markReady refuses a failing latest report, and accepts a later passing one', async () => {
  const { git } = setupMerged();
  const failed = formatReportComment(reportFor(git, 'fail', [{ validator: 'stf', severity: 'error', message: 'bad' }]));
  await assert.rejects(markReady({ git, ticket: stubTicket({ status: 'proposed', existingComments: [failed] }), proposalId: 'PRJNA000002', workspace: disposalStub() }),
    /latest verification report on .* failed; send it back with request-revision\.js/);
  const fixed = stubTicket({ status: 'proposed', existingComments: [failed, formatReportComment(reportFor(git, 'pass'))] });
  await markReady({ git, ticket: fixed, proposalId: 'PRJNA000002', workspace: disposalStub(), delivery: deliveryStub(git) });
  assert.deepEqual(fixed.calls.filter((c) => c[0] === 'setStatus'), [['setStatus', '43', 'ready']]);
});

test('markReady refuses when the latest report is unreadable, never using an older one', async () => {
  const { git } = setupMerged();
  const good = formatReportComment(reportFor(git, 'pass'));
  const ticket = stubTicket({ status: 'verifying', existingComments: [good, `${good.split('\n')[0]}\nmangled`] });
  await assert.rejects(markReady({ git, ticket, proposalId: 'PRJNA000002', workspace: disposalStub() }), /latest verification report on .* is unreadable; run validate-proposal\.js --workspace <root> PRJNA000002 again/);
  assert.equal(setsStatus(ticket), false);
});

test('markReady decides on the findings, not the stored verdict', async () => {
  const { git } = setupMerged();
  const r = reportFor(git, 'pass', [{ validator: 'stf', severity: 'error', message: 'bad' }]);
  const ticket = stubTicket({ status: 'verifying', existingComments: [formatReportComment(r)] });
  await assert.rejects(markReady({ git, ticket, proposalId: 'PRJNA000002', workspace: disposalStub() }), /failed; send it back with request-revision\.js/);
  assert.equal(setsStatus(ticket), false);
});

test('markReady records the report, accepted warnings and the note', async () => {
  const { git } = setupMerged();
  const r = reportFor(git, 'needs-review', [{ validator: 'libraryType', severity: 'warning', message: 'DNBSEQ (SRR1): adapters' }]);
  const ticket = stubTicket({ status: 'verifying', existingComments: [formatReportComment(r)] });
  const result = await markReady({ git, ticket, proposalId: 'PRJNA000002', note: ' presenter read ', workspace: disposalStub(), delivery: deliveryStub(git) });
  assert.equal(ticket.notes.at(-2), verifiedComment(r, 'presenter read'));
  assert.deepEqual(result.report, r);
});

test('markReady needs the workspace for a validated type', async () => {
  const { git } = setupMerged();
  const ticket = stubTicket({ status: 'verifying', existingComments: [formatReportComment(reportFor(git, 'pass'))] });
  await assert.rejects(markReady({ git, ticket, proposalId: 'PRJNA000002' }), /--workspace is required for bulk-rnaseq: mark-ready removes the proposal's validation workspace/);
  assert.equal(setsStatus(ticket), false);
});

test('markReady refuses before any ticket change when the workspace holds work, and disposes of it after ready', async () => {
  const { git } = setupMerged();
  const comments = [formatReportComment(reportFor(git, 'pass'))];
  const refusing = stubTicket({ status: 'verifying', existingComments: comments });
  await assert.rejects(markReady({ git, ticket: refusing, proposalId: 'PRJNA000002', workspace: disposalStub({ refuse: true }), delivery: deliveryStub(git) }), /cannot be removed; push them/);
  assert.equal(setsStatus(refusing), false);
  const ticket = stubTicket({ status: 'verifying', existingComments: comments });
  const disposal = disposalStub();
  const result = await markReady({ git, ticket, proposalId: 'PRJNA000002', workspace: disposal, delivery: deliveryStub(git) });
  assert.deepEqual(disposal.calls, [['assert', 'bulk-rnaseq'], ['dispose', 'bulk-rnaseq']]);
  assert.equal(result.disposed, '/ws/proposals/PRJNA000002');
  assert.equal(result.disposeError, null);
  assert.equal(result.noWorkspaceUnder, null);
});

test('markReady reports a failed removal after ready instead of rejecting', async () => {
  const { git } = setupMerged();
  const ticket = stubTicket({ status: 'verifying', existingComments: [formatReportComment(reportFor(git, 'pass'))] });
  const result = await markReady({ git, ticket, proposalId: 'PRJNA000002', workspace: disposalStub({ failDispose: true }), delivery: deliveryStub(git) });
  assert.equal(result.status, 'ready');
  assert.ok(ticket.calls.some((c) => c[0] === 'setStatus' && c.includes('ready')));
  assert.equal(result.disposed, null);
  assert.match(result.disposeError, /^\/ws\/proposals\/PRJNA000002 was not removed: worktree remove failed; the ticket is already ready, so remove it by hand \(git -C <base> worktree remove <path>, then .*branch -D verify\/PRJNA000002\)/);
  assert.equal(result.noWorkspaceUnder, null);
});

test('markReady notes a validated type with no workspace for the proposal', async () => {
  const { git } = setupMerged();
  const ticket = stubTicket({ status: 'verifying', existingComments: [formatReportComment(reportFor(git, 'pass'))] });
  const result = await markReady({ git, ticket, proposalId: 'PRJNA000002', workspace: disposalStub({ none: true }), delivery: deliveryStub(git) });
  assert.equal(result.status, 'ready');
  assert.equal(result.disposed, null);
  assert.equal(result.noWorkspaceUnder, '/ws');
});

test('requestRevision leaves proposals/<proposalId>/ in place', async (t) => {
  const { repo, git } = setupMerged();
  const { typeDir } = emptyToolRoot(t);
  const dir = join(typeDir, 'proposals/PRJNA000002');
  mkdirSync(dir, { recursive: true });
  await requestRevision({ git, ticket: stubTicket({ status: 'verifying' }), repoPath: repo, proposalId: 'PRJNA000002', reason: 'r' });
  assert.ok(existsSync(dir));
});

test('markReady ignores the workspace for a type without validators', async () => {
  const { git } = setupMerged('PRJNA000010', 'PRJNA000010', stagedDnaseq());
  const ticket = stubTicket({ status: 'verifying' });
  const disposal = disposalStub({ refuse: true, failDispose: true });
  const delivery = deliveryStub(git, { tree: git.objectId('origin/master', 'Proposals/PRJNA000010') });
  const result = await markReady({ git, ticket, proposalId: 'PRJNA000010', workspace: disposal, delivery });
  assert.equal(result.status, 'ready');
  assert.deepEqual(disposal.calls, []);
  assert.equal(result.disposed, null);
  assert.equal(result.disposeError, null);
  assert.equal(result.noWorkspaceUnder, null);
});

test('markReady reads a datasets.json proposal: refuses a stray prop in it, then marks it ready once fixed', async () => {
  const { repo, git } = setupMerged();
  const dir = join(repo, 'Proposals/PRJNA000002');
  convertToDatasetsJson(dir);
  const path = join(dir, 'curated/datasets.json');
  const good = readFileSync(path, 'utf-8');
  const publish = (message) => {
    execFileSync('git', ['-C', repo, 'add', '-A']);
    execFileSync('git', ['-C', repo, 'commit', '-q', '-m', message]);
    execFileSync('git', ['-C', repo, 'push', '-q']);
    git.fetch();
  };
  const d = JSON.parse(good);
  writeFileSync(path, JSON.stringify({ ...d, datasets: [{ ...d.datasets[0], props: { ...d.datasets[0].props, colour: 'red' } }] }, null, 2) + '\n');
  publish('stray prop in datasets.json');
  const stale = stubTicket({ status: 'verifying', existingComments: [formatReportComment(reportFor(git, 'pass'))] });
  await assert.rejects(markReady({ git, ticket: stale, proposalId: 'PRJNA000002', note: 'n', workspace: disposalStub(), delivery: deliveryStub(git) }),
    /Invalid dataset entries of PRJNA000002:\n  - rnaSeqExperiment Doe_heat_shock_2024: props\.colour is not a prop of class rnaSeqExperiment/);
  assert.deepEqual(stale.calls.filter((c) => c[0] === 'comment' || c[0] === 'setStatus'), []);

  writeFileSync(path, good);
  publish('fix datasets.json');
  const ticket = stubTicket({ status: 'verifying', existingComments: [formatReportComment(reportFor(git, 'pass'))] });
  await markReady({ git, ticket, proposalId: 'PRJNA000002', workspace: disposalStub(), delivery: deliveryStub(git) });
  assert.deepEqual(ticket.calls.at(-1), ['setStatus', '43', 'ready']);
});

test('markReady refuses invalid dataset entries before posting anything', async () => {
  const { repo, git } = setupMerged();
  const path = join(repo, 'Proposals/PRJNA000002/curated/dataset.json');
  const d = JSON.parse(readFileSync(path, 'utf-8'));
  writeFileSync(path, JSON.stringify({ ...d, props: { ...d.props, colour: 'red' } }, null, 2) + '\n');
  execFileSync('git', ['-C', repo, 'commit', '-qam', 'stray prop']);
  execFileSync('git', ['-C', repo, 'push', '-q']);
  git.fetch();
  const ticket = stubTicket({ status: 'verifying', existingComments: [formatReportComment(reportFor(git, 'pass'))] });
  await assert.rejects(markReady({ git, ticket, proposalId: 'PRJNA000002', note: 'n', workspace: disposalStub(), delivery: deliveryStub(git) }),
    /Invalid dataset entries of PRJNA000002:\n  - rnaSeqExperiment Doe_heat_shock_2024: props\.colour is not a prop of class rnaSeqExperiment/);
  assert.deepEqual(ticket.calls.filter((c) => c[0] === 'comment' || c[0] === 'setStatus'), []);
});

/** A root whose annotated-genome-validation clones and builds nothing. */
function genomeRoot(t) {
  const root = removedAfter(t, mkdtempSync(join(tmpdir(), 'validation-root-')));
  const typeDir = join(root, 'annotated-genome-validation');
  mkdirSync(typeDir);
  writeFileSync(join(typeDir, 'env.json'), JSON.stringify({ schemaVersion: 2, repos: {}, executables: {} }));
  return { root, typeDir };
}

/** GCA_000001.1 amended from workArea and merged to origin/master with a ticket. */
function setupAmendedGenome(workArea) {
  const { repo } = initRepo('validation-ops-');
  const dir = join(repo, 'Proposals/GCA_000001.1');
  cpSync(amendedProposal(workArea).dir, dir, { recursive: true });
  const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf-8'));
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ ...m, ticket: TICKET }, null, 2) + '\n');
  execFileSync('git', ['-C', repo, 'add', '-A']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'merge GCA_000001.1']);
  execFileSync('git', ['-C', repo, 'push', '-q']);
  return { repo, git: createGit(repo, { exec: stubGh().exec }) };
}

test('validateProposal gives genome validators the work area and keeps its record sha256s in the report', async (t) => {
  const { root, typeDir } = genomeRoot(t);
  const workArea = genomeWorkArea({ at: join(typeDir, 'proposals/GCA_000001.1/preprocess') });
  const { repo, git } = setupAmendedGenome(workArea);
  const { report } = await validateProposal({ git, ticket: stubTicket(), repoPath: repo, proposalId: 'GCA_000001.1', workspace: root, post: false });
  assert.deepEqual(report.findings, []);
  assert.equal(report.verdict, 'pass');
  assert.deepEqual(report.preprocess, readPreprocessed(workArea).sha256);
});

test('contentValidation runs only content validators: a genome needs no work area at load', async (t) => {
  const { root } = genomeRoot(t);
  const { dir, manifest } = amendedProposal(genomeWorkArea());
  assert.deepEqual(await contentValidation({ workspace: root, rebuildBranch: 'rebuild70' })({ proposalDir: dir, manifest }), []);
});
