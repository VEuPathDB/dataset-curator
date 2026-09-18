import { execFileSync } from 'node:child_process';

function defaultExec(cmd, args, opts) {
  return execFileSync(cmd, args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}

/**
 * Thin, explicit wrapper around git and gh for one repository.
 * exec is injectable so tests can stub gh without a network.
 */
export function createGit(repoPath, { exec = defaultExec } = {}) {
  const git = (...args) => exec('git', ['-C', repoPath, ...args], {}).trim();

  const envWithoutToken = () => {
    const env = { ...process.env };
    delete env.GITHUB_TOKEN;
    return env;
  };

  return {
    repoPath,
    currentBranch: () => git('branch', '--show-current'),
    isClean: () => git('status', '--porcelain') === '',
    fetch: () => { git('fetch', '--quiet', 'origin'); },
    isUpToDate: (branch) => git('rev-parse', 'HEAD') === git('rev-parse', `origin/${branch}`),
    branchExists: (name) => {
      try { git('rev-parse', '--verify', '--quiet', `refs/heads/${name}`); return true; }
      catch { return false; }
    },
    createBranch: (name, base) => { git('checkout', '--quiet', '-b', name, base); },
    checkout: (name) => { git('checkout', '--quiet', name); },
    add: (paths) => { git('add', '--', ...paths); },
    rm: (path) => { git('rm', '-r', '--quiet', '--', path); },
    commit: (message) => { git('commit', '--quiet', '-m', message); },
    amendNoEdit: () => { git('commit', '--quiet', '--amend', '--no-edit'); },
    push: (branch, { force = false } = {}) => {
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
      const out = git('log', '--format=%H', ref, '--', path);
      return out ? out.split('\n') : [];
    },
    cherryPick: (shas) => {
      try {
        git('cherry-pick', ...shas);
      } catch (err) {
        const files = git('diff', '--name-only', '--diff-filter=U');
        throw new Error(`Cherry-pick conflicts in:\n  ${files.split('\n').join('\n  ')}\nResolve or run: git -C ${repoPath} cherry-pick --abort`);
      }
    },
    abortCherryPick: () => { git('cherry-pick', '--abort'); },
    lsTree: (ref, dir) => {
      const out = git('ls-tree', '--name-only', ref, `${dir}/`);
      return out ? out.split('\n') : [];
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
