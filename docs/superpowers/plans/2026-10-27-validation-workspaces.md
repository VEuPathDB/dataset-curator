# Validation Workspaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat `validation-env.json` workspace with per-type workspaces under one root: base clones in `repos/`, a git worktree plus build env per proposal for verify, and a shared one per rebuild for load.

**Architecture:** A new `shared/scripts/lib/validation-workspace.js` owns the layout and every git/build operation and returns a *handle* (`{ dir, buildDir, repos, executables, env }`) or `{ error }`. `validation-env.js` parses `env.json` v2 and turns a handle into tool resolvers; the tool modules read the handle instead of paths. `validation-ops.js`, `verification-ops.js` and the scripts pass `--workspace <root>` through. Spec: `docs/superpowers/specs/2026-10-27-validation-workspaces-design.md`.

**Tech Stack:** Node 18 ESM, `node:test`, real `git` against throwaway local bare repos, `sh -c` for build commands.

**Conventions:** Edit only under `shared/`; the pre-commit hook syncs into `skills/` (`yarn sync-shared`). Run tests with `yarn test` or `node --test tests/<file>.test.js`. Match the surrounding code: terse JSDoc one-liners, no comment noise. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `shared/scripts/dataset-types/validators.js` (modify) | Per-type validation registry: validators **and** workspace directory name |
| `shared/scripts/lib/validation-env.js` (rewrite) | `env.json` v2 parsing; `createToolResolver(handle)` |
| `shared/scripts/lib/validation-workspace.js` (create) | Layout, base clones, worktrees, builds, guards, removal, `toolEnv` |
| `shared/scripts/lib/tools/apicommondata.js` (modify) | Resolve from handle; parse with `PERL5LIB=build/lib/perl`; no tmpdir symlinks |
| `shared/scripts/lib/tools/study-wrangler.js` (modify) | Resolve from handle; `R_LIBS=build/lib/R` |
| `shared/scripts/lib/validation-ops.js` (modify) | Open verify/load workspaces; report records `repos` |
| `shared/scripts/lib/verification-ops.js` (modify) | `markReady` guards then disposes the proposal workspace |
| `shared/scripts/validate-proposal.js`, `load-proposal.js`, `mark-ready.js`, `start-build.js` (modify) | Flags |
| `package.json` (modify) | `sharedFiles` entry for the new lib |
| `tests/helpers.js` (modify) | `initToolRemote`, `validationRoot`, `commitIn` |
| `tests/validation-workspace.test.js` (create) | Workspace lifecycle against bare repos |
| `tests/validation-env.test.js` (rewrite) | env.json v2 and tool resolution from a handle |
| `tests/validation-ops.test.js` (modify) | Wiring, markReady disposal |
| SKILL.md files for verify-bulk-rnaseq and load-proposals (modify) | Root, layout, flags |

---

### Task 1: Workspace names in the validation registry

**Files:**
- Modify: `shared/scripts/dataset-types/validators.js`
- Test: `tests/validation-workspace.test.js` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/validation-workspace.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validationWorkspaceFor, validationWorkspaceNames } from '../shared/scripts/dataset-types/validators.js';

