import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createGit } from '../shared/scripts/lib/git-ops.js';
import { validateProposal, contentValidation, reportPath } from '../shared/scripts/lib/validation-ops.js';
import { markReady } from '../shared/scripts/lib/verification-ops.js';
import { parseReportComment, formatReportComment, verifiedComment } from '../shared/scripts/lib/validation.js';
import { fixtures, initRepo, stubTicket, stubGh, validationRoot, initToolRemote } from './helpers.js';

const TICKET = { system: 'github', id: '43', url: 'https://r/issues/43' };

/** A proposal merged to origin/master with a ticket, no update open. */
function setupMerged(accession = 'PRJNA000002') {
  const { repo } = initRepo('validation-ops-');
  const dir = join(repo, 'Proposals', accession);
  cpSync(join(fixtures, 'proposals', accession), dir, { recursive: true });
  const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf-8'));
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ ...m, ticket: TICKET }, null, 2) + '\n');
  execFileSync('git', ['-C', repo, 'add', '-A']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', `merge ${accession}`]);
  execFileSync('git', ['-C', repo, 'push', '-q']);
  return { repo, git: createGit(repo, { exec: stubGh().exec }) };
}

const careful = [{ name: 'careful', tools: [], run: async () => [{ validator: 'careful', severity: 'warning', message: 'thin reads' }] }];

test('validateProposal writes the report, posts it on the ticket and names the proposal tree', async () => {
  const { repo, git } = setupMerged();
  const ticket = stubTicket();
  const { report, path } = await validateProposal({ git, ticket, repoPath: repo, accession: 'PRJNA000002', validators: careful });
  assert.equal(report.verdict, 'needs-review');
  assert.equal(report.proposalTree, git.objectId('origin/master', 'Proposals/PRJNA000002'));
  assert.equal(path, reportPath(repo, 'PRJNA000002'));
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf-8')), report);
  assert.deepEqual(parseReportComment(ticket.notes.at(-1)), report);
});

test('post: false keeps the report local', async () => {
  const { repo, git } = setupMerged();
  const ticket = stubTicket();
  await validateProposal({ git, ticket, repoPath: repo, accession: 'PRJNA000002', validators: careful, post: false });
  assert.deepEqual(ticket.notes, []);
});

test('validators see the proposal as origin/master has it, not the working tree', async () => {
  const { repo, git } = setupMerged();
  writeFileSync(join(repo, 'Proposals/PRJNA000002/curated/dataset.json'), '{}');
  let seen;
  const peek = [{ name: 'peek', tools: [], run: async ({ proposalDir }) => { seen = readFileSync(join(proposalDir, 'curated/dataset.json'), 'utf-8'); return []; } }];
  await validateProposal({ git, ticket: stubTicket(), repoPath: repo, accession: 'PRJNA000002', validators: peek, post: false });
  assert.match(seen, /"limitNU"/);
});

test('without a workspace the tool validators cannot verify, so the verdict is fail', async () => {
  const { repo, git } = setupMerged();
  const { report } = await validateProposal({ git, ticket: stubTicket(), repoPath: repo, accession: 'PRJNA000002', post: false });
  assert.equal(report.verdict, 'fail');
  assert.equal(report.workspace, null);
  for (const v of ['perlParse', 'stf']) {
    assert.ok(report.findings.some((f) => f.validator === v && /could not verify: No validation workspace given; ask the data loader/.test(f.message)), v);
  }
});

test('a missing --against ref is refused before any validator runs', async () => {
  const { repo, git } = setupMerged();
  await assert.rejects(validateProposal({ git, ticket: stubTicket(), repoPath: repo, accession: 'PRJNA000002', against: 'origin/rebuild99', validators: careful }),
    /origin\/rebuild99 does not exist/);
});

test('a type without validators is refused', async () => {
  const { repo, git } = setupMerged('GCA_000001.1');
  await assert.rejects(validateProposal({ git, ticket: stubTicket(), repoPath: repo, accession: 'GCA_000001.1' }),
    /No validators for datasetType "genome-assembly"; verify GCA_000001\.1 by hand/);
});

test('contentValidation runs the type validators on a directory', async () => {
  const proposalDir = join(fixtures, 'proposals/PRJNA000002');
  const manifest = JSON.parse(readFileSync(join(proposalDir, 'manifest.json'), 'utf-8'));
  const findings = await contentValidation({ workspace: '/no/such/workspace' })({ proposalDir, manifest });
  assert.ok(findings.some((f) => f.validator === 'perlParse' && f.severity === 'error'));
  assert.ok(findings.every((f) => f.validator !== 'buildFitness'));
});

