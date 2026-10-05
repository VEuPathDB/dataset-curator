/** Fixtures and stubs shared by the proposal and load operation tests. */
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { deriveArtifacts } from '../shared/scripts/dataset-types/bulk-rnaseq.js';

export const fixtures = new URL('./fixtures/', import.meta.url).pathname;

/** A v4 organisms array of loaded organisms in project. */
export const loadedIn = (project, ...abbrevs) => abbrevs.map((proposedOrganismAbbrev) => ({ proposedOrganismAbbrev, source: 'loaded', project }));

/** A v4 organisms array of loaded FungiDB organisms. */
export const loaded = (...abbrevs) => loadedIn('FungiDB', ...abbrevs);

/**
 * Re-aims an RNA-seq proposal directory at organisms ([{ abbrev, project }]),
 * tags each sample with membership[sampleId], and re-derives its curated artifacts.
 */
export function alignTo(proposalDir, organisms, membership) {
  const manifestPath = join(proposalDir, 'manifest.json');
  const m = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  const entries = organisms.map(({ abbrev, project = 'FungiDB' }) => ({ proposedOrganismAbbrev: abbrev, source: 'loaded', project }));
  writeFileSync(manifestPath, JSON.stringify({ ...m, organisms: entries }, null, 2) + '\n');
  const annotationsPath = join(proposalDir, 'curated', `${m.accession}_sample_annotations.json`);
  const a = JSON.parse(readFileSync(annotationsPath, 'utf-8'));
  writeFileSync(annotationsPath, JSON.stringify({ ...a, samples: a.samples.map((s) => ({ ...s, organisms: membership[s.sampleId] })) }, null, 2) + '\n');
  for (const o of m.organisms) rmSync(join(proposalDir, 'curated', o.proposedOrganismAbbrev), { recursive: true, force: true });
  for (const [f, text] of Object.entries(deriveArtifacts(proposalDir))) {
    mkdirSync(dirname(join(proposalDir, 'curated', f)), { recursive: true });
    writeFileSync(join(proposalDir, 'curated', f), text);
  }
}

