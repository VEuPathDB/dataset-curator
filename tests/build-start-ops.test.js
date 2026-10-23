import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createGit } from '../shared/scripts/lib/git-ops.js';
import { syncContacts, mergeBack, cleanProposals } from '../shared/scripts/lib/build-start-ops.js';
import { CONTACTS_RELATIVE_PATH } from '../shared/scripts/lib/contacts.js';
import { fixtures, initRepo, stubTicket, stubGh } from './helpers.js';

const git_ = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf-8' }).trim();
const commitAll = (repo, message) => { git_(repo, 'add', '-A'); git_(repo, 'commit', '-q', '-m', message); git_(repo, 'push', '-q'); };
const addContact = (repo, id) => {
  const path = join(repo, CONTACTS_RELATIVE_PATH);
  writeFileSync(path, readFileSync(path, 'utf-8').replace('</contacts>', `  <contact>\n    <contactId>${id}</contactId>\n    <name>${id}</name>\n  </contact>\n</contacts>`));
};
const pullRequestCreated = (gh) => {
  const create = gh.calls.find((a) => a[0] === 'pr' && a[1] === 'create');
  return { base: create[create.indexOf('--base') + 1], head: create[create.indexOf('--head') + 1] };
};

/** master and rebuild02, with a contact added on master after the cut. */
function setup(t) {
  const { root, repo, bare } = initRepo('build-start-');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git_(repo, 'branch', 'rebuild02');
  git_(repo, 'push', '-q', '-u', 'origin', 'rebuild02');
  addContact(repo, 'later.person');
  commitAll(repo, 'a proposal adds a contact');
  git_(repo, 'checkout', '-q', 'rebuild02');
  return { root, repo, bare };
}

test('syncContacts opens a PR copying master\'s allContacts.xml byte for byte onto the rebuild branch', async (t) => {
  const { repo } = setup(t);
  const gh = stubGh();
  const result = await syncContacts({ git: createGit(repo, { exec: gh.exec }), repoPath: repo, rebuildBranch: 'rebuild02' });
  assert.equal(result.changed, true);
  assert.equal(git_(repo, 'rev-parse', `origin/sync-contacts/rebuild02:${CONTACTS_RELATIVE_PATH}`), git_(repo, 'rev-parse', `origin/master:${CONTACTS_RELATIVE_PATH}`));
  assert.deepEqual(pullRequestCreated(gh), { base: 'rebuild02', head: 'sync-contacts/rebuild02' });
});

test('syncContacts does nothing when the files already match', async (t) => {
  const { repo } = setup(t);
  git_(repo, 'checkout', 'origin/master', '--', CONTACTS_RELATIVE_PATH);
  commitAll(repo, 'already synced');
  const gh = stubGh();
  assert.deepEqual(await syncContacts({ git: createGit(repo, { exec: gh.exec }), repoPath: repo, rebuildBranch: 'rebuild02' }), { changed: false });
  assert.equal(gh.calls.length, 0);
});

test('mergeBack refuses while contacts differ, and after a sync merges without conflict', async (t) => {
  const { repo } = setup(t);
  git_(repo, 'checkout', 'origin/master', '--', CONTACTS_RELATIVE_PATH);
  commitAll(repo, 'a load copies master\'s contacts');
  git_(repo, 'checkout', '-q', 'master');
  addContact(repo, 'even.later.person');
  commitAll(repo, 'another proposal adds a contact');
  git_(repo, 'checkout', '-q', 'rebuild02');
  const gh = stubGh();
  await assert.rejects(mergeBack({ git: createGit(repo, { exec: gh.exec }), rebuildBranch: 'rebuild02', build: '74' }), /allContacts\.xml differs .* run start-build\.js sync-contacts first/);
  await syncContacts({ git: createGit(repo, { exec: gh.exec }), repoPath: repo, rebuildBranch: 'rebuild02' });
  git_(repo, 'checkout', '-q', 'rebuild02');
  git_(repo, 'merge', '-q', '--no-edit', 'origin/sync-contacts/rebuild02');
  git_(repo, 'push', '-q');
  const opened = stubGh();
  await mergeBack({ git: createGit(repo, { exec: opened.exec }), rebuildBranch: 'rebuild02', build: '74' });
  assert.deepEqual(pullRequestCreated(opened), { base: 'master', head: 'rebuild02' });
  git_(repo, 'checkout', '-q', 'master');
  git_(repo, 'merge', '-q', '--no-edit', 'origin/rebuild02');
  assert.equal(git_(repo, 'rev-parse', `HEAD:${CONTACTS_RELATIVE_PATH}`), git_(repo, 'rev-parse', `origin/master:${CONTACTS_RELATIVE_PATH}`));
});

test('cleanProposals deletes earlier releases\' loaded proposals only, after the merge-back', async (t) => {
  const { repo } = setup(t);
  writeFileSync(join(repo, 'NOTES'), 'a load on rebuild02\n');
  commitAll(repo, 'rebuild02 moves on');
  git_(repo, 'checkout', '-q', 'master');
  for (const acc of ['GCA_000001.1', 'PRJNA000002', 'PRJNA000003']) cpSync(join(fixtures, 'proposals', acc), join(repo, 'Proposals', acc), { recursive: true });
  const setTicket = (acc, id) => {
    const p = join(repo, 'Proposals', acc, 'manifest.json');
    writeFileSync(p, JSON.stringify({ ...JSON.parse(readFileSync(p, 'utf-8')), ticket: { system: 'github', id, url: `https://r/issues/${id}` } }, null, 2) + '\n');
  };
  setTicket('GCA_000001.1', '41'); setTicket('PRJNA000002', '42'); setTicket('PRJNA000003', '43');
  commitAll(repo, 'proposals');
  const ticket = stubTicket({ builds: { 41: '73', 42: '73', 43: '74' }, statuses: { 41: 'qa', 42: 'ready', 43: 'done' } });
  const gh = stubGh();
  await assert.rejects(cleanProposals({ git: createGit(repo, { exec: gh.exec }), ticket, rebuildBranch: 'rebuild02', build: '74' }), /origin\/rebuild02 is not merged into origin\/master yet/);
  git_(repo, 'merge', '-q', '--no-edit', 'origin/rebuild02');
  git_(repo, 'push', '-q');
  const result = await cleanProposals({ git: createGit(repo, { exec: gh.exec }), ticket, rebuildBranch: 'rebuild02', build: '74' });
  assert.deepEqual(result.removed, ['GCA_000001.1']);
  assert.deepEqual(result.kept, []);
  assert.equal(git_(repo, 'ls-tree', '--name-only', 'origin/clean-proposals/build-74', 'Proposals/'), 'Proposals/PRJNA000002\nProposals/PRJNA000003');
  assert.deepEqual(pullRequestCreated(gh), { base: 'master', head: 'clean-proposals/build-74' });
});