test('each dataset type names its validation workspace directory', () => {
  assert.equal(validationWorkspaceFor('bulk-rnaseq'), 'rnaseq-validation');
  assert.equal(validationWorkspaceFor('genome-assembly'), 'annotated-genome-validation');
  assert.equal(validationWorkspaceFor('nope'), null);
  assert.deepEqual(validationWorkspaceNames().sort(), ['annotated-genome-validation', 'rnaseq-validation']);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/validation-workspace.test.js`
Expected: FAIL, `validationWorkspaceFor` is not exported.

- [ ] **Step 3: Implement**

Replace the body of `shared/scripts/dataset-types/validators.js` below the imports with:

```js
// A type with validators must have a current, non-failing report before mark-ready.
const VALIDATORS = { 'bulk-rnaseq': [libraryType, consistency, perlParse, stf] };
const WORKSPACES = { 'bulk-rnaseq': 'rnaseq-validation', 'genome-assembly': 'annotated-genome-validation' };

export const validatorsFor = (datasetType) => VALIDATORS[datasetType] ?? [];
export const validationWorkspaceFor = (datasetType) => WORKSPACES[datasetType] ?? null;
export const validationWorkspaceNames = () => [...new Set(Object.values(WORKSPACES))];
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test tests/validation-workspace.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add shared/scripts/dataset-types/validators.js tests/validation-workspace.test.js
git commit -m "Name each dataset type's validation workspace directory"
```

---

### Task 2: env.json v2 reader

`readValidationEnv` (v1) stays until Task 5 so nothing breaks in between.

**Files:**
- Modify: `shared/scripts/lib/validation-env.js`
- Test: `tests/validation-env.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/validation-env.test.js` (add `readEnvJson` to the existing import from `validation-env.js`):

```js
const envDir = (values) => {
  const dir = mkdtempSync(join(tmpdir(), 'env-json-'));
  if (values !== undefined) writeFileSync(join(dir, 'env.json'), typeof values === 'string' ? values : JSON.stringify(values));
  return dir;
};
const V2 = { schemaVersion: 2, repos: { ApiCommonData: { url: '/r/acd.git', ref: 'master', followsRebuild: true } }, executables: { perl: '/usr/bin/perl' }, build: ['true'] };

test('readEnvJson accepts a v2 env.json', () => {
  assert.deepEqual(readEnvJson(envDir(V2)).values, V2);
  assert.equal(readEnvJson(envDir({ ...V2, build: undefined })).error, undefined);
});

test('readEnvJson explains what is wrong with an env.json', () => {
  assert.match(readEnvJson(envDir()).error, /env\.json not found; ask the data loader/);
  assert.match(readEnvJson(envDir('{ nope')).error, /is not valid JSON/);
  assert.match(readEnvJson(envDir({ schemaVersion: 1 })).error, /schemaVersion 1 is the old flat validation-env\.json; rewrite it as schemaVersion 2/);
  assert.match(readEnvJson(envDir({ ...V2, schemaVersion: 3 })).error, /schemaVersion must be 2/);
  assert.match(readEnvJson(envDir({ ...V2, repos: [] })).error, /"repos" must be an object/);
  assert.match(readEnvJson(envDir({ ...V2, repos: { x: { url: '/u' } } })).error, /repos\.x needs string "url" and "ref"/);
  assert.match(readEnvJson(envDir({ ...V2, repos: { x: { url: '/u', ref: 'm', followsRebuild: 'yes' } } })).error, /repos\.x\.followsRebuild must be true or false/);
  for (const bad of ['..', 'build', 'a/b']) assert.match(readEnvJson(envDir({ ...V2, repos: { [bad]: { url: '/u', ref: 'm' } } })).error, /must be a plain directory name other than build/);
  assert.match(readEnvJson(envDir({ ...V2, executables: { perl: 'perl' } })).error, /executables\.perl must be an absolute path/);
  assert.match(readEnvJson(envDir({ ...V2, build: 'make' })).error, /"build" must be an array of shell commands/);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/validation-env.test.js`
Expected: FAIL, `readEnvJson` is not exported.

- [ ] **Step 3: Implement**

In `shared/scripts/lib/validation-env.js`, change the import to `import { join, resolve, isAbsolute } from 'node:path';`, export the existing `ASK` constant (`export const ASK = ...`), and add below it:

```js
export const ENV_FILENAME = 'env.json';

/** A type directory's env.json, checked against schema v2: { values } or { error }. */
export function readEnvJson(typeDir) {
  const path = join(typeDir, ENV_FILENAME);
  if (!existsSync(path)) return { error: `${path} not found; ${ASK}` };
  let values;
  try { values = JSON.parse(readFileSync(path, 'utf-8')); }
  catch (e) { return { error: `${path} is not valid JSON: ${e.message}` }; }
  const problem = envProblem(values);
  return problem ? { error: `${path}: ${problem}` } : { values };
}

const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const RESERVED = ['.', '..', 'build'];

function envProblem(v) {
  if (v?.schemaVersion === 1) return 'schemaVersion 1 is the old flat validation-env.json; rewrite it as schemaVersion 2 (repos, executables, build)';
  if (v?.schemaVersion !== 2) return 'schemaVersion must be 2';
  if (!isObject(v.repos)) return '"repos" must be an object of { url, ref, followsRebuild? }';
  for (const [name, r] of Object.entries(v.repos)) {
    if (!/^[A-Za-z0-9._-]+$/.test(name) || RESERVED.includes(name)) return `repo name "${name}" must be a plain directory name other than build`;
    if (typeof r?.url !== 'string' || typeof r?.ref !== 'string') return `repos.${name} needs string "url" and "ref"`;
    if (r.followsRebuild !== undefined && typeof r.followsRebuild !== 'boolean') return `repos.${name}.followsRebuild must be true or false`;
  }
  if (!isObject(v.executables)) return '"executables" must be an object of absolute paths';
  for (const [name, p] of Object.entries(v.executables)) {
    if (typeof p !== 'string' || !isAbsolute(p)) return `executables.${name} must be an absolute path`;
  }
  if (v.build !== undefined && !(Array.isArray(v.build) && v.build.every((c) => typeof c === 'string'))) return '"build" must be an array of shell commands';
  return null;
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `node --test tests/validation-env.test.js`
Expected: PASS (old v1 tests still pass too)

- [ ] **Step 5: Commit**

```bash
git add shared/scripts/lib/validation-env.js tests/validation-env.test.js
git commit -m "Read and check env.json schema v2"
```

---

### Task 3: Verify workspaces (create, reuse, rebuild, refresh)

**Files:**
- Create: `shared/scripts/lib/validation-workspace.js`
- Modify: `tests/helpers.js`, `package.json`
- Test: `tests/validation-workspace.test.js`

- [ ] **Step 1: Add test helpers**

Append to `tests/helpers.js`:

```js
const identity = ['-c', 'user.name=Some One', '-c', 'user.email=someone@apidb.org'];

/** Commits every change in a checkout or worktree. */
export function commitIn(dir, message = 'change') {
  execFileSync('git', ['-C', dir, 'add', '-A']);
  execFileSync('git', ['-C', dir, ...identity, 'commit', '-q', '-m', message]);
}

/** A bare tool repo: master with one commit, plus branches and tags at it. work pushes later commits. */
export function initToolRemote(root, name, { branches = [], tags = [] } = {}) {
  const url = join(root, 'remotes', `${name}.git`);
  const work = join(root, 'remotes', `${name}-work`);
  execFileSync('git', ['init', '--bare', '-q', '--initial-branch=master', url]);
  execFileSync('git', ['clone', '-q', url, work]);
  writeFileSync(join(work, 'README'), `${name}\n`);
  commitIn(work, 'init');
  execFileSync('git', ['-C', work, 'push', '-q', '-u', 'origin', 'master']);
  for (const b of branches) execFileSync('git', ['-C', work, 'push', '-q', 'origin', `master:refs/heads/${b}`]);
  for (const t of tags) {
    execFileSync('git', ['-C', work, 'tag', t]);
    execFileSync('git', ['-C', work, 'push', '-q', 'origin', t]);
  }
  return { url, work };
}

/** Pushes a new commit to branch of a tool remote's work clone; returns its sha. */
export function advanceRemote(work, branch = 'master') {
  execFileSync('git', ['-C', work, 'fetch', '-q', 'origin']);
  execFileSync('git', ['-C', work, 'checkout', '-q', '-B', branch, `origin/${branch}`]);
  writeFileSync(join(work, 'README'), `${Math.random()}\n`);
  commitIn(work, 'advance');
  execFileSync('git', ['-C', work, 'push', '-q', 'origin', branch]);
  return execFileSync('git', ['-C', work, 'rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim();
}

/** A validation root with rnaseq-validation/env.json (schema v2). */
export function validationRoot(repos, { build = [], executables = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'validation-root-'));
  const typeDir = join(root, 'rnaseq-validation');
  mkdirSync(typeDir);
  writeFileSync(join(typeDir, 'env.json'), JSON.stringify({ schemaVersion: 2, repos, executables, build }));
  return { root, typeDir };
}

export const headOf = (dir) => execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim();
export const branchOf = (dir) => execFileSync('git', ['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf-8' }).trim();
```

- [ ] **Step 2: Write the failing tests**

Append to `tests/validation-workspace.test.js` (merge the imports at the top):

```js
import { existsSync, readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openVerifyWorkspace } from '../shared/scripts/lib/validation-workspace.js';
import { initToolRemote, advanceRemote, validationRoot, commitIn, headOf, branchOf } from './helpers.js';

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
```

- [ ] **Step 3: Run them to verify they fail**

Run: `node --test tests/validation-workspace.test.js`
Expected: FAIL, `validation-workspace.js` does not exist.

- [ ] **Step 4: Implement**

Create `shared/scripts/lib/validation-workspace.js`:

```js
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, delimiter } from 'node:path';
import { defaultExec, failureOutput } from './tools/exec.js';
import { readEnvJson, ASK } from './validation-env.js';
import { validationWorkspaceFor } from '../dataset-types/validators.js';

const BUILD = 'build';
const BUILT = '.built';
export const verifyBranch = (accession) => `verify/${accession}`;

const git = (exec, dir, args) => exec('git', ['-C', dir, ...args]).trim();
const tryGit = (exec, dir, args) => { try { return git(exec, dir, args); } catch { return null; } };
const tail = (text, lines = 20) => text.split('\n').slice(-lines).join('\n');

/** <root>/<type dir>: { typeDir } or { error }. The loader names root; it is never guessed. */
export function typeDirOf(root, datasetType) {
  if (!root) return { error: `No validation workspace given; ${ASK} and pass --workspace <dir>` };
  const name = validationWorkspaceFor(datasetType);
  if (!name) return { error: `datasetType "${datasetType}" has no validation workspace` };
  return { typeDir: join(resolve(root), name) };
}

function openTypeDir(root, datasetType) {
  const t = typeDirOf(root, datasetType);
  if (t.error) return t;
  if (!existsSync(t.typeDir)) return { error: `${t.typeDir} does not exist; create it with an env.json (${ASK})` };
  const env = readEnvJson(t.typeDir);
  return env.error ? { error: env.error } : { typeDir: t.typeDir, env: env.values };
}

/** Tools run from the build: build/bin first on PATH; Perl and R libraries from the build only. */
export function toolEnv(buildDir, base = process.env) {
  return {
    ...base,
    PATH: [join(buildDir, 'bin'), base.PATH].filter(Boolean).join(delimiter),
    PERL5LIB: join(buildDir, 'lib', 'perl'),
    R_LIBS: join(buildDir, 'lib', 'R')
  };
}

function baseClone(exec, typeDir, name, repo) {
  const dir = join(typeDir, 'repos', name);
  if (!existsSync(dir)) {
    mkdirSync(join(typeDir, 'repos'), { recursive: true });
    exec('git', ['clone', '-q', '--no-checkout', repo.url, dir]);
  }
  return dir;
}

const fetchAll = (exec, base) => git(exec, base, ['fetch', '-q', '--prune', '--tags', 'origin']);

function commitOf(exec, base, ref, { branchOnly = false } = {}) {
  const sha = tryGit(exec, base, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${ref}^{commit}`])
    ?? (branchOnly ? null : tryGit(exec, base, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]));
  if (!sha) throw new Error(`${base} has no ${branchOnly ? 'branch' : 'branch, tag or commit'} "${ref}" on origin`);
  return sha;
}

function addWorktree(exec, base, wt, args) {
  fetchAll(exec, base);
  git(exec, base, ['worktree', 'prune']);
  git(exec, base, ['worktree', 'add', '-q', ...args(wt)]);
}

/** What removing or moving a worktree would lose: uncommitted changes, commits on no remote branch or tag. */
export function pendingChanges(exec, worktree) {
  const lost = [];
  if (git(exec, worktree, ['status', '--porcelain'])) lost.push('uncommitted changes');
  const unpushed = git(exec, worktree, ['rev-list', '--count', 'HEAD', '--not', '--remotes', '--tags']);
  if (unpushed !== '0') lost.push(`${unpushed} commit(s) not on any remote branch`);
  return lost;
}

const worktreesIn = (dir) => existsSync(dir) ? readdirSync(dir).filter((e) => existsSync(join(dir, e, '.git'))) : [];

function assertNothingPending(exec, dir, action, hint) {
  const pending = worktreesIn(dir).map((n) => [n, pendingChanges(exec, join(dir, n))]).filter(([, p]) => p.length);
  if (pending.length) throw new Error(`${dir} cannot be ${action}; ${hint}:\n${pending.map(([n, p]) => `  - ${n}: ${p.join(', ')}`).join('\n')}`);
}

function runBuild(exec, dir, commands) {
  const buildDir = join(dir, BUILD);
  rmSync(buildDir, { recursive: true, force: true });
  mkdirSync(buildDir, { recursive: true });
  const env = { ...toolEnv(buildDir), BUILD_DIR: buildDir, PROPOSAL_DIR: dir };
  commands.forEach((cmd, i) => {
    try { exec('sh', ['-c', cmd], { cwd: dir, env }); }
    catch (e) { throw new Error(`build step ${i + 1} failed (${cmd}): ${tail(failureOutput(e))}`); }
  });
  writeFileSync(join(buildDir, BUILT), `${new Date().toISOString()}\n`);
}

/**
 * Places each repo's worktree under dir (place returns true when it created or
 * moved one), then builds when anything changed, rebuild is set or no build
 * finished. Returns the handle, or { error } for anything that stops the tools.
 */
function prepare(exec, t, dir, { refOf, place, rebuild = false }) {
  try {
    mkdirSync(dir, { recursive: true });
    const repos = {};
    let changed = false;
    for (const [name, repo] of Object.entries(t.env.repos)) {
      const base = baseClone(exec, t.typeDir, name, repo);
      const wt = join(dir, name);
      changed = place(repo, base, wt) || changed;
      repos[name] = { path: wt, ref: refOf(repo), sha: git(exec, wt, ['rev-parse', 'HEAD']) };
    }
    if (changed || rebuild || !existsSync(join(dir, BUILD, BUILT))) runBuild(exec, dir, t.env.build ?? []);
    const buildDir = join(dir, BUILD);
    return { dir, buildDir, repos, executables: t.env.executables, env: toolEnv(buildDir) };
  } catch (e) {
    return { error: failureOutput(e) };
  }
}

/**
 * proposals/<accession>/: made from freshly fetched refs on first use and
 * reused as is after, so in-progress fixes survive. refresh moves clean
 * worktrees to the current refs (refusing otherwise); rebuild reruns the build.
 */
export function openVerifyWorkspace({ root, datasetType, accession, refresh = false, rebuild = false, exec = defaultExec }) {
  const t = openTypeDir(root, datasetType);
  if (t.error) return t;
  const dir = join(t.typeDir, 'proposals', accession);
  if (refresh) assertNothingPending(exec, dir, 'refreshed', 'push or discard them first');
  return prepare(exec, t, dir, {
    rebuild,
    refOf: (repo) => repo.ref,
    place: (repo, base, wt) => {
      if (!existsSync(wt)) {
        addWorktree(exec, base, wt, (path) => ['-b', verifyBranch(accession), path, commitOf(exec, base, repo.ref)]);
        return true;
      }
      if (!refresh) return false;
      fetchAll(exec, base);
      git(exec, wt, ['reset', '-q', '--hard', commitOf(exec, base, repo.ref)]);
      return true;
    }
  });
}
```

Note: `exec` here is `defaultExec` (`execFileSync` with `encoding: 'utf-8'`), so `git()` gets strings. The `readdirSync`, `rmSync` imports are used in Task 4.

- [ ] **Step 5: Register the file for syncing**

In `package.json` `sharedFiles`, after the `"scripts/lib/validation-env.js"` entry, add:

```json
    "scripts/lib/validation-workspace.js": [
      "verify-bulk-rnaseq",
      "load-proposals"
    ],
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test tests/validation-workspace.test.js`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add shared/scripts/lib/validation-workspace.js tests/helpers.js tests/validation-workspace.test.js package.json
git commit -m "Verify workspaces: base clones, verify/<accession> worktrees, per-proposal builds"
```

---

### Task 4: Load workspaces, mark-ready disposal, build-start reset

**Files:**
- Modify: `shared/scripts/lib/validation-workspace.js`
- Test: `tests/validation-workspace.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/validation-workspace.test.js` (add `openLoadWorkspace, verifyWorkspaceDisposal, resetLoadWorkspaces` to the import from `validation-workspace.js`, and `execFileSync` from `node:child_process`):

```js
const openLoad = (root, extra = {}) => openLoadWorkspace({ root, datasetType: 'bulk-rnaseq', rebuildBranch: 'rebuild70', ...extra });

test('load makes detached worktrees: followsRebuild repos at rebuild<RR>, others at their ref', () => {
  const { root, typeDir, acd, sw } = verifySetup();
  const rebuildSha = advanceRemote(acd.work, 'rebuild70');
  const ws = openLoad(root);
  assert.equal(ws.error, undefined);
  assert.equal(ws.dir, join(typeDir, 'loads/rebuild70'));
  assert.deepEqual(ws.repos.ApiCommonData, { path: join(ws.dir, 'ApiCommonData'), ref: 'rebuild70', sha: rebuildSha });
  assert.equal(branchOf(ws.repos.ApiCommonData.path), 'HEAD');
  assert.equal(ws.repos['study.wrangler'].sha, headOf(sw.work));
  assert.equal(builds(ws.dir), 1);
});

test('later loads in the rebuild share the workspace without fetching; refresh recreates it', () => {
  const { root, acd } = verifySetup();
  const first = openLoad(root).repos.ApiCommonData.sha;
  const newer = advanceRemote(acd.work, 'rebuild70');
  const again = openLoad(root);
  assert.equal(again.repos.ApiCommonData.sha, first);
  assert.equal(builds(again.dir), 1);
  const fresh = openLoad(root, { refresh: true });
  assert.equal(fresh.repos.ApiCommonData.sha, newer);
});

test('a followsRebuild repo without the rebuild branch is an error naming it, with no fallback', () => {
  const { root } = verifySetup();
  assert.match(openLoad(root, { rebuildBranch: 'rebuild71' }).error, /repos\/ApiCommonData has no branch "rebuild71" on origin/);
  assert.match(openLoad(root, { rebuildBranch: 'main' }).error, /rebuildBranch must name a rebuild branch/);
});

test('disposal refuses uncommitted or unpushed work, then removes worktrees, branches and the directory', () => {
  const { root, typeDir } = verifySetup();
  const ws = open(root);
  const acdPath = ws.repos.ApiCommonData.path;
  const disposal = verifyWorkspaceDisposal({ root, accession: 'PRJNA1' });
  writeFileSync(join(acdPath, 'fix.pm'), '1;\n');
  assert.throws(() => disposal.assertDisposable('bulk-rnaseq'), /cannot be removed; push them, or pass --discard-changes[\s\S]*ApiCommonData: uncommitted changes/);
  commitIn(acdPath, 'fix');
  assert.throws(() => disposal.assertDisposable('bulk-rnaseq'), /ApiCommonData: 1 commit\(s\) not on any remote branch/);
  execFileSync('git', ['-C', acdPath, 'push', '-q', 'origin', 'verify/PRJNA1']);
  disposal.assertDisposable('bulk-rnaseq');
  assert.equal(disposal.dispose('bulk-rnaseq'), ws.dir);
  assert.equal(existsSync(ws.dir), false);
  const base = join(typeDir, 'repos/ApiCommonData');
  assert.equal(execFileSync('git', ['-C', base, 'branch', '--list', 'verify/PRJNA1'], { encoding: 'utf-8' }).trim(), '');
  assert.equal(execFileSync('git', ['-C', base, 'worktree', 'list'], { encoding: 'utf-8' }).trim().split('\n').length, 1);
});

test('discardChanges disposes of a dirty workspace; nothing to dispose of is not an error', () => {
  const { root } = verifySetup();
  const ws = open(root);
  writeFileSync(join(ws.repos.ApiCommonData.path, 'fix.pm'), '1;\n');
  const disposal = verifyWorkspaceDisposal({ root, accession: 'PRJNA1', discardChanges: true });
  disposal.assertDisposable('bulk-rnaseq');
  assert.equal(disposal.dispose('bulk-rnaseq'), ws.dir);
  assert.equal(existsSync(ws.dir), false);
  assert.equal(verifyWorkspaceDisposal({ root, accession: 'PRJNA9' }).dispose('bulk-rnaseq'), null);
  assert.equal(verifyWorkspaceDisposal({ root, accession: 'GCA_1' }).dispose('genome-assembly'), null, 'no annotated-genome-validation dir');
});

test('build start removes every load workspace, and refuses an edited one', () => {
  const { root } = verifySetup();
  const a = openLoad(root);
  assert.deepEqual(resetLoadWorkspaces({ root }), [a.dir]);
  assert.equal(existsSync(a.dir), false);
  const b = openLoad(root);
  writeFileSync(join(b.repos.ApiCommonData.path, 'oops'), 'x');
  assert.throws(() => resetLoadWorkspaces({ root }), /loads\/rebuild70 cannot be removed; nobody should edit a load workspace/);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/validation-workspace.test.js`
Expected: FAIL, `openLoadWorkspace` is not exported.

- [ ] **Step 3: Implement**

Append to `shared/scripts/lib/validation-workspace.js`:

```js
const REBUILD_BRANCH = /^rebuild\d+$/;

/** Removes each worktree under dir from its base clone (and branch, when named), then dir. */
function removeWorktreeDir(exec, typeDir, dir, { action, hint, discard = false, branch = null }) {
  if (!existsSync(dir)) return false;
  if (!discard) assertNothingPending(exec, dir, action, hint);
  for (const name of worktreesIn(dir)) {
    const base = join(typeDir, 'repos', name);
    git(exec, base, ['worktree', 'remove', ...(discard ? ['--force'] : []), join(dir, name)]);
    if (branch && tryGit(exec, base, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])) git(exec, base, ['branch', '-q', '-D', branch]);
  }
  rmSync(dir, { recursive: true, force: true });
  return true;
}

const LOAD_HINT = 'nobody should edit a load workspace; inspect it';

/**
 * loads/<rebuild>/: detached worktrees shared by every load in that rebuild,
 * fetched once. followsRebuild repos check out origin/<rebuild>, others their ref.
 * refresh recreates it.
 */
export function openLoadWorkspace({ root, datasetType, rebuildBranch, refresh = false, exec = defaultExec }) {
  if (!REBUILD_BRANCH.test(rebuildBranch ?? '')) return { error: `rebuildBranch must name a rebuild branch (rebuildRR); got "${rebuildBranch}"` };
  const t = openTypeDir(root, datasetType);
  if (t.error) return t;
  const dir = join(t.typeDir, 'loads', rebuildBranch);
  if (refresh) removeWorktreeDir(exec, t.typeDir, dir, { action: 'refreshed', hint: LOAD_HINT });
  const refOf = (repo) => repo.followsRebuild ? rebuildBranch : repo.ref;
  return prepare(exec, t, dir, {
    refOf,
    place: (repo, base, wt) => {
      if (existsSync(wt)) return false;
      addWorktree(exec, base, wt, (path) => ['--detach', path, commitOf(exec, base, refOf(repo), { branchOnly: Boolean(repo.followsRebuild) })]);
      return true;
    }
  });
}

/**
 * mark-ready's half of the verify lifecycle: assertDisposable(datasetType)
 * refuses while a worktree holds work that would be lost; dispose(datasetType)
 * removes proposals/<accession>/ and its verify branches, returning the
 * directory or null when there was none.
 */
export function verifyWorkspaceDisposal({ root, accession, discardChanges = false, exec = defaultExec }) {
  const locate = (datasetType) => {
    const t = typeDirOf(root, datasetType);
    if (t.error) throw new Error(t.error);
    const dir = join(t.typeDir, 'proposals', accession);
    return existsSync(dir) ? { typeDir: t.typeDir, dir } : null;
  };
  const hint = 'push them, or pass --discard-changes';
  return {
    assertDisposable(datasetType) {
      const found = locate(datasetType);
      if (found && !discardChanges) assertNothingPending(exec, found.dir, 'removed', hint);
    },
    dispose(datasetType) {
      const found = locate(datasetType);
      if (!found) return null;
      removeWorktreeDir(exec, found.typeDir, found.dir, { action: 'removed', hint, discard: discardChanges, branch: verifyBranch(accession) });
      return found.dir;
    }
  };
}

/** Build start: removes loads/<rebuild>/ for every rebuild of every type under root. Returns the directories removed. */
export function resetLoadWorkspaces({ root, exec = defaultExec }) {
  if (!root) throw new Error(`No validation workspace given; ${ASK} and pass --workspace <dir>`);
  const removed = [];
  for (const name of validationWorkspaceNames()) {
    const typeDir = join(resolve(root), name);
    const loads = join(typeDir, 'loads');
    if (!existsSync(loads)) continue;
    for (const entry of readdirSync(loads)) {
      const dir = join(loads, entry);
      if (removeWorktreeDir(exec, typeDir, dir, { action: 'removed', hint: LOAD_HINT })) removed.push(dir);
    }
  }
  return removed;
}
```

Change the validators import at the top to `import { validationWorkspaceFor, validationWorkspaceNames } from '../dataset-types/validators.js';`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/validation-workspace.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add shared/scripts/lib/validation-workspace.js tests/validation-workspace.test.js
git commit -m "Load workspaces per rebuild, mark-ready disposal guard, build-start reset"
```

---

### Task 5: Tools resolve from the workspace handle

**Files:**
- Modify: `shared/scripts/lib/validation-env.js`, `shared/scripts/lib/tools/apicommondata.js`, `shared/scripts/lib/tools/study-wrangler.js`
- Test: `tests/validation-env.test.js` (rewrite the v1 parts)

- [ ] **Step 1: Rewrite the tool tests against a handle**

In `tests/validation-env.test.js`, delete the `workspace()` helper and the tests `readValidationEnv needs a workspace...`, `without a workspace every tool is missing...`, `apiCommonData resolves relative to...`, `apiCommonData is missing when...`, `studyWrangler resolves Rscript...`, `studyWrangler is missing when...`, `an unknown tool name is missing...`, and the three real-tool tests at the bottom. Change the imports to:

```js
import { readEnvJson, createToolResolver } from '../shared/scripts/lib/validation-env.js';
import { toolEnv, openVerifyWorkspace } from '../shared/scripts/lib/validation-workspace.js';
```

Keep `fakeExec`, but drop its `git` branch (tools no longer call git). Add:

```js
/** A handle as validation-workspace.js returns it, with ApiCommonData's parser modules installed in build/. */
function handle({ modules = ['AnalysisConfigParser.pm', 'AnalysisConfigRepeatFinder.pm'], executables, repos } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'validation-handle-'));
  const buildDir = join(dir, 'build');
  mkdirSync(join(buildDir, 'lib/perl/ApiCommonData/Load'), { recursive: true });
  for (const m of modules) writeFileSync(join(buildDir, 'lib/perl/ApiCommonData/Load', m), '1;\n');
  mkdirSync(join(dir, 'bin'));
  writeFileSync(join(dir, 'bin/perl'), '');
  writeFileSync(join(dir, 'bin/Rscript'), '');
  return {
    dir, buildDir, env: toolEnv(buildDir),
    repos: repos ?? { ApiCommonData: { path: join(dir, 'ApiCommonData'), ref: 'master', sha: 'c0ffee' } },
    executables: executables ?? { perl: join(dir, 'bin/perl'), rscript: join(dir, 'bin/Rscript') }
  };
}