/** Bare "origin" plus a clone that looks like VEuPathDatasets: master with allContacts.xml. */
export function initRepo(prefix = 'dataset-curator-') {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const bare = join(root, 'origin.git');
  const repo = join(root, 'VEuPathDatasets');
  execFileSync('git', ['init', '--bare', '-q', '--initial-branch=master', bare]);
  execFileSync('git', ['clone', '-q', bare, repo]);
  execFileSync('git', ['-C', repo, 'config', 'user.email', 'someone@apidb.org']);
  execFileSync('git', ['-C', repo, 'config', 'user.name', 'Some One']);
  mkdirSync(join(repo, 'Model/lib/xml/datasetPresenters/contacts'), { recursive: true });
  cpSync(join(fixtures, 'allContacts.xml'), join(repo, 'Model/lib/xml/datasetPresenters/contacts/allContacts.xml'));
  mkdirSync(join(repo, 'Model/lib/xml/datasetClass'), { recursive: true });
  cpSync(join(fixtures, 'classes.xml'), join(repo, 'Model/lib/xml/datasetClass/classes.xml'));
  mkdirSync(join(repo, 'Datasets/lib/xml/datasets/FungiDB'), { recursive: true });
  cpSync(join(fixtures, 'tfakST1.xml'), join(repo, 'Datasets/lib/xml/datasets/FungiDB/tfakST1.xml'));
  execFileSync('git', ['-C', repo, 'add', '.']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init']);
  execFileSync('git', ['-C', repo, 'push', '-q', '-u', 'origin', 'master']);
  return { root, repo, bare };
}

/** A second clone of the same origin, for simulating someone else's pushes. */
export function otherClone(root, bare, branch = 'master') {
  const other = join(root, `other-${Math.random().toString(36).slice(2)}`);
  execFileSync('git', ['clone', '-q', '-b', branch, bare, other]);
  execFileSync('git', ['-C', other, 'config', 'user.email', 'other@apidb.org']);
  execFileSync('git', ['-C', other, 'config', 'user.name', 'Other One']);
  return other;
}

/**
 * A ticket client that records its calls. Notes are matched whole, as the
 * real backends match them, so commentOnce is exercised honestly.
 */
/** A status given as an Error is thrown by getStatus. checkProject is counted, not recorded in calls. */
export function stubTicket({ status = 'proposed', statuses = {}, failCreates = 0, failProjectOnCreates = 0, existingComments = [], build = '02', builds = {}, unlabelledTypes = [], projectError = null, closed = [] } = {}) {
  const calls = [];
  const notes = [...existingComments];
  let creates = 0;
  const client = {
    calls,
    notes,
    projectChecks: 0,
    checkProject() {
      client.projectChecks++;
      if (projectError) throw new Error(projectError);
    },
    created: () => calls.filter(c => c[0] === 'created').length,
    comments: () => calls.filter(c => c[0] === 'comment').length,
    async create({ title, body, build, datasetType }) {
      calls.push(['create', title, body, build, datasetType]);
      if (++creates <= failCreates) throw new Error('ticket system unavailable');
      calls.push(['created', title, body]);
      const ref = { system: 'github', id: '42', url: 'https://r/issues/42' };
      if (creates <= failCreates + failProjectOnCreates) {
        throw Object.assign(new Error(`Issue ${ref.url} was created but its Status could not be set`), { ticket: ref });
      }
      return ref;
    },
    mention: (ref) => ref.url,
    async comment(ref, body) { calls.push(['comment', ref.id, body]); notes.push(body); },
    async hasComment(ref, text) { return notes.some(n => n.trim() === text.trim()); },
    async commentOnce(ref, body) {
      if (await client.hasComment(ref, body)) return false;
      await client.comment(ref, body);
      return true;
    },
    async getStatus(ref) {
      calls.push(['getStatus', ref.id]);
      const s = ref.id in statuses ? statuses[ref.id] : status;
      if (s instanceof Error) throw s;
      return s;
    },
    async setStatus(ref, s) { calls.push(['setStatus', ref.id, s]); statuses[ref.id] = s; },
    async assign(ref) { calls.push(['assign', ref.id]); },
    async isOpen(ref) { calls.push(['isOpen', ref.id]); return !closed.includes(ref.id); },
    statusOption: (s) => ({ draft: 'Initial draft', proposed: 'Proposed', verifying: 'Verification in progress', ready: 'Ready to load', revision: 'Needs revision', loading: 'Loading in progress', qa: 'Post Load QA', finalqa: 'Final QA', done: 'Done' })[s],
    checkDatasetType(datasetType) {
      if (unlabelledTypes.includes(datasetType)) throw new Error(`No issue label for dataset type "${datasetType}"`);
    },
    async getBuild(ref) {
      calls.push(['getBuild', ref.id]);
      const b = ref.id in builds ? builds[ref.id] : build;
      if (b === null) throw new Error(`Issue #${ref.id} has no "Build {build}" milestone; set one to choose the build`);
      return b;
    }
  };
  return client;
}

/**
 * Stubs gh: auth status passes, pr list --state merged answers `merged`, pr merge closes the open PR into
 * master (or throws mergeError), pr create returns a URL (optionally throwing
 * the first time *after* the PR exists), pr list reports it once it exists.
 * Everything else runs for real, so git still talks to the fixture repo.
 */
export function stubGh({ failCreates = 0, url = 'https://github.com/VEuPathDB/VEuPathDatasets/pull/7', merged = null, openPr = null, failOpenLookup = false, failMergedLookup = false, mergeError = null, mergeQueued = false, openBase = 'master', openHead = null } = {}) {
  const calls = [];
  let creates = 0;
  let prUrl = openPr;
  const mergedPrs = merged ? [].concat(merged) : [];
  // The head of the open PR is origin/<branch> in the repository gh runs in, as GitHub would report it.
  const headOf = (args, opts) => {
    if (openHead) return openHead;
    const branch = args.includes('--head') ? args[args.indexOf('--head') + 1] : args[2];
    try { return execFileSync('git', ['-C', opts.cwd, 'rev-parse', `refs/remotes/origin/${branch}`], { encoding: 'utf-8' }).trim(); }
    catch { return '0'.repeat(40); }
  };
  const openEntry = (args, opts) => ({ url: prUrl, number: Number(prUrl.split('/').pop()), baseRefName: openBase, headRefOid: headOf(args, opts) });
  const exec = (cmd, args, opts) => {
    if (cmd !== 'gh') return execFileSync(cmd, args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    calls.push(args);
    if (args[0] === 'auth') return '';
    if (args[0] === 'pr' && args[1] === 'create') {
      prUrl = url;
      if (++creates <= failCreates) throw new Error('gh: the PR was opened but the response was lost');
      return `${url}\n`;
    }
    if (args[0] === 'pr' && args[1] === 'list' && args.includes('merged')) {
      if (failMergedLookup) throw new Error('gh: HTTP 503');
      return JSON.stringify(mergedPrs);
    }
    if (args[0] === 'pr' && args[1] === 'merge') {
      if (mergeError) throw new Error(mergeError);
      if (mergeQueued) return '';
      mergedPrs.unshift({ ...openEntry(args, opts), baseRefName: 'master' });
      prUrl = null;
      return '';
    }
    if (args[0] === 'pr' && args[1] === 'list' && !args.includes('--jq')) {
      if (failOpenLookup) throw new Error('gh: HTTP 502');
      return JSON.stringify(prUrl ? [openEntry(args, opts)] : []);
    }
    if (args[0] === 'pr' && args[1] === 'list') {
      return prUrl ? `${prUrl}\n` : '';
    }
    throw new Error(`unexpected gh call: ${args.join(' ')}`);
  };
  return { exec, calls, creates: () => calls.filter(a => a[0] === 'pr' && a[1] === 'create').length };
}
