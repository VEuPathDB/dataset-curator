import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validationWorkspaceFor, validationWorkspaceNames } from '../shared/scripts/dataset-types/validators.js';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { openVerifyWorkspace, openLoadWorkspace, verifyWorkspaceDisposal, resetLoadWorkspaces } from '../shared/scripts/lib/validation-workspace.js';
import { initToolRemote, advanceRemote, validationRoot, commitIn, headOf, branchOf } from './helpers.js';

test('each dataset type names its validation workspace directory', () => {
  assert.equal(validationWorkspaceFor('bulk-rnaseq'), 'rnaseq-validation');
  assert.equal(validationWorkspaceFor('genome-assembly'), 'annotated-genome-validation');
  assert.equal(validationWorkspaceFor('nope'), null);
  assert.deepEqual(validationWorkspaceNames().sort(), ['annotated-genome-validation', 'rnaseq-validation']);
});

const COUNT_BUILDS = 'echo x >> "$PROPOSAL_DIR/builds" && mkdir -p "$BUILD_DIR/bin"';
const builds = (dir) => readFileSync(join(dir, 'builds'), 'utf-8').trim().split('\n').length;
const removedAfter = (t, dir) => { t.after(() => rmSync(dir, { recursive: true, force: true })); return dir; };
const remotesDir = (t) => removedAfter(t, mkdtempSync(join(tmpdir(), 'tool-remotes-')));
const rootFor = (t, ...args) => { const r = validationRoot(...args); removedAfter(t, r.root); return r; };
const remoteSha = (base, ref) => execFileSync('git', ['-C', base, 'rev-parse', `refs/remotes/origin/${ref}`], { encoding: 'utf-8' }).trim();
const readEnv = (typeDir) => JSON.parse(readFileSync(join(typeDir, 'env.json'), 'utf-8'));
const writeEnv = (typeDir, env) => writeFileSync(join(typeDir, 'env.json'), JSON.stringify(env));

/** A root whose ApiCommonData follows master; the remote lives beside it. */
function verifySetup(t, { build = [COUNT_BUILDS] } = {}) {
  const remotes = remotesDir(t);
  const acd = initToolRemote(remotes, 'ApiCommonData', { branches: ['rebuild70'] });
  const sw = initToolRemote(remotes, 'study.wrangler', { tags: ['v1.4.2'] });
  const { root, typeDir } = rootFor(t, {
    ApiCommonData: { url: acd.url, ref: 'master', followsRebuild: true },
    'study.wrangler': { url: sw.url, ref: 'v1.4.2' }
  }, { build, executables: { perl: '/usr/bin/perl' } });
  return { root, typeDir, remotes, acd, sw };
}
const open = (root, extra = {}) => openVerifyWorkspace({ root, datasetType: 'bulk-rnaseq', accession: 'PRJNA1', ...extra });

test('the root and type directory are named, never guessed', (t) => {
  assert.match(open(undefined).error, /No validation workspace given; ask the data loader.* and pass --workspace <root>/);
  const empty = removedAfter(t, mkdtempSync(join(tmpdir(), 'validation-root-')));
  assert.match(open(empty).error, /rnaseq-validation does not exist; create it with an env\.json/);
  assert.match(openVerifyWorkspace({ root: empty, datasetType: 'nope', accession: 'X' }).error, /datasetType "nope" has no validation workspace/);
});

test('an accession must be a plain directory name', (t) => {
  const { root, typeDir } = verifySetup(t);
  for (const accession of ['', '.', '..', 'a/b', 'a\\b', undefined]) {
    assert.match(open(root, { accession }).error, /must be a plain directory name/);
  }
  assert.equal(existsSync(join(typeDir, 'proposals')), false);
});