test('a workspace error makes every tool missing with that error', () => {
  const tools = createToolResolver({ error: 'No validation workspace given; ask the data loader' }, { exec: fakeExec() });
  assert.match(tools.resolveTool('apiCommonData').missing, /ask the data loader/);
  assert.equal(tools.workspace, null);
  assert.deepEqual(tools.repos(), {});
});

test('apiCommonData runs from the build and is versioned by its worktree', () => {
  const ws = handle();
  const tools = createToolResolver(ws, { exec: fakeExec() });
  const { tool } = tools.resolveTool('apiCommonData');
  assert.equal(tool.libDir, join(ws.buildDir, 'lib/perl'));
  assert.equal(tool.perl, join(ws.dir, 'bin/perl'));
  assert.equal(tool.env.PERL5LIB, join(ws.buildDir, 'lib/perl'));
  assert.equal(tool.version, 'c0ffee');
  assert.deepEqual(tools.versions(), { apiCommonData: 'c0ffee' });
  assert.deepEqual(tools.repos(), { ApiCommonData: { ref: 'master', sha: 'c0ffee' } });
  assert.equal(tools.workspace, ws.dir);
});

test('apiCommonData is missing without perl, its repo or its installed modules', () => {
  const missing = (ws) => createToolResolver(ws, { exec: fakeExec() }).resolveTool('apiCommonData').missing;
  assert.match(missing(handle({ executables: { rscript: '/x' } })), /env\.json has no executables\.perl/);
  assert.match(missing(handle({ executables: { perl: '/no/perl' } })), /perl not found at \/no\/perl/);
  assert.match(missing(handle({ repos: {} })), /env\.json lists no ApiCommonData repo/);
  assert.match(missing(handle({ modules: ['AnalysisConfigParser.pm'] })), /ApiCommonData\/Load has no AnalysisConfigRepeatFinder\.pm; does the build install ApiCommonData\?/);
});

