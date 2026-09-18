import { execFileSync } from 'node:child_process';
import { STATUSES } from './statuses.js';

function defaultExec(cmd, args, opts) {
  return execFileSync(cmd, args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}

export function createGithubClient(cfg, { exec = defaultExec, env = process.env }) {
  for (const s of STATUSES) {
    if (cfg.labels?.[s] === undefined) throw new Error(`ticket.github.labels.${s} is required`);
  }
  const labelToStatus = Object.fromEntries(Object.entries(cfg.labels).map(([k, v]) => [v, k]));

  const gh = (...args) => {
    const cleanEnv = { ...env };
    delete cleanEnv.GITHUB_TOKEN;
    return exec('gh', [...args, '--repo', cfg.repo], { env: cleanEnv }).trim();
  };

  return {
    async create({ title, body }) {
      const out = gh('issue', 'create', '--title', title, '--body', body, '--label', cfg.labels.proposed);
      const url = out.split('\n').pop();
      const id = url.split('/').pop();
      if (!/^\d+$/.test(id)) throw new Error(`gh issue create did not return an issue URL:\n${out}`);
      return { system: 'github', id, url };
    },
    async comment(ref, body) {
      gh('issue', 'comment', ref.id, '--body', body);
    },
    async hasComment(ref, text) {
      return gh('issue', 'view', ref.id, '--json', 'comments', '--jq', '.comments[].body').includes(text);
    },
    async getStatus(ref) {
      const { labels } = JSON.parse(gh('issue', 'view', ref.id, '--json', 'labels'));
      const matched = labels.map(l => l.name).filter(name => labelToStatus[name]);
      if (matched.length === 0) {
        throw new Error(`Issue #${ref.id} has none of the status labels ${Object.values(cfg.labels).join(', ')}`);
      }
      if (matched.length > 1) {
        throw new Error(`Issue #${ref.id} carries more than one status label: ${matched.join(', ')}`);
      }
      return labelToStatus[matched[0]];
    },
    async setStatus(ref, status) {
      const others = Object.entries(cfg.labels).filter(([k]) => k !== status).map(([, v]) => v);
      const args = ['issue', 'edit', ref.id, '--add-label', cfg.labels[status]];
      for (const l of others) args.push('--remove-label', l);
      gh(...args);
    }
  };
}
