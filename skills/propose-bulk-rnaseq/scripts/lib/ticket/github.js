import { execFileSync } from 'node:child_process';
import { STATUSES } from './statuses.js';

function defaultExec(cmd, args, opts) {
  return execFileSync(cmd, args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function validateConfig(cfg) {
  // The milestone is the only record of the build.
  if (!cfg.milestone) throw new Error('ticket.github.milestone is required');
  if (!isPlainObject(cfg.typeLabels)) throw new Error('ticket.github.typeLabels is required: a map from dataset type to issue label');
  const project = cfg.project;
  if (!project) throw new Error('ticket.github.project is required: ticket status is its Status field');
  for (const k of ['owner', 'number', 'statusField']) {
    if (project[k] === undefined) throw new Error(`ticket.github.project.${k} is required`);
  }
  for (const s of STATUSES) {
    if (project.statusOptions?.[s] === undefined) throw new Error(`ticket.github.project.statusOptions.${s} is required`);
  }
}

const ISSUE_PROJECT_ITEMS = `query($owner: String!, $repo: String!, $number: Int!, $field: String!) {
  repository(owner: $owner, name: $repo) {
    issue(number: $number) {
      projectItems(first: 100) {
        nodes {
          project { number owner { ... on Organization { login } ... on User { login } } }
          fieldValueByName(name: $field) { ... on ProjectV2ItemFieldSingleSelectValue { name } }
        }
      }
    }
  }
}`;

export function createGithubClient(cfg, { exec = defaultExec, env = process.env }) {
  validateConfig(cfg);
  const project = cfg.project;
  const projectName = `${project.owner}/${project.number}`;
  const optionToStatus = Object.fromEntries(STATUSES.map(s => [project.statusOptions[s], s]));
  const [repoOwner, repoName] = cfg.repo.split('/');

  const cleanEnv = { ...env };
  delete cleanEnv.GITHUB_TOKEN;
  const ghRaw = (...args) => exec('gh', args, { env: cleanEnv }).trim();
  const gh = (...args) => ghRaw(...args, '--repo', cfg.repo);
  const issueUrl = (ref) => ref.url || `https://github.com/${cfg.repo}/issues/${ref.id}`;

  const milestoneFor = (build) => {
    if (build === undefined) return null;
    const title = cfg.milestone.replace('{build}', build);
    const titles = ghRaw('api', '--paginate', `repos/${cfg.repo}/milestones?state=all&per_page=100`, '--jq', '.[].title');
    if (!titles.split('\n').includes(title)) ghRaw('api', `repos/${cfg.repo}/milestones`, '-f', `title=${title}`);
    return title;
  };

  const typeLabelFor = (datasetType) => {
    const label = Object.hasOwn(cfg.typeLabels, datasetType) ? cfg.typeLabels[datasetType] : undefined;
    if (!label) {
      throw new Error(`No issue label for dataset type "${datasetType}"; add it to ticket.github.typeLabels (has ${Object.keys(cfg.typeLabels).join(', ') || 'none'})`);
    }
    return label;
  };

  // Created on first use, as build milestones are. GitHub label names are case-insensitive.
  const ensureLabel = (label) => {
    const names = ghRaw('api', '--paginate', `repos/${cfg.repo}/labels?per_page=100`, '--jq', '.[].name').split('\n');
    if (!names.some(n => n.toLowerCase() === label.toLowerCase())) gh('label', 'create', label);
  };

  const buildPattern = new RegExp(`^${cfg.milestone.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('\\{build\\}', '(\\d{2,})')}$`);

  // item-add is idempotent and answers with the item, so it doubles as the lookup.
  const setProjectStatus = (ref, status) => {
    const owner = ['--owner', project.owner, '--format', 'json'];
    const item = JSON.parse(ghRaw('project', 'item-add', String(project.number), ...owner, '--url', issueUrl(ref)));
    const projectId = JSON.parse(ghRaw('project', 'view', String(project.number), ...owner)).id;
    const field = JSON.parse(ghRaw('project', 'field-list', String(project.number), ...owner)).fields
      .find(f => f.name === project.statusField);
    const optionName = project.statusOptions[status];
    const option = field?.options?.find(o => o.name === optionName);
    if (!option) throw new Error(`project ${projectName} field "${project.statusField}" has no option "${optionName}"; add it to the field by hand`);
    ghRaw('project', 'item-edit', '--id', item.id, '--project-id', projectId,
      '--field-id', field.id, '--single-select-option-id', option.id);
  };

  return {
    async getBuild(ref) {
      const { milestone } = JSON.parse(gh('issue', 'view', ref.id, '--json', 'milestone'));
      const build = milestone?.title?.match(buildPattern)?.[1];
      if (!build) {
        const has = milestone?.title ? ` (it has "${milestone.title}")` : '';
        throw new Error(`Issue #${ref.id} has no "${cfg.milestone}" milestone${has}; set one to choose the build`);
      }
      return build;
    },
    statusOption(status) {
      return project.statusOptions[status];
    },
    checkDatasetType(datasetType) {
      typeLabelFor(datasetType);
    },
    async create({ title, body, build, datasetType }) {
      const label = typeLabelFor(datasetType);
      const milestone = milestoneFor(build);
      ensureLabel(label);
      const args = ['issue', 'create', '--title', title, '--body', body, '--label', label];
      if (milestone) args.push('--milestone', milestone);
      const out = gh(...args);
      const url = out.split('\n').pop();
      const id = url.split('/').pop();
      if (!/^\d+$/.test(id)) throw new Error(`gh issue create did not return an issue URL:\n${out}`);
      const ref = { system: 'github', id, url };
      try {
        setProjectStatus(ref, 'proposed');
      } catch (e) {
        // The issue exists: hand back its reference so the caller records it instead of filing another.
        throw Object.assign(
          new Error(`Issue ${url} was created but its Status could not be set to "${project.statusOptions.proposed}" in project ${projectName}: ${e.message}`),
          { ticket: ref });
      }
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
      const out = ghRaw('api', 'graphql', '-f', `query=${ISSUE_PROJECT_ITEMS}`,
        '-f', `owner=${repoOwner}`, '-f', `repo=${repoName}`, '-F', `number=${ref.id}`, '-f', `field=${project.statusField}`);
      let nodes;
      try { nodes = JSON.parse(out)?.data?.repository?.issue?.projectItems?.nodes; }
      catch { nodes = undefined; }
      if (!Array.isArray(nodes)) throw new Error(`Issue #${ref.id}: could not read its project items from gh api graphql:\n${out}`);
      const item = nodes.find(n => String(n?.project?.number) === String(project.number)
        && n?.project?.owner?.login?.toLowerCase() === String(project.owner).toLowerCase());
      if (!item) throw new Error(`Issue #${ref.id} is not in project ${projectName}; add it and set its ${project.statusField}`);
      const option = item.fieldValueByName?.name;
      if (!option) throw new Error(`Issue #${ref.id} has no ${project.statusField} in project ${projectName}`);
      const status = Object.hasOwn(optionToStatus, option) ? optionToStatus[option] : undefined;
      if (!status) {
        throw new Error(`Issue #${ref.id} has ${project.statusField} "${option}" in project ${projectName}; expected one of ${STATUSES.map(s => project.statusOptions[s]).join(', ')}`);
      }
      return status;
    },
    async setStatus(ref, status) {
      setProjectStatus(ref, status);
    }
  };
}