test('studyWrangler runs Rscript with the build R library and checks its version', () => {
  const ws = handle();
  const { tool } = createToolResolver(ws, { exec: fakeExec({ version: '1.0.42' }) }).resolveTool('studyWrangler');
  assert.equal(tool.rscript, join(ws.dir, 'bin/Rscript'));
  assert.equal(tool.env.R_LIBS, join(ws.buildDir, 'lib/R'));
  assert.equal(tool.version, '1.0.42');
  const missing = (w, o) => createToolResolver(w, { exec: fakeExec(o) }).resolveTool('studyWrangler').missing;
  assert.match(missing(handle({ executables: { perl: '/x' } })), /env\.json has no executables\.rscript/);
  assert.match(missing(handle({ executables: { rscript: '/no/R' } })), /Rscript not found at \/no\/R/);
  assert.match(missing(handle(), { rFails: true }), /study\.wrangler is not installed in .*build\/lib\/R/);
  assert.match(missing(handle(), { version: '1.0.9' }), /study\.wrangler 1\.0\.9 is older than 1\.0\.41/);
});

test('an unknown tool name is missing, and resolution is cached', () => {
  let probes = 0;
  const tools = createToolResolver(handle(), { exec: () => { probes++; return '1.0.41'; } });
  assert.match(tools.resolveTool('blast').missing, /unknown tool "blast"/);
  tools.resolveTool('studyWrangler');
  tools.resolveTool('studyWrangler');
  assert.equal(probes, 1);
});