test('contentValidation refuses a type with validators when no workspace was given, but lets a genome through', async () => {
  const proposalDir = join(fixtures, 'proposals/PRJNA000002');
  const manifest = JSON.parse(readFileSync(join(proposalDir, 'manifest.json'), 'utf-8'));
  await assert.rejects(contentValidation({})({ proposalDir, manifest }),
    /--workspace is required for bulk-rnaseq: ask the data loader which validation workspace to use/);
  assert.deepEqual(await contentValidation({})({ proposalDir, manifest: { ...manifest, datasetType: 'genome-assembly' } }), []);
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

test('validateProposal validates in proposals/<accession>/ and records each repo commit', async (t) => {
  const { repo, git } = setupMerged();
  const { root, typeDir } = emptyToolRoot(t);
  const { report } = await validateProposal({ git, ticket: stubTicket(), repoPath: repo, accession: 'PRJNA000002', workspace: root, post: false });
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

test('markReady refuses a validated type with no report on the ticket', async () => {
  const { git } = setupMerged();
  const ticket = stubTicket({ status: 'verifying' });
  await assert.rejects(markReady({ git, ticket, accession: 'PRJNA000002' }), /has no verification report; run validate-proposal\.js PRJNA000002 first/);
  assert.equal(setsStatus(ticket), false);
});

test('markReady refuses a report for an earlier version of the proposal', async () => {
  const { git } = setupMerged();
  const ticket = stubTicket({ status: 'verifying', existingComments: [formatReportComment(reportFor(git, 'pass', [], '0'.repeat(40)))] });
  await assert.rejects(markReady({ git, ticket, accession: 'PRJNA000002' }), /is for an earlier version of PRJNA000002; run validate-proposal\.js PRJNA000002 again/);
  assert.equal(setsStatus(ticket), false);
});

test('markReady refuses a failing latest report, and accepts a later passing one', async () => {
  const { git } = setupMerged();
  const failed = formatReportComment(reportFor(git, 'fail', [{ validator: 'stf', severity: 'error', message: 'bad' }]));
  await assert.rejects(markReady({ git, ticket: stubTicket({ status: 'proposed', existingComments: [failed] }), accession: 'PRJNA000002' }),
    /latest verification report on .* failed; send it back with request-revision\.js/);
  const fixed = stubTicket({ status: 'proposed', existingComments: [failed, formatReportComment(reportFor(git, 'pass'))] });
  await markReady({ git, ticket: fixed, accession: 'PRJNA000002' });
  assert.deepEqual(fixed.calls.filter((c) => c[0] === 'setStatus'), [['setStatus', '43', 'ready']]);
});

test('markReady refuses when the latest report is unreadable, never using an older one', async () => {
  const { git } = setupMerged();
  const good = formatReportComment(reportFor(git, 'pass'));
  const ticket = stubTicket({ status: 'verifying', existingComments: [good, `${good.split('\n')[0]}\nmangled`] });
  await assert.rejects(markReady({ git, ticket, accession: 'PRJNA000002' }), /latest verification report on .* is unreadable; run validate-proposal\.js PRJNA000002 again/);
  assert.equal(setsStatus(ticket), false);
});

test('markReady decides on the findings, not the stored verdict', async () => {
  const { git } = setupMerged();
  const r = reportFor(git, 'pass', [{ validator: 'stf', severity: 'error', message: 'bad' }]);
  const ticket = stubTicket({ status: 'verifying', existingComments: [formatReportComment(r)] });
  await assert.rejects(markReady({ git, ticket, accession: 'PRJNA000002' }), /failed; send it back with request-revision\.js/);
  assert.equal(setsStatus(ticket), false);
});

test('markReady records the report, accepted warnings and the note', async () => {
  const { git } = setupMerged();
  const r = reportFor(git, 'needs-review', [{ validator: 'libraryType', severity: 'warning', message: 'DNBSEQ (SRR1): adapters' }]);
  const ticket = stubTicket({ status: 'verifying', existingComments: [formatReportComment(r)] });
  const result = await markReady({ git, ticket, accession: 'PRJNA000002', note: ' presenter read ' });
  assert.equal(ticket.notes.at(-1), verifiedComment(r, 'presenter read'));
  assert.deepEqual(result.report, r);
});