test('first verify clones, adds a verify/<accession> worktree per repo at its ref, and builds', (t) => {
  const { root, typeDir, acd, sw } = verifySetup(t);
  const ws = open(root);
  assert.equal(ws.error, undefined);
  const dir = join(typeDir, 'proposals/PRJNA1');
  assert.equal(ws.dir, dir);
  assert.equal(ws.buildDir, join(dir, 'build'));
  assert.ok(existsSync(join(typeDir, 'repos/ApiCommonData/.git')));
  assert.equal(existsSync(join(typeDir, 'repos/ApiCommonData/README')), false, 'base clone is never checked out');
  assert.equal(branchOf(join(dir, 'ApiCommonData')), 'verify/PRJNA1');
  assert.deepEqual(ws.repos.ApiCommonData, { path: join(dir, 'ApiCommonData'), ref: 'master', sha: headOf(acd.work) });
  assert.equal(ws.repos['study.wrangler'].sha, headOf(sw.work));
  assert.equal(ws.repos['study.wrangler'].ref, 'v1.4.2');
  assert.equal(builds(dir), 1);
  assert.ok(existsSync(join(dir, 'build/bin')));
  assert.equal(ws.executables.perl, '/usr/bin/perl');
  assert.equal(ws.env.PERL5LIB, join(dir, 'build/lib/perl'));
  assert.ok(ws.env.PATH.startsWith(join(dir, 'build/bin')));
});

test('a second verify reuses the worktree as is: no fetch, no reset, no rebuild', (t) => {
  const { root, typeDir, acd } = verifySetup(t);
  const first = open(root).repos.ApiCommonData.sha;
  writeFileSync(join(typeDir, 'proposals/PRJNA1/ApiCommonData/fix.pm'), '1;\n');
  advanceRemote(acd.work);
  const again = open(root);
  assert.equal(again.repos.ApiCommonData.sha, first);
  assert.equal(remoteSha(join(typeDir, 'repos/ApiCommonData'), 'master'), first, 'base clone was not fetched');
  assert.ok(existsSync(join(typeDir, 'proposals/PRJNA1/ApiCommonData/fix.pm')));
  assert.equal(builds(again.dir), 1);
});

test('rebuild reruns the build on the same code', (t) => {
  const { root } = verifySetup(t);
  const first = open(root);
  const again = open(root, { rebuild: true });
  assert.equal(again.repos.ApiCommonData.sha, first.repos.ApiCommonData.sha);
  assert.equal(builds(again.dir), 2);
});

test('refresh moves clean worktrees to the current ref and rebuilds', (t) => {
  const { root, acd } = verifySetup(t);
  open(root);
  const sha = advanceRemote(acd.work);
  const again = open(root, { refresh: true });
  assert.equal(again.repos.ApiCommonData.sha, sha);
  assert.equal(branchOf(again.repos.ApiCommonData.path), 'verify/PRJNA1');
  assert.equal(builds(again.dir), 2);
});

test('refresh refuses uncommitted changes and unpushed commits, touching nothing', (t) => {
  const { root, acd } = verifySetup(t);
  const ws = open(root);
  const wt = ws.repos.ApiCommonData.path;
  advanceRemote(acd.work);
  writeFileSync(join(wt, 'fix.pm'), '1;\n');
  assert.throws(() => open(root, { refresh: true }), /cannot be refreshed[\s\S]*ApiCommonData \(.*ApiCommonData\): uncommitted changes/);
  assert.equal(headOf(wt), ws.repos.ApiCommonData.sha);
  assert.equal(readFileSync(join(wt, 'fix.pm'), 'utf-8'), '1;\n');
  commitIn(wt, 'fix');
  const fixed = headOf(wt);
  assert.throws(() => open(root, { refresh: true }), /ApiCommonData \(.*\): 1 commit\(s\) on no remote branch or tag/);
  assert.equal(headOf(wt), fixed);
});

test('refresh allows a fix pushed to verify/<accession> and lands on the new ref', (t) => {
  const { root, acd } = verifySetup(t);
  const wt = open(root).repos.ApiCommonData.path;
  writeFileSync(join(wt, 'fix.pm'), '1;\n');
  commitIn(wt, 'fix');
  execFileSync('git', ['-C', wt, 'push', '-q', 'origin', 'verify/PRJNA1'], { stdio: 'pipe' });
  const sha = advanceRemote(acd.work);
  const again = open(root, { refresh: true });
  assert.equal(again.error, undefined);
  assert.equal(again.repos.ApiCommonData.sha, sha);
  assert.equal(branchOf(wt), 'verify/PRJNA1');
});