const REAL = process.env.VALIDATION_ROOT;
const needsWorkspace = { skip: !REAL && 'VALIDATION_ROOT is not set; ask John for the validation workspace root to run real-tool tests' };
const fixtureOrganism = join(fixtures, 'proposals/PRJNA000002/curated/tfakST1');
const realTools = () => createToolResolver(openVerifyWorkspace({ root: REAL, datasetType: 'bulk-rnaseq', accession: 'real-tool-tests' }));

test('ApiCommonData parses the fixture analysisConfig.xml', needsWorkspace, () => {
  const { tool, missing } = realTools().resolveTool('apiCommonData');
  assert.equal(missing, undefined);
  const parsed = parseAnalysisConfig(tool, join(fixtureOrganism, 'analysisConfig.xml'));
  assert.deepEqual(parsed.steps.map((s) => s.class), ['ApiCommonData::Load::RnaSeqAnalysisEbi']);
  assert.deepEqual(parsed.groups, [{ displayName: 'Control', samples: ['SAMN1'] }, { displayName: 'Stressed', samples: ['SAMN2'] }]);
});

test('ApiCommonData reports XML it cannot read', needsWorkspace, () => {
  const { tool } = realTools().resolveTool('apiCommonData');
  const bad = join(mkdtempSync(join(tmpdir(), 'acd-bad-')), 'analysisConfig.xml');
  writeFileSync(bad, '<xml><step class="x">');
  assert.throws(() => parseAnalysisConfig(tool, bad), /./);
});

test('study.wrangler accepts the fixture entity and rejects a broken one', needsWorkspace, () => {
  const { tool, missing } = realTools().resolveTool('studyWrangler');
  assert.equal(missing, undefined);
  assert.equal(validateEntity(tool, join(fixtureOrganism, 'entity-sample.tsv'), join(fixtureOrganism, 'entity-sample.yaml')).ok, true);
  const dir = mkdtempSync(join(tmpdir(), 'stf-bad-'));
  const [header, first] = readFileSync(join(fixtureOrganism, 'entity-sample.tsv'), 'utf-8').split('\n');
  writeFileSync(join(dir, 'entity-sample.tsv'), `${header}\n${first}\n${first}\n`);
  copyFileSync(join(fixtureOrganism, 'entity-sample.yaml'), join(dir, 'entity-sample.yaml'));
  assert.equal(validateEntity(tool, join(dir, 'entity-sample.tsv'), join(dir, 'entity-sample.yaml')).ok, false);
});
```

`fakeExec` becomes:

```js
const fakeExec = ({ version = '1.0.41', rFails = false } = {}) => (cmd, args) => {
  if (cmd.endsWith('Rscript')) { if (rFails) throw new Error('there is no package called study.wrangler'); return version; }
  throw new Error(`unexpected ${cmd} ${args.join(' ')}`);
};
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/validation-env.test.js`
Expected: FAIL (resolvers still read `env.values`; `repos` is not a function).

- [ ] **Step 3: Implement `createToolResolver` on a handle**

In `shared/scripts/lib/validation-env.js`, delete `VALIDATION_ENV_FILENAME` and `readValidationEnv`, drop `resolve` from the path import, and replace `createToolResolver` with:

```js
const RESOLVERS = { apiCommonData: resolveApiCommonData, studyWrangler: resolveStudyWrangler };

/**
 * resolveTool(name) -> { tool } | { missing }, cached, for a workspace handle
 * (or its { error }); versions() of the tools resolved so far; repos() the
 * ref and commit of each worktree.
 */
