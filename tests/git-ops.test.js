import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createGit } from '../shared/scripts/lib/git-ops.js';

/** A bare "origin" plus a working clone with one commit on master. */
function setupRepo(t) {
  const root = mkdtempSync(join(tmpdir(), 'git-ops-'));
  if (t) t.after(() => rmSync(root, { recursive: true, force: true }));
  const bare = join(root, 'origin.git');
  const work = join(root, 'work');
  execFileSync('git', ['init', '--bare', '-q', '--initial-branch=master', bare]);
  execFileSync('git', ['clone', '-q', bare, work]);
  execFileSync('git', ['-C', work, 'checkout', '-q', '-B', 'master']);
  execFileSync('git', ['-C', work, 'config', 'user.email', 'test@example.org']);
  execFileSync('git', ['-C', work, 'config', 'user.name', 'Test']);
  writeFileSync(join(work, 'README'), 'hello\n');
  execFileSync('git', ['-C', work, 'add', 'README']);
  execFileSync('git', ['-C', work, 'commit', '-q', '-m', 'init']);
  execFileSync('git', ['-C', work, 'push', '-q', '-u', 'origin', 'master']);
  return { work, bare };
}

test('currentBranch, isClean, isUpToDate on a fresh clone', (t) => {
  const { work } = setupRepo(t);
  const git = createGit(work);
  assert.equal(git.currentBranch(), 'master');
  assert.equal(git.isClean(), true);
  git.fetch();
  assert.equal(git.isUpToDate('master'), true);
  writeFileSync(join(work, 'dirty'), 'x');
  assert.equal(git.isClean(), false);
});

test('createBranch, commit, push, branchExists', (t) => {
  const { work } = setupRepo(t);
  const git = createGit(work);
  assert.equal(git.branchExists('proposal/X'), false);
  git.createBranch('proposal/X', 'master');
  assert.equal(git.currentBranch(), 'proposal/X');
  mkdirSync(join(work, 'Proposals', 'X'), { recursive: true });
  writeFileSync(join(work, 'Proposals', 'X', 'manifest.json'), '{}');
  git.add(['Proposals/X']);
  git.commit('Add proposal X');
  git.push('proposal/X');
  assert.equal(git.branchExists('proposal/X'), true);
  assert.equal(git.fileExistsOnRef('origin/proposal/X', 'Proposals/X/manifest.json'), true);
  assert.equal(git.fileExistsOnRef('origin/master', 'Proposals/X/manifest.json'), false);
});

test('amend and force push with lease', (t) => {
  const { work } = setupRepo(t);
  const git = createGit(work);
  git.createBranch('proposal/Y', 'master');
  writeFileSync(join(work, 'a'), '1');
  git.add(['a']);
  git.commit('one');
  git.push('proposal/Y');
  writeFileSync(join(work, 'a'), '2');
  git.add(['a']);
  git.amendNoEdit();
  git.push('proposal/Y', { force: true });
  assert.equal(git.showFile('origin/proposal/Y', 'a'), '2');
});

test('rm removes a directory recursively and commitsForPath finds its commits', (t) => {
  const { work } = setupRepo(t);
  const git = createGit(work);
  mkdirSync(join(work, 'Proposals', 'Z', 'inputs'), { recursive: true });
  writeFileSync(join(work, 'Proposals', 'Z', 'inputs', 'f.json'), '{}');
  git.add(['Proposals/Z']);
  git.commit('Add Z');
  const commits = git.commitsForPath('master', 'Proposals/Z');
  assert.equal(commits.length, 1);
  git.rm('Proposals/Z');
  git.commit('Remove Z');
  assert.equal(git.fileExistsOnRef('HEAD', 'Proposals/Z/inputs/f.json'), false);
});

