/** Fixtures and stubs shared by the proposal and load operation tests. */
import { mkdtempSync, mkdirSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

export const fixtures = new URL('./fixtures/', import.meta.url).pathname;

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
export function stubTicket({ status = 'proposed', statuses = {}, failCreates = 0, failProjectOnCreates = 0, existingComments = [], build = '02', builds = {}, unlabelledTypes = [] } = {}) {
  const calls = [];
  const notes = [...existingComments];
  let creates = 0;
  const client = {
    calls,
    notes,
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
    async getStatus(ref) { calls.push(['getStatus', ref.id]); return ref.id in statuses ? statuses[ref.id] : status; },
    async setStatus(ref, s) { calls.push(['setStatus', ref.id, s]); statuses[ref.id] = s; },
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
 * Stubs gh: auth status passes, pr list --state merged answers `merged`, pr create returns a URL (optionally throwing
 * the first time *after* the PR exists), pr list reports it once it exists.
 * Everything else runs for real, so git still talks to the fixture repo.
 */
export function stubGh({ failCreates = 0, url = 'https://github.com/VEuPathDB/VEuPathDatasets/pull/7', merged = null } = {}) {
  const calls = [];
  let creates = 0;
  let prUrl = null;
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
      return merged ? JSON.stringify([merged]) : '[]';
    }
    if (args[0] === 'pr' && args[1] === 'list') {
      return prUrl ? `${prUrl}\n` : '';
    }
    throw new Error(`unexpected gh call: ${args.join(' ')}`);
  };
  return { exec, calls, creates: () => calls.filter(a => a[0] === 'pr' && a[1] === 'create').length };
}