test('a refresh that fails partway leaves no finished build behind', (t) => {
  const { root, typeDir, remotes, acd } = verifySetup(t);
  const ws = open(root);
  const env = readEnv(typeDir);
  const sha = advanceRemote(acd.work);
  writeEnv(typeDir, { ...env, repos: { ...env.repos, Broken: { url: join(remotes, 'missing.git'), ref: 'master' } } });
  assert.match(open(root, { refresh: true }).error, /^Broken \(.*repos\/Broken\): [\s\S]*missing\.git/);
  writeEnv(typeDir, env);
  const again = open(root);
  assert.equal(again.repos.ApiCommonData.sha, sha);
  assert.equal(builds(ws.dir), 2);
});

test('a failed build is an error, and the next verify builds again', (t) => {
  const { root, typeDir } = verifySetup(t, { build: [COUNT_BUILDS, 'echo broken >&2; exit 3'] });
  assert.match(open(root).error, /build step 2 failed \(echo broken >&2; exit 3\): broken/);
  writeEnv(typeDir, { ...readEnv(typeDir), build: [COUNT_BUILDS] });
  const ws = open(root);
  assert.equal(ws.error, undefined);
  assert.equal(builds(ws.dir), 2);
});

test('a ref is an origin branch, a tag or a commit sha; anything else is an error', (t) => {
  const remotes = remotesDir(t);
  const acd = initToolRemote(remotes, 'ApiCommonData');
  const sha = headOf(acd.work);
  assert.equal(open(rootFor(t, { ApiCommonData: { url: acd.url, ref: sha.slice(0, 10) } }).root).repos.ApiCommonData.sha, sha);
  assert.match(open(rootFor(t, { ApiCommonData: { url: acd.url, ref: 'nope' } }).root).error, /^ApiCommonData \(.*\): .*has no branch, tag or commit "nope" on origin/);
  assert.match(open(rootFor(t, { ApiCommonData: { url: join(remotes, 'missing.git'), ref: 'master' } }).root).error, /missing\.git/);
});

test('an invalid env.json is an error', (t) => {
  const { root, typeDir } = verifySetup(t);
  writeFileSync(join(typeDir, 'env.json'), '{"schemaVersion": 1}');
  assert.match(open(root).error, /schemaVersion 1 is the old flat validation-env\.json/);
});

const openLoad = (root, extra = {}) => openLoadWorkspace({ root, datasetType: 'bulk-rnaseq', rebuildBranch: 'rebuild70', ...extra });

test('load makes detached worktrees: followsRebuild repos at rebuild<RR>, others at their ref', (t) => {
  const { root, typeDir, acd, sw } = verifySetup(t);
  const rebuildSha = advanceRemote(acd.work, 'rebuild70');
  const ws = openLoad(root);
  assert.equal(ws.error, undefined);
  assert.equal(ws.dir, join(typeDir, 'loads/rebuild70'));
  assert.deepEqual(ws.repos.ApiCommonData, { path: join(ws.dir, 'ApiCommonData'), ref: 'rebuild70', sha: rebuildSha });
  assert.equal(branchOf(ws.repos.ApiCommonData.path), 'HEAD');
  assert.equal(ws.repos['study.wrangler'].sha, headOf(sw.work));
  assert.equal(builds(ws.dir), 1);
});

test('later loads in the rebuild share the workspace without fetching; refresh recreates it', (t) => {
  const { root, typeDir, acd } = verifySetup(t);
  const first = openLoad(root).repos.ApiCommonData.sha;
  const newer = advanceRemote(acd.work, 'rebuild70');
  const again = openLoad(root);
  assert.equal(again.repos.ApiCommonData.sha, first);
  assert.equal(remoteSha(join(typeDir, 'repos/ApiCommonData'), 'rebuild70'), first, 'base clone was not fetched');
  assert.equal(builds(again.dir), 1);
  const fresh = openLoad(root, { refresh: true });
  assert.equal(fresh.repos.ApiCommonData.sha, newer);
  assert.equal(branchOf(fresh.repos.ApiCommonData.path), 'HEAD');
});

test('load refresh refuses an edited load worktree, touching nothing', (t) => {
  const { root } = verifySetup(t);
  const ws = openLoad(root);
  writeFileSync(join(ws.repos.ApiCommonData.path, 'oops'), 'x');
  assert.throws(() => openLoad(root, { refresh: true }), /loads\/rebuild70 cannot be refreshed; nobody should edit a load workspace; inspect it, then revert the change or delete .*loads\/rebuild70 by hand[\s\S]*ApiCommonData \(.*\): uncommitted changes/);
  assert.ok(existsSync(join(ws.repos.ApiCommonData.path, 'oops')));
});

