import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validationWorkspaceFor, validationWorkspaceNames } from '../shared/scripts/dataset-types/validators.js';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { openVerifyWorkspace } from '../shared/scripts/lib/validation-workspace.js';
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
  assert.match(open(undefined).error, /No validation workspace given; ask the data loader/);
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
