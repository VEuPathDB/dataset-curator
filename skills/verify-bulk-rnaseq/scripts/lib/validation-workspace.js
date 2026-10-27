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
