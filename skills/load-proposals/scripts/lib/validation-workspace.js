import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname, delimiter } from 'node:path';
import { defaultExec, failureOutput } from './tools/exec.js';
import { readEnvJson, ASK } from './validation-env.js';
import { validationWorkspaceFor, validationWorkspaceNames } from '../dataset-types/validators.js';

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

/** Clones repo into base unless it is there; true when it just cloned. */
function baseClone(exec, base, repo) {
  if (existsSync(base)) return false;
  mkdirSync(dirname(base), { recursive: true });
  exec('git', ['clone', '-q', '--no-checkout', repo.url, base]);
  return true;
}

const fetchAll = (exec, base) => git(exec, base, ['fetch', '-q', '--force', '--prune', '--tags', 'origin']);

const SHA = /^[0-9a-f]{7,40}$/;
const verified = (exec, base, rev) => tryGit(exec, base, ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`]);

function commitOf(exec, base, ref, { branchOnly = false } = {}) {
  const sha = verified(exec, base, `refs/remotes/origin/${ref}`)
    ?? (branchOnly ? null : verified(exec, base, `refs/tags/${ref}`) ?? (SHA.test(ref) ? verified(exec, base, ref) : null));
  if (!sha) throw new Error(`${base} has no ${branchOnly ? 'branch' : 'branch, tag or commit'} "${ref}" on origin`);
  return sha;
}

function addWorktree(exec, base, wt, args, { fetch = true } = {}) {
  if (fetch) fetchAll(exec, base);
  git(exec, base, ['worktree', 'prune']);
  git(exec, base, ['worktree', 'add', '-q', ...args(wt)]);
}

/** What removing or moving a worktree would lose: uncommitted changes, commits on no remote branch or tag. */
export function pendingChanges(exec, worktree) {
  const lost = [];
  if (git(exec, worktree, ['status', '--porcelain'])) lost.push('uncommitted changes');
  const unpushed = git(exec, worktree, ['rev-list', '--count', 'HEAD', '--not', '--remotes', '--tags']);
  if (unpushed !== '0') lost.push(`${unpushed} commit(s) on no remote branch or tag`);
  return lost;
}

const worktreesIn = (dir) => existsSync(dir) ? readdirSync(dir).filter((e) => existsSync(join(dir, e, '.git'))) : [];

function assertNothingPending(exec, dir, action, hint) {
  const pending = worktreesIn(dir).map((n) => [n, pendingChanges(exec, join(dir, n))]).filter(([, p]) => p.length);
  if (pending.length) throw new Error(`${dir} cannot be ${action}; ${hint}:\n${pending.map(([n, p]) => `  - ${n} (${join(dir, n)}): ${p.join(', ')}`).join('\n')}`);
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
 * moved one, which voids the finished build at once), then builds when anything
 * changed, rebuild is set or no build finished. Returns the handle, or { error }.
 */
function prepare(exec, t, dir, { refOf, place, rebuild = false }) {
  try {
    mkdirSync(dir, { recursive: true });
    const repos = {};
    let changed = false;
    for (const [name, repo] of Object.entries(t.env.repos)) {
      const base = join(t.typeDir, 'repos', name);
      const wt = join(dir, name);
      try {
        if (place(repo, base, wt, baseClone(exec, base, repo))) {
          rmSync(join(dir, BUILD, BUILT), { force: true });
          changed = true;
        }
        repos[name] = { path: wt, ref: refOf(repo), sha: git(exec, wt, ['rev-parse', 'HEAD']) };
      } catch (e) {
        throw new Error(`${name} (${base}): ${failureOutput(e)}`);
      }
    }
    if (changed || rebuild || !existsSync(join(dir, BUILD, BUILT))) runBuild(exec, dir, t.env.build ?? []);
    const buildDir = join(dir, BUILD);
    return { dir, buildDir, repos, executables: t.env.executables, env: toolEnv(buildDir) };
  } catch (e) {
    return { error: failureOutput(e) };
  }
}

const badAccession = (a) => typeof a !== 'string' || !a || /[/\\]/.test(a) || a === '.' || a === '..';

/**
 * proposals/<accession>/: made from freshly fetched refs on first use and
 * reused as is after, so in-progress fixes survive. refresh moves clean
 * worktrees to the current refs (refusing otherwise); rebuild reruns the build.
 */
export function openVerifyWorkspace({ root, datasetType, accession, refresh = false, rebuild = false, exec = defaultExec }) {
  const t = openTypeDir(root, datasetType);
  if (t.error) return t;
  if (badAccession(accession)) return { error: `accession "${accession}" must be a plain directory name` };
  const dir = join(t.typeDir, 'proposals', accession);
  if (refresh) assertNothingPending(exec, dir, 'refreshed', 'push or discard them first');
  const branch = verifyBranch(accession);
  return prepare(exec, t, dir, {
    rebuild,
    refOf: (repo) => repo.ref,
    place: (repo, base, wt, cloned) => {
      if (!existsSync(wt)) {
        addWorktree(exec, base, wt, (path) => ['-b', branch, path, commitOf(exec, base, repo.ref)], { fetch: !cloned });
        return true;
      }
      if (!refresh) return false;
      if (!cloned) fetchAll(exec, base);
      git(exec, wt, ['checkout', '-q', '-B', branch, commitOf(exec, base, repo.ref)]);
      return true;
    }
  });
}

const REBUILD_BRANCH = /^rebuild\d+$/;
const LOAD_HINT = 'nobody should edit a load workspace; inspect it';

/** Removes each worktree under dir from its base clone (and branch, when named), then dir. False when dir is absent. */
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

/**
 * loads/<rebuild>/: detached worktrees shared by every load in that rebuild,
 * fetched once. followsRebuild repos check out origin/<rebuild>, others their ref.
 * refresh recreates it, refusing if a worktree was edited.
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
    place: (repo, base, wt, cloned) => {
      if (existsSync(wt)) return false;
      const commit = (path) => ['--detach', path, commitOf(exec, base, refOf(repo), { branchOnly: Boolean(repo.followsRebuild) })];
      addWorktree(exec, base, wt, commit, { fetch: !cloned });
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
    if (badAccession(accession)) throw new Error(`accession "${accession}" must be a plain directory name`);
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