test('load refresh refuses a commit made in a detached load worktree', (t) => {
  const { root } = verifySetup(t);
  const wt = openLoad(root).repos.ApiCommonData.path;
  writeFileSync(join(wt, 'oops'), 'x');
  commitIn(wt, 'oops');
  const sha = headOf(wt);
  assert.throws(() => openLoad(root, { refresh: true }), /cannot be refreshed[\s\S]*ApiCommonData \(.*\): 1 commit\(s\) on no remote branch or tag/);
  assert.equal(headOf(wt), sha);
});

test('a followsRebuild repo without the rebuild branch is an error naming it, with no fallback', (t) => {
  const { root, typeDir } = verifySetup(t);
  assert.match(openLoad(root, { rebuildBranch: 'rebuild71' }).error, /repos\/ApiCommonData has no branch "rebuild71" on origin/);
  for (const rebuildBranch of ['main', '../rebuild70', undefined]) {
    assert.match(openLoad(root, { rebuildBranch }).error, /rebuildBranch must name a rebuild branch/);
  }
  assert.equal(existsSync(join(typeDir, 'loads/rebuild70')), false);
});

test('disposal refuses uncommitted or unpushed work, then removes worktrees, branches and the directory', (t) => {
  const { root, typeDir } = verifySetup(t);
  const ws = open(root);
  const acdPath = ws.repos.ApiCommonData.path;
  const disposal = verifyWorkspaceDisposal({ root, accession: 'PRJNA1' });
  writeFileSync(join(acdPath, 'fix.pm'), '1;\n');
  assert.throws(() => disposal.assertDisposable('bulk-rnaseq'), /cannot be removed; push them, or pass --discard-changes[\s\S]*ApiCommonData \(.*\): uncommitted changes/);
  commitIn(acdPath, 'fix');
  assert.throws(() => disposal.assertDisposable('bulk-rnaseq'), /ApiCommonData \(.*\): 1 commit\(s\) on no remote branch or tag/);
  execFileSync('git', ['-C', acdPath, 'push', '-q', 'origin', 'verify/PRJNA1'], { stdio: 'pipe' });
  disposal.assertDisposable('bulk-rnaseq');
  assert.equal(disposal.dispose('bulk-rnaseq'), ws.dir);
  assert.equal(existsSync(ws.dir), false);
  for (const name of ['ApiCommonData', 'study.wrangler']) {
    const base = join(typeDir, 'repos', name);
    assert.equal(execFileSync('git', ['-C', base, 'branch', '--list', 'verify/PRJNA1'], { encoding: 'utf-8' }).trim(), '');
    assert.equal(execFileSync('git', ['-C', base, 'worktree', 'list'], { encoding: 'utf-8' }).trim().split('\n').length, 1);
  }
});

test('discardChanges disposes of a dirty workspace; nothing to dispose of is not an error', (t) => {
  const { root } = verifySetup(t);
  const ws = open(root);
  writeFileSync(join(ws.repos.ApiCommonData.path, 'fix.pm'), '1;\n');
  const disposal = verifyWorkspaceDisposal({ root, accession: 'PRJNA1', discardChanges: true });
  disposal.assertDisposable('bulk-rnaseq');
  assert.equal(disposal.dispose('bulk-rnaseq'), ws.dir);
  assert.equal(existsSync(ws.dir), false);
  assert.equal(verifyWorkspaceDisposal({ root, accession: 'PRJNA9' }).dispose('bulk-rnaseq'), null);
  assert.equal(verifyWorkspaceDisposal({ root, accession: 'GCA_1' }).dispose('genome-assembly'), null, 'no annotated-genome-validation dir');
});

test('discardChanges disposes of a workspace holding an unpushed commit', (t) => {
  const { root, typeDir } = verifySetup(t);
  const ws = open(root);
  writeFileSync(join(ws.repos.ApiCommonData.path, 'fix.pm'), '1;\n');
  commitIn(ws.repos.ApiCommonData.path, 'fix');
  assert.equal(verifyWorkspaceDisposal({ root, accession: 'PRJNA1', discardChanges: true }).dispose('bulk-rnaseq'), ws.dir);
  assert.equal(existsSync(ws.dir), false);
  assert.equal(execFileSync('git', ['-C', join(typeDir, 'repos/ApiCommonData'), 'branch', '--list', 'verify/PRJNA1'], { encoding: 'utf-8' }).trim(), '');
});

