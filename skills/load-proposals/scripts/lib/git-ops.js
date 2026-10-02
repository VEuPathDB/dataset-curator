import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

function defaultExec(cmd, args, opts) {
  return execFileSync(cmd, args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}

/**
 * Thin, explicit wrapper around git and gh for one repository.
 * exec is injectable so tests can stub gh without a network. env is injectable
 * too, and applies to both the git and gh calls (gh additionally has
 * GITHUB_TOKEN stripped).
 */
const PROTECTED = /^(master|rebuild\d+)$/;

export function createGit(repoPath, { exec = defaultExec, env = process.env } = {}) {
  const git = (...args) => exec('git', ['-C', repoPath, ...args], { env }).trim();

  const envWithoutToken = () => {
    const cleanEnv = { ...env };
    delete cleanEnv.GITHUB_TOKEN;
    return cleanEnv;
  };

  // git reports "nothing to commit" on stdout, which execFileSync hides in the
  // thrown error's stdout property rather than its message.
  const committing = (run) => {
    try { return run(); }
    catch (err) {
      const detail = [err.stdout, err.stderr].filter(Boolean).join('\n').trim();
      if (!detail) throw err;
      throw new Error(`git commit failed:\n${detail}`);
    }
  };

  const readPullRequests = (branch, state) => {
    const out = exec('gh', ['pr', 'list', '--head', branch, '--state', state, '--json', 'url,number,baseRefName,headRefOid'],
      { cwd: repoPath, env: envWithoutToken() });
    let prs;
    try { prs = JSON.parse(out); } catch (e) { throw new Error(`gh pr list returned no JSON: ${e.message}\n${out}`); }
    if (!Array.isArray(prs)) throw new Error(`gh pr list returned no JSON list:\n${out}`);
    return prs;
  };
  const asPullRequest = (pr) => {
    if (!/^https?:\/\//.test(pr?.url ?? '') || !/^[0-9a-f]{40}$/.test(pr.headRefOid ?? '') || !pr.baseRefName || !Number.isInteger(pr.number)) {
      throw new Error(`gh pr list returned an unexpected pull request: ${JSON.stringify(pr)}`);
    }
    return { url: pr.url, number: pr.number, base: pr.baseRefName, headOid: pr.headRefOid };
  };
  /** The open pull request from branch as { url, number, base, headOid }, or null; throws when gh fails. */
  const findOpenPullRequest = (branch) => {
    const prs = readPullRequests(branch, 'open');
    return prs.length ? asPullRequest(prs[0]) : null;
  };

  return {
    repoPath,
    findOpenPullRequest,
    userEmail: () => {
      let email = '';
      try { email = git('config', 'user.email'); } catch { email = ''; }
      if (!email) {
        throw new Error(`git user.email is not set in ${repoPath}; run: git -C '${repoPath}' config user.email you@example.org`);
      }
      return email;
    },
    currentBranch: () => git('branch', '--show-current'),
    /** Absolute, so a linked worktree's real git directory is found. */
    gitDir: () => git('rev-parse', '--absolute-git-dir'),
    isClean: () => git('status', '--porcelain') === '',
    // Pruning keeps remoteBranchExists honest after a branch is deleted on origin.
    fetch: () => { git('fetch', '--quiet', '--prune', 'origin'); },
    isUpToDate: (branch) => git('rev-parse', 'HEAD') === git('rev-parse', `origin/${branch}`),
    branchExists: (name) => {
      try { git('rev-parse', '--verify', '--quiet', `refs/heads/${name}`); return true; }
      catch { return false; }
    },
    remoteBranchExists: (name) => {
      try { git('rev-parse', '--verify', '--quiet', `refs/remotes/origin/${name}`); return true; }
      catch { return false; }
    },
    aheadOf: (base) => Number(git('rev-list', '--count', `${base}..HEAD`)),
    createBranch: (name, base) => { git('checkout', '--quiet', '-b', name, base); },
    checkout: (name) => { git('checkout', '--quiet', name); },
    add: (paths) => { git('add', '--', ...paths); },
    rm: (path) => { git('rm', '-r', '--quiet', '--', path); },
    commit: (message) => { committing(() => git('commit', '-m', message)); },
    amendNoEdit: () => { committing(() => git('commit', '--amend', '--no-edit')); },
    push: (branch, { force = false } = {}) => {
      if (PROTECTED.test(branch)) {
        throw new Error(`Refusing to push directly to ${branch}; skills only push proposal/* and load/* branches and open a PR`);
      }
      const args = ['push', '--quiet', '-u', 'origin', branch];
      if (force) args.push('--force-with-lease');
      git(...args);
    },
    fileExistsOnRef: (ref, path) => {
      try { git('cat-file', '-e', `${ref}:${path}`); return true; }
      catch { return false; }
    },
    showFile: (ref, path) => git('show', `${ref}:${path}`),
    /** Entry names directly under dir on ref; empty when dir is absent there. */
    listDir: (ref, dir) => {
      const out = git('ls-tree', '--name-only', ref, `${dir}/`);
      return out ? out.split('\n').map((p) => p.slice(dir.length + 1)) : [];
    },
    /**
     * Writes ref:path (a directory or a file) under destDir, keeping the path.
     * A tar through a temporary file avoids a shell pipe and leaves the
     * repository's index and working tree untouched.
     */
    exportTree: (ref, path, destDir) => {
      const archive = join(destDir, '.export.tar');
      try {
        git('archive', '--format=tar', `--output=${archive}`, ref, '--', path);
        exec('tar', ['-x', '-f', archive, '-C', destDir], { env });
      } finally {
        rmSync(archive, { force: true });
      }
    },
    /** ref may be a range, e.g. rebuild02..origin/master. Oldest first. */
    commitsForPath: (ref, path) => {
      const out = git('log', '--reverse', '--format=%H', ref, '--', path);
      return out ? out.split('\n') : [];
    },
    cherryPick: (shas) => {
      try {
        git('cherry-pick', ...shas);
      } catch (err) {
        let files = '';
        try { files = git('diff', '--name-only', '--diff-filter=U'); } catch {}
        if (!files) throw err;
        throw new Error(`Cherry-pick conflicts in:\n  ${files.split('\n').join('\n  ')}\nResolve or run: git -C '${repoPath}' cherry-pick --abort\n\n${err.message}`);
      }
    },
    checkGhAuth: () => {
      try { exec('gh', ['auth', 'status'], { cwd: repoPath, env: envWithoutToken() }); }
      catch { throw new Error('gh is not authenticated; run: gh auth login'); }
    },
    headSubject: () => git('log', '-1', '--format=%s'),
    // Only open pull requests: gh pr view falls back to a closed or merged one,
    // which would make the next proposal cycle reuse a dead pull request.
    // Lenient by default (a failed lookup reads as none); strict throws instead,
    // for callers that must not mistake a failed lookup for no pull request.
    findPullRequest: (branch, { strict = false } = {}) => {
      if (strict) return findOpenPullRequest(branch)?.url ?? null;
      let out;
      try {
        out = exec('gh', ['pr', 'list', '--head', branch, '--state', 'open', '--json', 'url', '--jq', '.[0].url'],
          { cwd: repoPath, env: envWithoutToken() });
      } catch { return null; }
      const url = (out || '').trim();
      return /^https?:\/\//.test(url) ? url : null;
    },
    /**
     * The pull request from branch merged into a base matching `base` (a rebuild
     * branch by default), optionally the one numbered `number`, as
     * { url, number, base, headOid }, or null.
     */
    findMergedPullRequest: (branch, { base = /^rebuild\d+$/, number } = {}) => {
      const pr = readPullRequests(branch, 'merged')
        .find(p => base.test(p?.baseRefName ?? '') && (number === undefined || p?.number === number));
      return pr ? asPullRequest(pr) : null;
    },
    hasCommit: (oid) => {
      try { git('cat-file', '-e', `${oid}^{commit}`); return true; }
      catch { return false; }
    },
    fetchPullHead: (number) => { git('fetch', '--quiet', 'origin', `refs/pull/${number}/head`); },
    // A merge commit; gh keeps the head branch unless --delete-branch is passed.
    mergePullRequest: (branch) => exec('gh', ['pr', 'merge', branch, '--merge'], { cwd: repoPath, env: envWithoutToken() }),
    openPullRequest: ({ base, head, title, body }) => {
      const out = exec('gh', [
        'pr', 'create', '--base', base, '--head', head, '--title', title, '--body', body
      ], { cwd: repoPath, env: envWithoutToken() });
      const url = out.trim().split('\n').pop();
      if (!/^https?:\/\//.test(url)) throw new Error(`gh pr create did not return a URL:\n${out}`);
      return url;
    }
  };
}