export function createToolResolver(ws, { exec = defaultExec } = {}) {
  const cache = new Map();
  const resolveTool = (name) => {
    if (!cache.has(name)) {
      if (ws.error) cache.set(name, { missing: ws.error });
      else if (!RESOLVERS[name]) cache.set(name, { missing: `unknown tool "${name}"` });
      else cache.set(name, RESOLVERS[name](ws, { exec }));
    }
    return cache.get(name);
  };
  const versions = () => Object.fromEntries([...cache].filter(([, r]) => r.tool).map(([name, r]) => [name, r.tool.version]));
  const repos = () => ws.error ? {} : Object.fromEntries(Object.entries(ws.repos).map(([name, r]) => [name, { ref: r.ref, sha: r.sha }]));
  return { workspace: ws.dir ?? null, resolveTool, versions, repos };
}
```

- [ ] **Step 4: Implement the ApiCommonData resolver**

Replace `shared/scripts/lib/tools/apicommondata.js` with:

```js
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultExec, failureOutput } from './exec.js';

const SHIM = join(dirname(fileURLToPath(import.meta.url)), 'apicommondata-parse.pl');
const REPO = 'ApiCommonData';
export const PARSER_MODULES = ['AnalysisConfigParser.pm', 'AnalysisConfigRepeatFinder.pm'];

/** { tool: { libDir, perl, env, version } } or { missing }, from the validation workspace's build. */
export function resolveApiCommonData(ws) {
  const { perl } = ws.executables;
  if (!perl) return { missing: 'env.json has no executables.perl' };
  if (!existsSync(perl)) return { missing: `perl not found at ${perl}` };
  const repo = ws.repos[REPO];
  if (!repo) return { missing: `env.json lists no ${REPO} repo` };
  const libDir = join(ws.buildDir, 'lib', 'perl');
  const modules = join(libDir, 'ApiCommonData', 'Load');
  const absent = PARSER_MODULES.filter((m) => !existsSync(join(modules, m)));
  if (absent.length) return { missing: `${modules} has no ${absent.join(', ')}; does the build install ApiCommonData?` };
  return { tool: { libDir, perl, env: ws.env, version: repo.sha } };
}