test('disposal guards the verify branch even when the worktree moved to another branch', (t) => {
  const { root, typeDir } = verifySetup(t);
  const ws = open(root);
  const wt = ws.repos.ApiCommonData.path;
  writeFileSync(join(wt, 'fix.pm'), '1;\n');
  commitIn(wt, 'fix');
  execFileSync('git', ['-C', wt, 'switch', '-q', '-c', 'fix-x', 'HEAD~1'], { stdio: 'pipe' });
  execFileSync('git', ['-C', wt, 'push', '-q', 'origin', 'fix-x'], { stdio: 'pipe' });
  const disposal = verifyWorkspaceDisposal({ root, accession: 'PRJNA1' });
  const refusal = /ApiCommonData \(.*repos\/ApiCommonData\): verify\/PRJNA1 has 1 commit\(s\) on no remote branch or tag/;
  assert.throws(() => disposal.assertDisposable('bulk-rnaseq'), refusal);
  assert.throws(() => disposal.dispose('bulk-rnaseq'), refusal);
  assert.ok(existsSync(wt));
  assert.equal(verifyWorkspaceDisposal({ root, accession: 'PRJNA1', discardChanges: true }).dispose('bulk-rnaseq'), ws.dir);
  assert.equal(existsSync(ws.dir), false);
  assert.equal(execFileSync('git', ['-C', join(typeDir, 'repos/ApiCommonData'), 'branch', '--list', 'verify/PRJNA1'], { encoding: 'utf-8' }).trim(), '');
});

test('disposal refuses an accession that is not a plain directory name', (t) => {
  const { root, typeDir } = verifySetup(t);
  for (const accession of ['', '.', '..', 'a/b']) {
    assert.throws(() => verifyWorkspaceDisposal({ root, accession, discardChanges: true }).dispose('bulk-rnaseq'), /must be a plain directory name/);
  }
  assert.ok(existsSync(join(typeDir, 'env.json')));
});

test('build start removes every load workspace, and refuses an edited one', (t) => {
  const { root } = verifySetup(t);
  const a = openLoad(root);
  assert.deepEqual(resetLoadWorkspaces({ root }), [a.dir]);
  assert.equal(existsSync(a.dir), false);
  const b = openLoad(root);
  writeFileSync(join(b.repos.ApiCommonData.path, 'oops'), 'x');
  assert.throws(() => resetLoadWorkspaces({ root }), /loads\/rebuild70 cannot be removed; nobody should edit a load workspace/);
  assert.ok(existsSync(join(b.repos.ApiCommonData.path, 'oops')));
  assert.throws(() => resetLoadWorkspaces({}), /No validation workspace given; .* and pass --workspace <root>/);
});

test('build start ignores stray entries in loads/', (t) => {
  const { root, typeDir } = verifySetup(t);
  const a = openLoad(root);
  writeFileSync(join(typeDir, 'loads/notes.txt'), 'x');
  writeFileSync(join(typeDir, 'loads/rebuild99'), 'a file, not a workspace');
  assert.deepEqual(resetLoadWorkspaces({ root }), [a.dir]);
  assert.ok(existsSync(join(typeDir, 'loads/notes.txt')));
  assert.ok(existsSync(join(typeDir, 'loads/rebuild99')));
});

test('build start removes nothing when any load workspace was edited', (t) => {
  const { root, acd } = verifySetup(t);
  execFileSync('git', ['-C', acd.work, 'push', '-q', 'origin', 'master:refs/heads/rebuild71'], { stdio: 'pipe' });
  const a = openLoad(root);
  const b = openLoad(root, { rebuildBranch: 'rebuild71' });
  assert.equal(b.error, undefined);
  writeFileSync(join(b.repos.ApiCommonData.path, 'oops'), 'x');
  assert.throws(() => resetLoadWorkspaces({ root }), /loads\/rebuild71 cannot be removed/);
  assert.ok(existsSync(a.dir));
  assert.ok(existsSync(b.dir));
});