test('cherryPick applies commits and reports conflicting files on failure', (t) => {
  const { work } = setupRepo(t);
  const git = createGit(work);
  // commit A on master adds Proposals/S; a branch cut before A lacks it
  git.createBranch('rebuild02', 'master');
  git.checkout('master');
  mkdirSync(join(work, 'Proposals', 'S'), { recursive: true });
  writeFileSync(join(work, 'Proposals', 'S', 'manifest.json'), '{}');
  git.add(['Proposals/S']);
  git.commit('Add S');
  const sha = git.commitsForPath('master', 'Proposals/S')[0];
  git.checkout('rebuild02');
  git.createBranch('load/S', 'rebuild02');
  git.cherryPick([sha]);
  assert.equal(git.fileExistsOnRef('HEAD', 'Proposals/S/manifest.json'), true);

  // now force a conflict: same file, different content on both sides
  git.checkout('master');
  writeFileSync(join(work, 'README'), 'master version\n');
  git.add(['README']);
  git.commit('master README');
  const conflicting = git.commitsForPath('master', 'README')[0];
  git.checkout('load/S');
  writeFileSync(join(work, 'README'), 'load version\n');
  git.add(['README']);
  git.commit('load README');
  assert.throws(() => git.cherryPick([conflicting]), (err) => {
    assert.match(err.message, /Cherry-pick conflicts in:\n  README/);
    assert.match(err.message, new RegExp(`'${work.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}' cherry-pick --abort`));
    assert.match(err.message, /CONFLICT|conflict/i);
    return true;
  });
  git.abortCherryPick();
  assert.equal(git.isClean(), true);
});

test('cherryPick rethrows the original error when there is no conflict (e.g. bad revision)', (t) => {
  const { work } = setupRepo(t);
  const git = createGit(work);
  assert.throws(() => git.cherryPick(['deadbeef']), /bad revision/);
});

test('commitsForPath returns commits oldest-first', (t) => {
  const { work } = setupRepo(t);
  const git = createGit(work);
  mkdirSync(join(work, 'Proposals', 'W'), { recursive: true });
  writeFileSync(join(work, 'Proposals', 'W', 'a'), '1');
  git.add(['Proposals/W']);
  git.commit('older');
  const older = git.commitsForPath('master', 'Proposals/W')[0];
  writeFileSync(join(work, 'Proposals', 'W', 'a'), '2');
  git.add(['Proposals/W']);
  git.commit('newer');
  const commits = git.commitsForPath('master', 'Proposals/W');
  assert.equal(commits.length, 2);
  assert.equal(commits[0], older);
  const newer = git.commitsForPath('master', 'Proposals/W')[1];
  assert.notEqual(older, newer);
});

test('commitsForPath accepts a range, so a rebuild branch bounds the search', (t) => {
  const { work } = setupRepo(t);
  const git = createGit(work);
  mkdirSync(join(work, 'Proposals', 'R'), { recursive: true });
  writeFileSync(join(work, 'Proposals', 'R', 'a'), '1');
  git.add(['Proposals/R']);
  git.commit('before the cut');
  const before = git.commitsForPath('master', 'Proposals/R')[0];
  git.createBranch('rebuild02', 'master');
  git.checkout('master');
  writeFileSync(join(work, 'Proposals', 'R', 'a'), '2');
  git.add(['Proposals/R']);
  git.commit('after the cut');

  assert.equal(git.commitsForPath('master', 'Proposals/R').length, 2);
  const bounded = git.commitsForPath('rebuild02..master', 'Proposals/R');
  assert.equal(bounded.length, 1);
  assert.notEqual(bounded[0], before);
});

