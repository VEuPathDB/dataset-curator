import { execFileSync } from 'node:child_process';
import { STATUSES } from './statuses.js';

function defaultExec(cmd, args, opts) {
  return execFileSync(cmd, args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}

function validateProjectConfig(project) {
  if (!project) return;
  for (const k of ['owner', 'number', 'statusField']) {
    if (project[k] === undefined) throw new Error(`ticket.github.project.${k} is required`);
  }
  for (const s of STATUSES) {
    if (project.statusOptions?.[s] === undefined) throw new Error(`ticket.github.project.statusOptions.${s} is required`);
  }
}

export function createGithubClient(cfg, { exec = defaultExec, env = process.env, warn = (m) => console.error(m) }) {
  for (const s of STATUSES) {
    if (cfg.labels?.[s] === undefined) throw new Error(`ticket.github.labels.${s} is required`);
  }
  validateProjectConfig(cfg.project);
  const labelToStatus = Object.fromEntries(Object.entries(cfg.labels).map(([k, v]) => [v, k]));

  const cleanEnv = { ...env };
  delete cleanEnv.GITHUB_TOKEN;
  const ghRaw = (...args) => exec('gh', args, { env: cleanEnv }).trim();
  const gh = (...args) => ghRaw(...args, '--repo', cfg.repo);
  const issueUrl = (ref) => ref.url || `https://github.com/${cfg.repo}/issues/${ref.id}`;

  const milestoneFor = (build) => {
    if (!cfg.milestone || build === undefined) return null;
    const title = cfg.milestone.replace('{build}', build);
    const titles = ghRaw('api', '--paginate', `repos/${cfg.repo}/milestones?state=all&per_page=100`, '--jq', '.[].title');
    if (!titles.split('\n').includes(title)) ghRaw('api', `repos/${cfg.repo}/milestones`, '-f', `title=${title}`);
    return title;
  };

  // The project board only displays status; labels stay the source of truth,
  // so a failure here warns rather than leaving a half-recorded ticket.
  const mirrorToProject = (ref, status) => {
    const p = cfg.project;
    if (!p) return;
    try {
      const owner = ['--owner', p.owner, '--format', 'json'];
      const item = JSON.parse(ghRaw('project', 'item-add', String(p.number), ...owner, '--url', issueUrl(ref)));
      const projectId = JSON.parse(ghRaw('project', 'view', String(p.number), ...owner)).id;
      const field = JSON.parse(ghRaw('project', 'field-list', String(p.number), ...owner)).fields
        .find(f => f.name === p.statusField);
      const option = field?.options?.find(o => o.name === p.statusOptions[status]);
      if (!option) throw new Error(`project field "${p.statusField}" has no option "${p.statusOptions[status]}"`);
      ghRaw('project', 'item-edit', '--id', item.id, '--project-id', projectId,
        '--field-id', field.id, '--single-select-option-id', option.id);
    } catch (e) {
      warn(`Warning: issue #${ref.id} status "${status}" was not mirrored to project ${p.owner}/${p.number}: ${e.message}`);
    }
  };

  return {
    async create({ title, body, build }) {
      const milestone = milestoneFor(build);
      const args = ['issue', 'create', '--title', title, '--body', body, '--label', cfg.labels.proposed];
      if (milestone) args.push('--milestone', milestone);
      const out = gh(...args);
      const url = out.split('\n').pop();
      const id = url.split('/').pop();
      if (!/^\d+$/.test(id)) throw new Error(`gh issue create did not return an issue URL:\n${out}`);
      const ref = { system: 'github', id, url };
      mirrorToProject(ref, 'proposed');
      return ref;
    },
    // Qualified by repository so the reference resolves from a pull request in any repository.
    mention(ref) {
      return `${cfg.repo}#${ref.id}`;
    },
    async comment(ref, body) {
      gh('issue', 'comment', ref.id, '--body', body);
    },
    async hasComment(ref, text) {
      // Whole-body equality: a comment about pull/70 must not answer for pull/7.
      const out = gh('issue', 'view', ref.id, '--json', 'comments');
      let comments;
      try { comments = JSON.parse(out).comments; }
      catch (e) { throw new Error(`gh issue view ${ref.id} --json comments returned no JSON: ${e.message}`); }
      return (comments || []).some(c => typeof c?.body === 'string' && c.body.trim() === text.trim());
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
      mirrorToProject(ref, status);
    }
  };
}
