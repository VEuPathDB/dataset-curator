import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
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
  if (!root) return { error: `No validation workspace given; ${ASK} and pass --workspace <root>` };
  const name = validationWorkspaceFor(datasetType);
  if (!name) return { error: `datasetType "${datasetType}" has no validation workspace` };
  return { typeDir: join(resolve(root), name) };
}

const noTypeDir = (typeDir) => `${typeDir} does not exist; create it with an env.json (${ASK})`;

function openTypeDir(root, datasetType) {
  const t = typeDirOf(root, datasetType);
  if (t.error) return t;
  if (!existsSync(t.typeDir)) return { error: noTypeDir(t.typeDir) };
  const env = readEnvJson(t.typeDir);
  return env.error ? { error: env.error } : { typeDir: t.typeDir, env: env.values };
}

/** Tools run from the build: build/bin first on PATH; GUS_HOME, Perl and R libraries from the build only. */
export function toolEnv(buildDir, base = process.env) {
  return {
    ...base,
    PATH: [join(buildDir, 'bin'), base.PATH].filter(Boolean).join(delimiter),
    GUS_HOME: buildDir,
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

/** The refusal for dir, or null: one line per worktree with pending changes, then any extra lines. */
function pendingProblem(exec, dir, action, hint, extra = []) {
  const pending = worktreesIn(dir).map((n) => [n, pendingChanges(exec, join(dir, n))]).filter(([, p]) => p.length);
  const lines = [...pending.map(([n, p]) => `  - ${n} (${join(dir, n)}): ${p.join(', ')}`), ...extra];
  return lines.length ? `${dir} cannot be ${action}; ${hint}:\n${lines.join('\n')}` : null;
}

function assertNothingPending(exec, dir, action, hint, extra) {
  const problem = pendingProblem(exec, dir, action, hint, extra);
  if (problem) throw new Error(problem);
}

function runBuild(exec, dir, commands) {
  const buildDir = join(dir, BUILD);
  rmSync(buildDir, { recursive: true, force: true });
  mkdirSync(buildDir, { recursive: true });
  const env = { ...toolEnv(buildDir), BUILD_DIR: buildDir, PROPOSAL_DIR: dir, PROJECT_HOME: dir };
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
  const branch = verifyBranch(accession);
  if (refresh) assertNothingPending(exec, dir, 'refreshed', 'push or discard them first', unpushedBranchLines(exec, t.typeDir, dir, branch));
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
const loadHint = (dir) => `nobody should edit a load workspace; inspect it, then revert the change or delete ${dir} by hand`;

/** Removes each worktree under dir from its base clone, then dir. Callers check for pending work first. */
function removeWorktreeDir(exec, typeDir, dir, { discard = false } = {}) {
  for (const name of worktreesIn(dir)) {
    git(exec, join(typeDir, 'repos', name), ['worktree', 'remove', ...(discard ? ['--force'] : []), join(dir, name)]);
  }
  rmSync(dir, { recursive: true, force: true });
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
  if (refresh && existsSync(dir)) {
    assertNothingPending(exec, dir, 'refreshed', loadHint(dir));
    removeWorktreeDir(exec, t.typeDir, dir);
  }
  const refOf = (repo) => repo.followsRebuild ? rebuildBranch : repo.ref;
  return prepare(exec, t, dir, {
    refOf,
    place: (repo, base, wt, cloned) => {
      if (existsSync(wt)) return false;
      const detachedAtRef = (path) => ['--detach', path, commitOf(exec, base, refOf(repo), { branchOnly: Boolean(repo.followsRebuild) })];
      addWorktree(exec, base, wt, detachedAtRef, { fetch: !cloned });
      return true;
    }
  });
}

/** Base clones (by worktree name under dir) that hold branch: [{ name, base }]. */
const basesWithBranch = (exec, typeDir, dir, branch) => worktreesIn(dir)
  .map((name) => ({ name, base: join(typeDir, 'repos', name) }))
  .filter(({ base }) => tryGit(exec, base, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]));

/** Lines for branch commits on no remote branch or tag, skipping worktrees on branch (their HEAD check covers it). */
function unpushedBranchLines(exec, typeDir, dir, branch) {
  return basesWithBranch(exec, typeDir, dir, branch).flatMap(({ name, base }) => {
    if (tryGit(exec, join(dir, name), ['symbolic-ref', '-q', '--short', 'HEAD']) === branch) return [];
    const n = git(exec, base, ['rev-list', '--count', `refs/heads/${branch}`, '--not', '--remotes', '--tags']);
    return n === '0' ? [] : [`  - ${name} (${base}): ${branch} has ${n} commit(s) on no remote branch or tag`];
  });
}

/**
 * mark-ready's half of the verify lifecycle: where(datasetType) gives
 * { typeDir, dir }; assertDisposable(datasetType) refuses a missing type
 * directory, or a worktree or verify branch holding work that would be lost;
 * dispose(datasetType) removes proposals/<accession>/ and its verify branches,
 * returning the directory or null when there was none.
 */
export function verifyWorkspaceDisposal({ root, accession, discardChanges = false, exec = defaultExec }) {
  const branch = verifyBranch(accession);
  const where = (datasetType) => {
    if (badAccession(accession)) throw new Error(`accession "${accession}" must be a plain directory name`);
    const t = typeDirOf(root, datasetType);
    if (t.error) throw new Error(t.error);
    return { typeDir: t.typeDir, dir: join(t.typeDir, 'proposals', accession) };
  };
  const locate = (datasetType) => {
    const found = where(datasetType);
    return existsSync(found.dir) ? found : null;
  };
  const check = ({ typeDir, dir }) => {
    if (discardChanges) return;
    assertNothingPending(exec, dir, 'removed', 'push them, or pass --discard-changes', unpushedBranchLines(exec, typeDir, dir, branch));
  };
  return {
    where,
    assertDisposable(datasetType) {
      const { typeDir } = where(datasetType);
      if (!existsSync(typeDir)) throw new Error(noTypeDir(typeDir));
      const found = locate(datasetType);
      if (found) check(found);
    },
    dispose(datasetType) {
      const found = locate(datasetType);
      if (!found) return null;
      check(found);
      const bases = basesWithBranch(exec, found.typeDir, found.dir, branch);
      removeWorktreeDir(exec, found.typeDir, found.dir, { discard: discardChanges });
      for (const { base } of bases) git(exec, base, ['branch', '-q', '-D', branch]);
      return found.dir;
    }
  };
}

/**
 * Build start: removes loads/rebuild<RR>/ for every rebuild of every type under
 * root, or nothing when any was edited. Returns the directories removed.
 */
export function resetLoadWorkspaces({ root, exec = defaultExec }) {
  if (!root) throw new Error(`No validation workspace given; ${ASK} and pass --workspace <root>`);
  const found = [];
  for (const name of validationWorkspaceNames()) {
    const typeDir = join(resolve(root), name);
    const loads = join(typeDir, 'loads');
    if (!existsSync(loads)) continue;
    for (const entry of readdirSync(loads, { withFileTypes: true })) {
      if (entry.isDirectory() && REBUILD_BRANCH.test(entry.name)) found.push({ typeDir, dir: join(loads, entry.name) });
    }
  }
  const problems = found.map(({ dir }) => pendingProblem(exec, dir, 'removed', loadHint(dir))).filter(Boolean);
  if (problems.length) throw new Error(problems.join('\n'));
  for (const { typeDir, dir } of found) removeWorktreeDir(exec, typeDir, dir);
  return found.map(({ dir }) => dir);
}

export const DELIVERY_RECORD = 'delivery.json';

/** <type dir>/delivery/<accession>/ and the env.json hosts prepare-delivery needs; throws naming what is missing. */
export function openDeliveryDir({ root, datasetType, accession }) {
  if (badAccession(accession)) throw new Error(`accession "${accession}" must be a plain directory name`);
  const t = openTypeDir(root, datasetType);
  if (t.error) throw new Error(t.error);
  for (const key of ['staging', 'manualDelivery']) {
    if (!t.env[key]) throw new Error(`${join(t.typeDir, 'env.json')} has no "${key}"; ${ASK} and what ${key} host and root to use`);
  }
  return { typeDir: t.typeDir, dir: join(t.typeDir, 'delivery', accession), staging: t.env.staging, manualDelivery: t.env.manualDelivery };
}

/** mark-ready's view of a delivery: read(datasetType) gives { record, sha, dir } or null. */
export function deliveryReader({ root, accession }) {
  return {
    read(datasetType) {
      const t = typeDirOf(root, datasetType);
      if (t.error) throw new Error(t.error);
      const dir = join(t.typeDir, 'delivery', accession);
      const path = join(dir, DELIVERY_RECORD);
      if (!existsSync(path)) return null;
      const text = readFileSync(path, 'utf-8');
      return { record: JSON.parse(text), sha: createHash('sha256').update(text).digest('hex'), dir };
    }
  };
}

/**
 * Build start: removes delivery/<accession>/ and its staging cache for each
 * accession in every type under root. Refuses, removing nothing, while any has
 * a leftover .next or .old, which may hold a workspace/. Returns the directories removed.
 */
export function removeDeliveries({ root, accessions }) {
  if (!root) throw new Error(`No validation workspace given; ${ASK} and pass --workspace <root>`);
  const dirs = validationWorkspaceNames().flatMap((name) => accessions.map((a) => join(resolve(root), name, 'delivery', a)));
  for (const leftover of dirs.flatMap((dir) => [`${dir}.next`, `${dir}.old`])) {
    if (existsSync(leftover)) throw new Error(`${leftover} is left from an interrupted delivery and may hold a workspace/; move any workspace/ out of it by hand and remove it, then re-run`);
  }
  const removed = dirs.flatMap((dir) => [dir, `${dir}.staging`]).filter((d) => existsSync(d));
  for (const dir of removed) rmSync(dir, { recursive: true, force: true });
  return removed;
}