test('exportTree writes a ref\'s subtree into a destination directory', (t) => {
  const { work } = setupRepo(t);
  const git = createGit(work);
  mkdirSync(join(work, 'Proposals', 'E', 'inputs'), { recursive: true });
  writeFileSync(join(work, 'Proposals', 'E', 'manifest.json'), '{"a":1}\n');
  writeFileSync(join(work, 'Proposals', 'E', 'inputs', 'report.json'), 'report\n');
  git.add(['Proposals/E']);
  git.commit('Add E');
  const head = git.commitsForPath('master', 'Proposals/E')[0];

  // the working tree moves on; the export still reflects the ref
  writeFileSync(join(work, 'Proposals', 'E', 'manifest.json'), '{"a":2}\n');
  const dest = mkdtempSync(join(tmpdir(), 'export-'));
  t.after(() => rmSync(dest, { recursive: true, force: true }));
  git.exportTree(head, 'Proposals/E', dest);

  assert.equal(readFileSync(join(dest, 'Proposals/E/manifest.json'), 'utf-8'), '{"a":1}\n');
  assert.equal(readFileSync(join(dest, 'Proposals/E/inputs/report.json'), 'utf-8'), 'report\n');
});

test('exportTree fails loudly when the path is not on the ref', (t) => {
  const { work } = setupRepo(t);
  const git = createGit(work);
  const dest = mkdtempSync(join(tmpdir(), 'export-'));
  t.after(() => rmSync(dest, { recursive: true, force: true }));
  assert.throws(() => git.exportTree('master', 'Proposals/Missing', dest));
});

test('push refuses protected branches', (t) => {
  const { work } = setupRepo(t);
  const git = createGit(work);
  assert.throws(() => git.push('master'), /Refusing to push directly to master/);
  assert.throws(() => git.push('rebuild02'), /Refusing to push directly to rebuild02/);
});

test('openPullRequest shells out to gh with GITHUB_TOKEN removed and returns the URL', () => {
  const calls = [];
  const exec = (cmd, args, opts) => {
    calls.push({ cmd, args, env: opts.env });
    return 'https://github.com/VEuPathDB/VEuPathDatasets/pull/7\n';
  };
  const git = createGit('/nowhere', { exec });
  const url = git.openPullRequest({ base: 'master', head: 'proposal/X', title: 't', body: 'b' });
  assert.equal(url, 'https://github.com/VEuPathDB/VEuPathDatasets/pull/7');
  assert.equal(calls[0].cmd, 'gh');
  assert.deepEqual(calls[0].args.slice(0, 2), ['pr', 'create']);
  assert.equal('GITHUB_TOKEN' in calls[0].env, false);
});

test('injected env applies to git calls, not just gh', (t) => {
  const { work } = setupRepo(t);
  const injectedEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Env Tester',
    GIT_AUTHOR_EMAIL: 'env@example.org',
    GIT_COMMITTER_NAME: 'Env Tester',
    GIT_COMMITTER_EMAIL: 'env@example.org'
  };
  const git = createGit(work, { env: injectedEnv });
  writeFileSync(join(work, 'envfile'), 'x');
  git.add(['envfile']);
  git.commit('via env');
  const author = execFileSync('git', ['-C', work, 'log', '-1', '--format=%an'], { encoding: 'utf-8' }).trim();
  assert.equal(author, 'Env Tester');
});

test('openPullRequest strips GITHUB_TOKEN from an injected env rather than process.env', () => {
  const calls = [];
  const exec = (cmd, args, opts) => {
    calls.push({ cmd, args, env: opts.env });
    return 'https://github.com/VEuPathDB/VEuPathDatasets/pull/8\n';
  };
  const injectedEnv = { GITHUB_TOKEN: 'secret', OTHER: 'kept' };
  const git = createGit('/nowhere', { exec, env: injectedEnv });
  git.openPullRequest({ base: 'master', head: 'proposal/X', title: 't', body: 'b' });
  assert.equal('GITHUB_TOKEN' in calls[0].env, false);
  assert.equal(calls[0].env.OTHER, 'kept');
});

test('userEmail returns the configured address and throws with a fix when unset', (t) => {
  const { work } = setupRepo(t);
  const git = createGit(work);
  assert.equal(git.userEmail(), 'test@example.org');
  execFileSync('git', ['-C', work, 'config', '--unset', 'user.email']);
  // ignore the developer's own global config so the unset is what git sees
  const isolated = createGit(work, {
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }
  });
  assert.throws(() => isolated.userEmail(), (err) => {
    assert.match(err.message, /git user\.email is not set in /);
    assert.match(err.message, /config user\.email you@example\.org/);
    return true;
  });
});

