import { execFileSync } from 'node:child_process';

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

  return {
    repoPath,
    userEmail: () => {
      let email = '';
      try { email = git('config', 'user.email'); } catch { email = ''; }
      if (!email) {
        throw new Error(`git user.email is not set in ${repoPath}; run: git -C '${repoPath}' config user.email you@example.org`);
      }
      return email;
    },
    currentBranch: () => git('branch', '--show-current'),
    isClean: () => git('status', '--porcelain') === '',
    fetch: () => { git('fetch', '--quiet', 'origin'); },
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
    abortCherryPick: () => { git('cherry-pick', '--abort'); },
    checkGhAuth: () => {
      try { exec('gh', ['auth', 'status'], { cwd: repoPath, env: envWithoutToken() }); }
      catch { throw new Error('gh is not authenticated; run: gh auth login'); }
    },
    findPullRequest: (branch) => {
      let out;
      try { out = exec('gh', ['pr', 'view', branch, '--json', 'url', '--jq', '.url'], { cwd: repoPath, env: envWithoutToken() }); }
      catch { return null; }
      const url = (out || '').trim();
      return /^https?:\/\//.test(url) ? url : null;
    },
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