/** ApiCommonData's own reading of an analysisConfig.xml: { steps: [{ class, arguments }], groups: [{ displayName, samples }] }. */
export function parseAnalysisConfig(tool, xmlPath, { exec = defaultExec } = {}) {
  let out;
  try { out = exec(tool.perl, [SHIM, xmlPath], { env: tool.env }); }
  catch (e) { throw new Error(failureOutput(e)); }
  return JSON.parse(out);
}
```

In `apicommondata-parse.pl`, change the usage comment's `(PERL5LIB set by apicommondata.js)` to `(PERL5LIB is the workspace build's lib/perl)`.

- [ ] **Step 5: Implement the study.wrangler resolver**

In `shared/scripts/lib/tools/study-wrangler.js`, drop `resolve` from the path import and replace `resolveStudyWrangler` with:

```js
/** { tool: { rscript, env, version } } or { missing }, from the validation workspace's build. */
export function resolveStudyWrangler(ws, { exec = defaultExec } = {}) {
  const { rscript } = ws.executables;
  if (!rscript) return { missing: 'env.json has no executables.rscript' };
  if (!existsSync(rscript)) return { missing: `Rscript not found at ${rscript}` };
  let version;
  try { version = exec(rscript, ['-e', 'cat(as.character(packageVersion("study.wrangler")))'], { env: ws.env }).trim(); }
  catch { return { missing: `study.wrangler is not installed in ${ws.env.R_LIBS} for ${rscript}` }; }
  if (compareVersions(version, MIN_STUDY_WRANGLER) < 0) return { missing: `study.wrangler ${version} is older than ${MIN_STUDY_WRANGLER}` };
  return { tool: { rscript, env: ws.env, version } };
}
```

- [ ] **Step 6: Run the tests**

Run: `node --test tests/validation-env.test.js tests/validation-workspace.test.js`
Expected: PASS. `tests/validation-ops.test.js` is fixed in Task 6.

- [ ] **Step 7: Commit**

```bash
git add shared/scripts/lib/validation-env.js shared/scripts/lib/tools tests/validation-env.test.js
git commit -m "Tools resolve from the workspace handle and run from its build"
```

---

### Task 6: Validation wiring and flags

**Files:**
- Modify: `shared/scripts/lib/validation-ops.js`, `shared/scripts/validate-proposal.js`, `shared/scripts/load-proposal.js`
- Test: `tests/validation-ops.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/validation-ops.test.js` (import `validationRoot, initToolRemote` from `./helpers.js`; `mkdtempSync` from `node:fs`; `tmpdir` from `node:os`):

```js
/** A root whose rnaseq-validation has one repo and a build that installs nothing. */
function emptyToolRoot() {
  const acd = initToolRemote(mkdtempSync(join(tmpdir(), 'tool-remotes-')), 'ApiCommonData', { branches: ['rebuild70'] });
  // process.execPath stands in for perl: it always exists, and the modules check fails first.
  return validationRoot({ ApiCommonData: { url: acd.url, ref: 'master', followsRebuild: true } }, { executables: { perl: process.execPath } });
}

test('validateProposal validates in proposals/<accession>/ and records each repo commit', async () => {
  const { repo, git } = setupMerged();
  const { root, typeDir } = emptyToolRoot();
  const { report } = await validateProposal({ git, ticket: stubTicket(), repoPath: repo, accession: 'PRJNA000002', workspace: root, post: false });
  assert.equal(report.workspace, join(typeDir, 'proposals/PRJNA000002'));
  assert.deepEqual(Object.keys(report.repos), ['ApiCommonData']);
  assert.equal(report.repos.ApiCommonData.ref, 'master');
  assert.match(report.repos.ApiCommonData.sha, /^[0-9a-f]{40}$/);
  assert.ok(report.findings.some((f) => f.validator === 'perlParse' && /could not verify: .*has no AnalysisConfigParser\.pm/.test(f.message)));
});

test('contentValidation validates in loads/<rebuild>/', async () => {
  const proposalDir = join(fixtures, 'proposals/PRJNA000002');
  const manifest = JSON.parse(readFileSync(join(proposalDir, 'manifest.json'), 'utf-8'));
  const { root, typeDir } = emptyToolRoot();
  await contentValidation({ workspace: root, rebuildBranch: 'rebuild70' })({ proposalDir, manifest });
  assert.ok(existsSync(join(typeDir, 'loads/rebuild70/ApiCommonData')));
});
```

Add `existsSync` to the `node:fs` import.

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/validation-ops.test.js`
Expected: FAIL (`createToolResolver` is handed a path; `report.repos` is undefined).

- [ ] **Step 3: Implement**

In `shared/scripts/lib/validation-ops.js`, add `import { openVerifyWorkspace, openLoadWorkspace } from './validation-workspace.js';` and change:

```js
/**
 * Validates a merged proposal as origin/master has it, with the tools of its
 * verify workspace under the root the data loader named, plus buildFitness when
 * against names a ref. Writes the report under .curation/tmp/verify/ and,
 * unless post is false, posts it on the ticket for mark-ready. Returns { report, path, ticket }.
 */
export async function validateProposal({ git, ticket, repoPath, accession, workspace, refresh = false, rebuild = false, against = null, post = true, exec, validators }) {
```

Replace the `createToolResolver(workspace, { exec })` line with:

```js
  const tools = createToolResolver(openVerifyWorkspace({ root: workspace, datasetType: manifest.datasetType, accession, refresh, rebuild, exec }), { exec });
```

Add `repos: tools.repos(),` after `tools: tools.versions(),` in the report literal.

Replace `contentValidation` with:

```js
/** For load: validate({ proposalDir, manifest }) runs the content validators of the proposal's type in loads/<rebuild>/. */
export function contentValidation({ workspace, rebuildBranch, refresh = false, exec }) {
  const resolvers = new Map();
  const toolsFor = (datasetType) => {
    if (!resolvers.has(datasetType)) {
      resolvers.set(datasetType, createToolResolver(openLoadWorkspace({ root: workspace, datasetType, rebuildBranch, refresh, exec }), { exec }));
    }
    return resolvers.get(datasetType);
  };
  return async ({ proposalDir, manifest }) => {
    const validators = validatorsFor(manifest.datasetType);
    if (!validators.length) return [];
    if (!workspace) throw new Error(`--workspace is required for ${manifest.datasetType}: ask the data loader which validation workspace to use`);
    return runValidators(validators, { proposalDir, manifest, exec }, toolsFor(manifest.datasetType).resolveTool);
  };
}
```

- [ ] **Step 4: Update the scripts**

`shared/scripts/validate-proposal.js`: usage becomes
`'Usage: node validate-proposal.js --workspace <root> [--refresh] [--rebuild] [--against <ref>] [--no-post] <accession>'` (also in the header comment, where `<dir>` becomes `<root>`); add `refresh: { type: 'boolean', default: false }, rebuild: { type: 'boolean', default: false }` to `options`; pass `refresh: values.refresh, rebuild: values.rebuild` to `validateProposal`; after the `Tools:` line print

```js
  console.log(`Repos:   ${Object.entries(report.repos).map(([n, r]) => `${n} ${r.ref}@${r.sha.slice(0, 10)}`).join(', ') || 'none'}`);
```

`shared/scripts/load-proposal.js`: add `refresh: { type: 'boolean', default: false }` to `options`; add `[--refresh]` after `[--workspace <root>]` in both usage strings (header comment and `usage`), with `<dir>` renamed to `<root>`; change the validate argument to

```js
validate: contentValidation({ workspace: values.workspace, rebuildBranch, refresh: values.refresh })
```

- [ ] **Step 5: Run the full suite**

Run: `yarn test`
Expected: PASS, except markReady tests for bulk-rnaseq, which are fixed in Task 7. If anything else fails, fix it before moving on.

- [ ] **Step 6: Commit**

```bash
git add shared/scripts/lib/validation-ops.js shared/scripts/validate-proposal.js shared/scripts/load-proposal.js tests/validation-ops.test.js
git commit -m "Validate in per-proposal and per-rebuild workspaces; --refresh, --rebuild"
```

---

### Task 7: mark-ready removes the proposal workspace

**Files:**
- Modify: `shared/scripts/lib/verification-ops.js`, `shared/scripts/mark-ready.js`
- Test: `tests/validation-ops.test.js`

- [ ] **Step 1: Write the failing tests**

In `tests/validation-ops.test.js`, add near `reportFor`:

```js
/** A disposal that records its calls; refuse makes assertDisposable throw. */
const disposalStub = ({ refuse = false } = {}) => {
  const calls = [];
  return {
    calls,
    assertDisposable(type) { calls.push(['assert', type]); if (refuse) throw new Error('proposals/PRJNA000002 cannot be removed; push them'); },
    dispose(type) { calls.push(['dispose', type]); return '/ws/proposals/PRJNA000002'; }
  };
};
```

Then pass `workspace: disposalStub()` in every existing `markReady({ ... accession: 'PRJNA000002' ... })` call in this file:

```bash
sed -i "/markReady(/s/accession: 'PRJNA000002' })/accession: 'PRJNA000002', workspace: disposalStub() })/" tests/validation-ops.test.js
grep -n "markReady(" tests/validation-ops.test.js
```

Check every bulk-rnaseq `markReady(` call in the grep output now has `workspace:`, and fix any by hand. Then add:

```js
test('markReady needs the workspace for a validated type', async () => {
  const { git } = setupMerged();
  const ticket = stubTicket({ status: 'verifying', existingComments: [formatReportComment(reportFor(git, 'pass'))] });
  await assert.rejects(markReady({ git, ticket, accession: 'PRJNA000002' }), /--workspace is required for bulk-rnaseq: mark-ready removes the proposal's validation workspace/);
  assert.equal(setsStatus(ticket), false);
});

test('markReady refuses before any ticket change when the workspace holds work, and disposes of it after ready', async () => {
  const { git } = setupMerged();
  const comments = [formatReportComment(reportFor(git, 'pass'))];
  const refusing = stubTicket({ status: 'verifying', existingComments: comments });
  await assert.rejects(markReady({ git, ticket: refusing, accession: 'PRJNA000002', workspace: disposalStub({ refuse: true }) }), /cannot be removed; push them/);
  assert.equal(setsStatus(refusing), false);
  const ticket = stubTicket({ status: 'verifying', existingComments: comments });
  const disposal = disposalStub();
  const result = await markReady({ git, ticket, accession: 'PRJNA000002', workspace: disposal });
  assert.deepEqual(disposal.calls, [['assert', 'bulk-rnaseq'], ['dispose', 'bulk-rnaseq']]);
  assert.equal(result.disposed, '/ws/proposals/PRJNA000002');
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/validation-ops.test.js`
Expected: FAIL on the two new tests.

- [ ] **Step 3: Implement**

In `shared/scripts/lib/verification-ops.js`, replace `markReady` with:

```js
/**
 * Records that a person verified a merged proposal and sets the ticket `ready`,
 * the only status load accepts. For a dataset type with validators it needs a
 * current, non-failing report on the ticket, and its comment carries that
 * report's verdict, tools and the warnings the person accepted. workspace
 * (verifyWorkspaceDisposal) refuses before any ticket change while the
 * proposal's worktrees hold work, and removes them once ready.
 * Returns { ticket, status, notice, report, disposed }.
 */
export async function markReady({ git, ticket, accession, note, workspace }) {
  const { ticket: ref, manifest } = verifiableTicket(git, accession, 'it is not marked ready');
  const { status, notice } = resolveDraft(git, ticket, accession, await ticket.getStatus(ref), true, 'it is not marked ready');
  if (!UNVERIFIED_STATUSES.includes(status)) {
    throw new Error(`The ticket ${ref.url} is at "${ticket.statusOption(status)}"; only a ${quoteOptions(ticket, UNVERIFIED_STATUSES)} proposal can be marked ready`);
  }
  const validated = validatorsFor(manifest.datasetType).length > 0;
  if (validated && !workspace) {
    throw new Error(`--workspace is required for ${manifest.datasetType}: mark-ready removes the proposal's validation workspace (ask the data loader which one)`);
  }
  const report = validated ? await currentReport(git, ticket, ref, accession) : null;
  workspace?.assertDisposable(manifest.datasetType);
  const why = (note ?? '').trim();
  const comment = report ? verifiedComment(report, why) : why ? `Verified: ${why}` : null;
  if (comment) await ticket.commentOnce(ref, comment);
  await ticket.setStatus(ref, 'ready');
  const disposed = workspace ? workspace.dispose(manifest.datasetType) : null;
  return { ticket: ref, status: 'ready', notice, report, disposed };
}
```

Replace `shared/scripts/mark-ready.js` `main` and header:

```js
#!/usr/bin/env node
/**
 * mark-ready.js - Records that a person verified a merged proposal: sets its
 * ticket to Ready to load, the only status load accepts, with an optional note,
 * then removes the proposal's validation workspace. Refuses first while a
 * worktree there holds uncommitted or unpushed work, unless --discard-changes.
 *
 * Usage: node mark-ready.js [--workspace <root>] [--discard-changes] <accession> ["<note>"]
 */
import { parseArgs } from 'node:util';
import { loadConfig } from './lib/config.js';
import { createGit } from './lib/git-ops.js';
import { createTicketClient } from './lib/ticket/index.js';
import { markReady } from './lib/verification-ops.js';
import { verifyWorkspaceDisposal } from './lib/validation-workspace.js';

const USAGE = 'Usage: node mark-ready.js [--workspace <root>] [--discard-changes] <accession> ["<note>"]';

async function main() {
  const { values, positionals } = parseArgs({
    options: { workspace: { type: 'string' }, 'discard-changes': { type: 'boolean', default: false } }, allowPositionals: true
  });
  const [accession, note] = positionals;
  if (!accession || positionals.length > 2) { console.error(USAGE); process.exit(1); }
  const config = loadConfig();
  const ticket = createTicketClient(config);
  const workspace = values.workspace ? verifyWorkspaceDisposal({ root: values.workspace, accession, discardChanges: values['discard-changes'] }) : undefined;
  const result = await markReady({ git: createGit(config.repoPath), ticket, accession, note, workspace });
  if (result.notice) console.error(`Note: ${result.notice}`);
  if (result.report) console.log(`Report: ${result.report.verdict} (${Object.entries(result.report.tools).map(([n, v]) => `${n} ${v}`).join(', ')})`);
  console.log(`Ticket: ${result.ticket.url} (${ticket.statusOption('ready')})`);
  if (result.disposed) console.log(`Removed: ${result.disposed}`);
}

main().catch(err => { console.error(`Error: ${err.message}`); process.exit(1); });
```

- [ ] **Step 4: Run the full suite**

Run: `yarn test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add shared/scripts/lib/verification-ops.js shared/scripts/mark-ready.js tests/validation-ops.test.js
git commit -m "mark-ready guards, then removes, the proposal's validation workspace"
```

---

### Task 8: Build start resets load workspaces

**Files:**
- Modify: `shared/scripts/start-build.js`

`resetLoadWorkspaces` is covered by Task 4; this is a thin CLI step.

- [ ] **Step 1: Implement**

In `shared/scripts/start-build.js`:
- import `import { resetLoadWorkspaces } from './lib/validation-workspace.js';`
- header comment: add the line `  reset-load-workspaces  remove every loads/<rebuild>/ under the validation root (--workspace)` and the usage `Usage: node start-build.js --rebuild-branch rebuildRR --build NN [--workspace <root>] <step>`
- `USAGE` becomes `'Usage: node start-build.js --rebuild-branch rebuildRR --build NN [--workspace <root>] sync-contacts|merge-back|clean-proposals|reset-load-workspaces'`
- add `workspace: { type: 'string' }` to `options`
- before the final `else`:

```js
  } else if (step === 'reset-load-workspaces') {
    if (!values.workspace) { console.error(`--workspace is required: ask the data loader which validation workspace to use.\n${USAGE}`); process.exit(1); }
    const removed = resetLoadWorkspaces({ root: values.workspace });
    console.log(removed.length ? `Removed ${removed.join(' ')}` : 'No load workspaces to remove.');
```

Move `openWorkspace()`/`createGit` below the step check only if they fail outside a VEuPathDatasets checkout; they don't need to (start-build always runs from one), so leave them.

- [ ] **Step 2: Smoke-test the arguments**

Run: `node shared/scripts/start-build.js --rebuild-branch rebuild70 --build 70 reset-load-workspaces; echo "exit $?"`
Expected: `--workspace is required: ...` and `exit 1` (run from a VEuPathDatasets checkout, or expect the `openWorkspace` error first, which is also fine).

- [ ] **Step 3: Commit**

```bash
git add shared/scripts/start-build.js
git commit -m "start-build: reset-load-workspaces step"
```

---

### Task 9: Skill docs

**Files:**
- Modify: `skills/verify-bulk-rnaseq/SKILL.md`, `skills/load-proposals/SKILL.md`, `skills/load-proposals/resources/preconditions.md` (only if it says `validation-env.json`)

These SKILL.md files are not synced from `shared/`; edit them directly.

- [ ] **Step 1: verify-bulk-rnaseq SKILL.md**

Replace the "Ask the data loader for the validation workspace" paragraph with:

```markdown
**Ask the data loader for the validation workspace root.** It holds one
directory per dataset type (`rnaseq-validation/` for this skill), each with an
`env.json` (repos with url and ref, executables, build commands), base clones
in `repos/`, and `proposals/<ACCESSION>/`: a git worktree per repo on branch
`verify/<ACCESSION>` plus that proposal's `build/`. The scripts create and
reuse these; never guess the root, search for it, or reuse one from an earlier
conversation without asking.
```

Step 2's command becomes `node scripts/validate-proposal.js --workspace <root> <ACCESSION>`, followed by:

```markdown
The first run for a proposal fetches each repo and builds; later runs reuse
that code as is, so a fix made in a worktree survives. After editing code in
`proposals/<ACCESSION>/<repo>/`, add `--rebuild`. To move to the latest code
on each repo's ref, add `--refresh` (refused while a worktree holds
uncommitted or unpushed work). The report records each repo's ref and commit.
```

Step 4's mark-ready line becomes `node scripts/mark-ready.js --workspace <root> <ACCESSION> "<what was checked>"`, and add after its paragraph:

```markdown
mark-ready then removes `proposals/<ACCESSION>/`. It refuses first, before
touching the ticket, while a worktree has uncommitted changes or commits on no
remote branch: push them (`verify/<ACCESSION>`) and open a PR on that repo, or,
only when the user says the changes are disposable, pass `--discard-changes`.
request-revision keeps the workspace for the next round.
```

In Rules, add: `- Never push to tool repos on the user's behalf; tell them what is unpushed.`

- [ ] **Step 2: load-proposals SKILL.md**

- Line 58's bullet becomes: `- The **validation workspace root** `<root>` (ask the data loader; never guess). Load re-runs the content validators in `<type>-validation/loads/rebuild<RR>/`, worktrees of each repo at `rebuild<RR>` (repos marked `followsRebuild`) or their pinned ref, shared by every load in the rebuild, and refuses on any error. Add `--refresh` when a tool fix lands mid-build.`
- Every `--workspace <dir>` becomes `--workspace <root>`.
- Build start: add after the three commands
  ```bash
  node scripts/start-build.js --rebuild-branch rebuild<RR> --build <NN> --workspace <root> reset-load-workspaces
  ```
  with the bullet: ``- `reset-load-workspaces` removes every `loads/rebuild*/` so this build's loads validate against fresh code. Run it after `merge-back` merges; it opens no PR.``
- Scripts list: `scripts/start-build.js` entry gains `, reset-load-workspaces`.

- [ ] **Step 3: Check for leftovers**

Run: `grep -rn "validation-env.json\|--workspace <dir>" skills shared docs/development.md`
Expected: no hits outside `docs/superpowers/`. Fix any.

- [ ] **Step 4: Run the suite and commit**

```bash
yarn test
git add skills shared
git commit -m "Skill docs: validation workspace root, layout and flags"
```

---

### Task 10: Migrate John's workspace (with John)

Not code. Do it with John in the session, never unattended.

- [ ] **Step 1:** Ask John for the root path (e.g. `/home/jbrestel/dataset-validation-workspaces`) and for the repo URLs and refs: ApiCommonData (`followsRebuild: true`), study.wrangler (tag), and the build commands that install ApiCommonData into `$BUILD_DIR` (`bin/`, `lib/perl/ApiCommonData/Load/*.pm`) and study.wrangler into `$BUILD_DIR/lib/R`.
- [ ] **Step 2:** Draft `<root>/rnaseq-validation/env.json`, show it to John, write it only after he approves.
- [ ] **Step 3:** Run `node skills/verify-bulk-rnaseq/scripts/validate-proposal.js --workspace <root> --no-post PRJNA525426` from the VEuPathDatasets checkout and show John the verdict and the `Repos:` line. Expected: the depth failure only, as before.
- [ ] **Step 4:** Ask John whether to delete `/home/jbrestel/test_validation`. Do not delete it yourself without a yes.