test('remoteBranchExists sees branches on origin only after a fetch', (t) => {
  const { work } = setupRepo(t);
  const git = createGit(work);
  assert.equal(git.remoteBranchExists('proposal/R'), false);
  git.createBranch('proposal/R', 'master');
  writeFileSync(join(work, 'r'), '1');
  git.add(['r']);
  git.commit('r');
  git.push('proposal/R');
  git.fetch();
  assert.equal(git.remoteBranchExists('proposal/R'), true);
  assert.equal(git.remoteBranchExists('proposal/nope'), false);
});

test('aheadOf counts commits beyond the base ref', (t) => {
  const { work } = setupRepo(t);
  const git = createGit(work);
  git.fetch();
  git.createBranch('proposal/A', 'master');
  assert.equal(git.aheadOf('origin/master'), 0);
  writeFileSync(join(work, 'a'), '1');
  git.add(['a']);
  git.commit('one');
  assert.equal(git.aheadOf('origin/master'), 1);
});

test('commit surfaces git reason when there is nothing to commit', (t) => {
  const { work } = setupRepo(t);
  const git = createGit(work);
  assert.throws(() => git.commit('empty'), /nothing to commit/);
});

test('findPullRequest asks gh for open pull requests on the branch only', () => {
  const calls = [];
  const okGit = createGit('/nowhere', {
    exec: (cmd, args, opts) => {
      calls.push({ cmd, args, opts });
      return 'https://github.com/VEuPathDB/VEuPathDatasets/pull/9\n';
    },
    env: { GITHUB_TOKEN: 'secret', OTHER: 'kept' }
  });
  assert.equal(okGit.findPullRequest('proposal/X'), 'https://github.com/VEuPathDB/VEuPathDatasets/pull/9');
  assert.equal(calls[0].cmd, 'gh');
  assert.deepEqual(calls[0].args,
    ['pr', 'list', '--head', 'proposal/X', '--state', 'open', '--json', 'url', '--jq', '.[0].url']);
  assert.equal(calls[0].opts.cwd, '/nowhere');
  assert.equal('GITHUB_TOKEN' in calls[0].opts.env, false);
});

test('findPullRequest returns null when no pull request is open on the branch', () => {
  // gh pr list prints nothing when every pull request for the branch is closed or merged
  assert.equal(createGit('/nowhere', { exec: () => '\n' }).findPullRequest('proposal/X'), null);
  assert.equal(createGit('/nowhere', { exec: () => '' }).findPullRequest('proposal/X'), null);
});

test('findPullRequest returns null when gh fails', () => {
  const missing = createGit('/nowhere', { exec: () => { throw new Error('gh: could not reach github.com'); } });
  assert.equal(missing.findPullRequest('proposal/X'), null);
});

test('headSubject returns the subject line of the last commit', (t) => {
  const { work } = setupRepo(t);
  const git = createGit(work);
  writeFileSync(join(work, 'h'), '1');
  git.add(['h']);
  git.commit('Load GCA_000001.1: add tfakST1_primary_genome_RSRC to FungiDB, remove proposal');
  assert.equal(git.headSubject(), 'Load GCA_000001.1: add tfakST1_primary_genome_RSRC to FungiDB, remove proposal');
});

test('checkGhAuth passes when gh is authenticated and names the fix when not', () => {
  const calls = [];
  const ok = createGit('/nowhere', { exec: (cmd, args) => { calls.push([cmd, ...args]); return ''; } });
  ok.checkGhAuth();
  assert.deepEqual(calls[0], ['gh', 'auth', 'status']);

  const bad = createGit('/nowhere', { exec: () => { throw new Error('not logged in'); } });
  assert.throws(() => bad.checkGhAuth(), /gh is not authenticated; run: gh auth login/);
});
