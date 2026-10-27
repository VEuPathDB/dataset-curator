import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validationWorkspaceFor, validationWorkspaceNames } from '../shared/scripts/dataset-types/validators.js';
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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

/** A root whose ApiCommonData follows master; the remote lives beside it. */
function verifySetup({ build = [COUNT_BUILDS] } = {}) {
  const remotes = mkdtempSync(join(tmpdir(), 'tool-remotes-'));
  const acd = initToolRemote(remotes, 'ApiCommonData', { branches: ['rebuild70'] });
  const sw = initToolRemote(remotes, 'study.wrangler', { tags: ['v1.4.2'] });
  const { root, typeDir } = validationRoot({
    ApiCommonData: { url: acd.url, ref: 'master', followsRebuild: true },
    'study.wrangler': { url: sw.url, ref: 'v1.4.2' }
  }, { build, executables: { perl: '/usr/bin/perl' } });
  return { root, typeDir, acd, sw };
}
const open = (root, extra = {}) => openVerifyWorkspace({ root, datasetType: 'bulk-rnaseq', accession: 'PRJNA1', ...extra });

test('the root and type directory are named, never guessed', () => {
  assert.match(open(undefined).error, /No validation workspace given; ask the data loader/);
  const empty = mkdtempSync(join(tmpdir(), 'validation-root-'));
  assert.match(open(empty).error, /rnaseq-validation does not exist; create it with an env\.json/);
  assert.match(openVerifyWorkspace({ root: empty, datasetType: 'nope', accession: 'X' }).error, /datasetType "nope" has no validation workspace/);
});

test('first verify clones, adds a verify/<accession> worktree per repo at its ref, and builds', () => {
  const { root, typeDir, acd, sw } = verifySetup();
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

test('a second verify reuses the worktree as is: no fetch, no reset, no rebuild', () => {
  const { root, typeDir, acd } = verifySetup();
  const first = open(root).repos.ApiCommonData.sha;
  writeFileSync(join(typeDir, 'proposals/PRJNA1/ApiCommonData/fix.pm'), '1;\n');
  advanceRemote(acd.work);
  const again = open(root);
  assert.equal(again.repos.ApiCommonData.sha, first);
  assert.ok(existsSync(join(typeDir, 'proposals/PRJNA1/ApiCommonData/fix.pm')));
  assert.equal(builds(again.dir), 1);
});

test('rebuild reruns the build on the same code', () => {
  const { root } = verifySetup();
  const first = open(root);
  const again = open(root, { rebuild: true });
  assert.equal(again.repos.ApiCommonData.sha, first.repos.ApiCommonData.sha);
  assert.equal(builds(again.dir), 2);
});

test('refresh moves clean worktrees to the current ref and rebuilds', () => {
  const { root, acd } = verifySetup();
  open(root);
  const sha = advanceRemote(acd.work);
  const again = open(root, { refresh: true });
  assert.equal(again.repos.ApiCommonData.sha, sha);
  assert.equal(branchOf(again.repos.ApiCommonData.path), 'verify/PRJNA1');
  assert.equal(builds(again.dir), 2);
});

test('refresh refuses uncommitted changes and unpushed commits', () => {
  const { root } = verifySetup();
  const ws = open(root);
  writeFileSync(join(ws.repos.ApiCommonData.path, 'fix.pm'), '1;\n');
  assert.throws(() => open(root, { refresh: true }), /cannot be refreshed[\s\S]*ApiCommonData: uncommitted changes/);
  commitIn(ws.repos.ApiCommonData.path, 'fix');
  assert.throws(() => open(root, { refresh: true }), /ApiCommonData: 1 commit\(s\) not on any remote branch/);
});

test('a failed build is an error, and the next verify builds again', () => {
  const { root, typeDir } = verifySetup({ build: [COUNT_BUILDS, 'echo broken >&2; exit 3'] });
  assert.match(open(root).error, /build step 2 failed \(echo broken >&2; exit 3\): broken/);
  writeFileSync(join(typeDir, 'env.json'), JSON.stringify({ ...JSON.parse(readFileSync(join(typeDir, 'env.json'), 'utf-8')), build: [COUNT_BUILDS] }));
  const ws = open(root);
  assert.equal(ws.error, undefined);
  assert.equal(builds(ws.dir), 2);
});

test('an unknown ref or unreachable url is an error', () => {
  const remotes = mkdtempSync(join(tmpdir(), 'tool-remotes-'));
  const acd = initToolRemote(remotes, 'ApiCommonData');
  assert.match(open(validationRoot({ ApiCommonData: { url: acd.url, ref: 'nope' } }).root).error, /has no branch, tag or commit "nope" on origin/);
  assert.match(open(validationRoot({ ApiCommonData: { url: join(remotes, 'missing.git'), ref: 'master' } }).root).error, /missing\.git/);
});

test('an invalid env.json is an error', () => {
  const { root, typeDir } = verifySetup();
  writeFileSync(join(typeDir, 'env.json'), '{"schemaVersion": 1}');
  assert.match(open(root).error, /schemaVersion 1 is the old flat validation-env\.json/);
});
