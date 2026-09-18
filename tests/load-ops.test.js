import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createGit } from '../shared/scripts/lib/git-ops.js';
import { checkLoadPreconditions, loadProposal, listProposals } from '../shared/scripts/lib/load-ops.js';

const fixtures = new URL('./fixtures/', import.meta.url).pathname;

/**
 * Origin + clone with: allContacts.xml, an empty FungiDB.xml presenter file,
 * two proposals (build 02 and 03) on master, and rebuild02 cut from master.
 */
function setupRepo() {
  const root = mkdtempSync(join(tmpdir(), 'load-ops-'));
  const bare = join(root, 'origin.git');
  const repo = join(root, 'VEuPathDatasets');
  execFileSync('git', ['init', '--bare', '-q', '--initial-branch=master', bare]);
  execFileSync('git', ['clone', '-q', bare, repo]);
  execFileSync('git', ['-C', repo, 'config', 'user.email', 'loader@apidb.org']);
  execFileSync('git', ['-C', repo, 'config', 'user.name', 'Loader']);
  mkdirSync(join(repo, 'Model/lib/xml/datasetPresenters/contacts'), { recursive: true });
  cpSync(join(fixtures, 'allContacts.xml'), join(repo, 'Model/lib/xml/datasetPresenters/contacts/allContacts.xml'));
  writeFileSync(join(repo, 'Model/lib/xml/datasetPresenters/FungiDB.xml'), '<?xml version="1.0"?>\n<datasetPresenters>\n</datasetPresenters>\n');
  cpSync(join(fixtures, 'proposals/GCA_000001.1'), join(repo, 'Proposals/GCA_000001.1'), { recursive: true });
  cpSync(join(fixtures, 'proposals/PRJNA000002'), join(repo, 'Proposals/PRJNA000002'), { recursive: true });
  // PRJNA000002 targets build 03 in this scenario
  setManifestFields(repo, 'PRJNA000002', { targetBuild: '03' });
  execFileSync('git', ['-C', repo, 'add', '.']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init with proposals']);
  execFileSync('git', ['-C', repo, 'push', '-q', '-u', 'origin', 'master']);
  execFileSync('git', ['-C', repo, 'checkout', '-q', '-b', 'rebuild02']);
  execFileSync('git', ['-C', repo, 'push', '-q', '-u', 'origin', 'rebuild02']);
  return { root, repo, bare };
}

function setManifestFields(repo, accession, fields) {
  const path = join(repo, 'Proposals', accession, 'manifest.json');
  const m = JSON.parse(readFileSync(path, 'utf-8'));
  writeFileSync(path, JSON.stringify({ ...m, ...fields }, null, 2) + '\n');
}

/** Commits and pushes the current branch. */
function commitAll(repo, message) {
  execFileSync('git', ['-C', repo, 'add', '-A']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', message]);
  execFileSync('git', ['-C', repo, 'push', '-q']);
}

function stubTicket() {
  const calls = [];
  return {
    calls,
    async comment(ref, body) { calls.push(['comment', ref.id, body]); },
    async setStatus(ref, s) { calls.push(['setStatus', ref.id, s]); },
    async getStatus() { return 'proposed'; },
    async create() { throw new Error('not used'); }
  };
}

/**
 * Stubs gh: auth status passes, pr create returns a URL (optionally throwing
 * the first time *after* the PR exists), pr view reports the PR once it does.
 */
function ghStub({ url = 'https://github.com/x/y/pull/1', failCreates = 0 } = {}) {
  const calls = [];
  let creates = 0;
  let prUrl = null;
  const exec = (cmd, args, opts) => {
    if (cmd !== 'gh') return execFileSync(cmd, args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    calls.push(args);
    if (args[0] === 'auth') return '';
    if (args[0] === 'pr' && args[1] === 'create') {
      prUrl = url;
      if (++creates <= failCreates) throw new Error('gh: the PR was opened but the response was lost');
      return `${url}\n`;
    }
    if (args[0] === 'pr' && args[1] === 'view') {
      if (!prUrl) throw new Error('no pull requests found for branch');
      return `${prUrl}\n`;
    }
    throw new Error(`unexpected gh call: ${args.join(' ')}`);
  };
  return { exec, calls };
}

test('listProposals reads manifests on the current branch and filters by build', () => {
  const { repo } = setupRepo();
  const all = listProposals(repo);
  assert.deepEqual(all.map(p => p.accession).sort(), ['GCA_000001.1', 'PRJNA000002']);
  assert.deepEqual(listProposals(repo, { build: '02' }).map(p => p.accession), ['GCA_000001.1']);
});

test('preconditions: wrong branch names the checkout command', async () => {
  const { repo } = setupRepo();
  const git = createGit(repo);
  git.checkout('master');
  await assert.rejects(
    checkLoadPreconditions({ git, repoPath: repo, accession: 'GCA_000001.1' }),
    /on branch "master" but the proposal targets build 02 \(rebuild02\).*checkout rebuild02/s
  );
});

test('preconditions: an existing load branch names the delete command', async () => {
  const { repo } = setupRepo();
  const git = createGit(repo);
  git.createBranch('load/GCA_000001.1', 'rebuild02');
  git.checkout('rebuild02');
  await assert.rejects(
    checkLoadPreconditions({ git, repoPath: repo, accession: 'GCA_000001.1' }),
    /load\/GCA_000001\.1 already exists.*branch -D load\/GCA_000001\.1/s
  );
});

test('straggler: proposal only on master is cherry-picked onto the load branch and loaded', async () => {
  const { repo } = setupRepo();
  // add a build-02 proposal on master only, after rebuild02 was cut
  const git0 = createGit(repo);
  git0.checkout('master');
  cpSync(join(fixtures, 'proposals/PRJNA000002_no_overrides'), join(repo, 'Proposals/PRJNA000002_no_overrides'), { recursive: true });
  commitAll(repo, 'straggler');
  const sha = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim();
  git0.checkout('rebuild02');

  const pre = await checkLoadPreconditions({ git: git0, repoPath: repo, accession: 'PRJNA000002_no_overrides' });
  assert.deepEqual(pre.straggler, [sha]);

  const git = createGit(repo, { exec: ghStub({ url: 'https://github.com/x/y/pull/2' }).exec });
  const result = await loadProposal({ git, ticket: stubTicket(), repoPath: repo, accession: 'PRJNA000002_no_overrides' });
  assert.deepEqual(result.cherryPicked, [sha]);
  assert.equal(result.presenterName, 'tfak_PRJNA000002_no_overrides_rnaSeq_RSRC');
  assert.equal(git.fileExistsOnRef('origin/load/PRJNA000002_no_overrides', 'Proposals/PRJNA000002_no_overrides/manifest.json'), false);
  assert.match(git.showFile('origin/load/PRJNA000002_no_overrides', 'Model/lib/xml/datasetPresenters/FungiDB.xml'), /tfak_PRJNA000002_no_overrides_rnaSeq_RSRC/);
});

test('a missing proposal anywhere is a clear error', async () => {
  const { repo } = setupRepo();
  await assert.rejects(
    checkLoadPreconditions({ git: createGit(repo), repoPath: repo, accession: 'NOPE' }),
    /No proposal found/
  );
});

test('preconditions: presenter name collision', async () => {
  const { repo } = setupRepo();
  writeFileSync(join(repo, 'Model/lib/xml/datasetPresenters/FungiDB.xml'),
    '<datasetPresenters>\n  <datasetPresenter name="tfakST1_primary_genome_RSRC"></datasetPresenter>\n</datasetPresenters>\n');
  execFileSync('git', ['-C', repo, 'commit', '-q', '-am', 'collide']);
  const git = createGit(repo);
  await assert.rejects(
    checkLoadPreconditions({ git, repoPath: repo, accession: 'GCA_000001.1' }),
    /already exists in Model\/lib\/xml\/datasetPresenters\/FungiDB\.xml/
  );
});

test('loadProposal renders, deletes, commits, pushes, opens PR, updates ticket', async () => {
  const { repo } = setupRepo();
  setManifestFields(repo, 'GCA_000001.1', { ticket: { system: 'redmine', id: '42', url: 'https://r/issues/42' } });
  commitAll(repo, 'ticket');

  const git = createGit(repo, { exec: ghStub({ url: 'https://github.com/VEuPathDB/VEuPathDatasets/pull/11' }).exec });
  const ticket = stubTicket();
  const result = await loadProposal({ git, ticket, repoPath: repo, accession: 'GCA_000001.1' });

  assert.equal(result.presenterName, 'tfakST1_primary_genome_RSRC');
  assert.equal(result.prUrl, 'https://github.com/VEuPathDB/VEuPathDatasets/pull/11');
  assert.equal(git.currentBranch(), 'load/GCA_000001.1');
  assert.equal(git.isClean(), true);
  assert.equal(existsSync(join(repo, 'Proposals/GCA_000001.1')), false);
  const presenterFile = git.showFile('origin/load/GCA_000001.1', 'Model/lib/xml/datasetPresenters/FungiDB.xml');
  assert.match(presenterFile, /name="tfakST1_primary_genome_RSRC"/);
  assert.equal(git.fileExistsOnRef('origin/load/GCA_000001.1', 'Proposals/GCA_000001.1/manifest.json'), false);
  assert.deepEqual(ticket.calls.map(c => c[0]), ['comment', 'setStatus']);
  assert.equal(ticket.calls[1][2], 'loading');
  assert.match(ticket.calls[0][2], /pull\/11/);
});

test('loadProposal resumes after a run that failed once the commit was pushed', async () => {
  const { repo } = setupRepo();
  setManifestFields(repo, 'GCA_000001.1', { ticket: { system: 'redmine', id: '42', url: 'https://r/issues/42' } });
  commitAll(repo, 'ticket');

  // First run: the PR is opened but gh loses the response, so the run fails
  // with the commit made and pushed.
  const gh = ghStub({ url: 'https://github.com/x/y/pull/9', failCreates: 1 });
  const git = createGit(repo, { exec: gh.exec });
  const ticket = stubTicket();
  await assert.rejects(loadProposal({ git, ticket, repoPath: repo, accession: 'GCA_000001.1' }));
  assert.equal(git.currentBranch(), 'load/GCA_000001.1');
  assert.equal(ticket.calls.length, 0);

  const result = await loadProposal({ git, ticket, repoPath: repo, accession: 'GCA_000001.1' });
  assert.equal(result.resumed, true);
  assert.equal(result.prUrl, 'https://github.com/x/y/pull/9');
  assert.equal(gh.calls.filter(a => a[0] === 'pr' && a[1] === 'create').length, 1);
  assert.equal(ticket.calls.length, 0, 'the existing pull request means the ticket was already told');
});

test('loadProposal --dry-run changes nothing', async () => {
  const { repo } = setupRepo();
  const git = createGit(repo, { exec: ghStub().exec });
  const ticket = stubTicket();
  const result = await loadProposal({ git, ticket, repoPath: repo, accession: 'GCA_000001.1', dryRun: true });
  assert.equal(result.presenterName, 'tfakST1_primary_genome_RSRC');
  assert.match(result.xml, /<datasetPresenter /);
  assert.equal(git.currentBranch(), 'rebuild02');
  assert.equal(existsSync(join(repo, 'Proposals/GCA_000001.1')), true);
  assert.equal(ticket.calls.length, 0);
});

test('loadProposal without a ticket in the manifest skips ticket calls and says so', async () => {
  const { repo } = setupRepo();
  const git = createGit(repo, { exec: ghStub().exec });
  const ticket = stubTicket();
  const result = await loadProposal({ git, ticket, repoPath: repo, accession: 'GCA_000001.1' });
  assert.equal(ticket.calls.length, 0);
  assert.match(result.warnings.join(' '), /no ticket/);
});
