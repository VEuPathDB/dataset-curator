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

/** Merges the sync PR of build into rebuild02 as GitHub would, leaving the checkout on rebuild02. */
const mergeSync = (repo, build) => {
  git_(repo, 'checkout', '-q', 'rebuild02');
  git_(repo, 'merge', '-q', '--no-edit', `origin/sync-contacts/rebuild02-build-${build}`);
  git_(repo, 'push', '-q');
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
  const result = await syncContacts({ git: createGit(repo, { exec: gh.exec }), repoPath: repo, rebuildBranch: 'rebuild02', build: '74' });
  assert.equal(result.changed, true);
  assert.equal(git_(repo, 'rev-parse', `origin/sync-contacts/rebuild02-build-74:${CONTACTS_RELATIVE_PATH}`), git_(repo, 'rev-parse', `origin/master:${CONTACTS_RELATIVE_PATH}`));
  assert.deepEqual(pullRequestCreated(gh), { base: 'rebuild02', head: 'sync-contacts/rebuild02-build-74' });
});

test('syncContacts does nothing when the files already match', async (t) => {
  const { repo } = setup(t);
  git_(repo, 'checkout', 'origin/master', '--', CONTACTS_RELATIVE_PATH);
  commitAll(repo, 'already synced');
  const gh = stubGh();
  assert.deepEqual(await syncContacts({ git: createGit(repo, { exec: gh.exec }), repoPath: repo, rebuildBranch: 'rebuild02', build: '74' }), { changed: false });
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
  await syncContacts({ git: createGit(repo, { exec: gh.exec }), repoPath: repo, rebuildBranch: 'rebuild02', build: '74' });
  mergeSync(repo, '74');
  const opened = stubGh();
  await mergeBack({ git: createGit(repo, { exec: opened.exec }), rebuildBranch: 'rebuild02', build: '74' });
  assert.deepEqual(pullRequestCreated(opened), { base: 'master', head: 'rebuild02' });
  git_(repo, 'checkout', '-q', 'master');
  git_(repo, 'merge', '-q', '--no-edit', 'origin/rebuild02');
  assert.equal(git_(repo, 'rev-parse', `HEAD:${CONTACTS_RELATIVE_PATH}`), git_(repo, 'rev-parse', `origin/master:${CONTACTS_RELATIVE_PATH}`));
});

/** rebuild02 with a load, and master with proposals whose tickets are 41, 42 and 43; the checkout is on master. */
function setupProposals(t) {
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
  return { repo };
}

const mergeBackDone = (repo) => {
  git_(repo, 'merge', '-q', '--no-edit', 'origin/rebuild02');
  git_(repo, 'push', '-q');
};

test('cleanProposals deletes earlier releases\' loaded proposals only, after the merge-back', async (t) => {
  const { repo } = setupProposals(t);
  const ticket = stubTicket({ builds: { 41: '73', 42: '73', 43: '74' }, statuses: { 41: 'qa', 42: 'ready', 43: 'done' } });
  const gh = stubGh();
  await assert.rejects(cleanProposals({ git: createGit(repo, { exec: gh.exec }), ticket, rebuildBranch: 'rebuild02', build: '74' }), /origin\/rebuild02 is not merged into origin\/master yet/);
  mergeBackDone(repo);
  const removed = [];
  const removeDelivery = (accessions) => {
    assert.ok(gh.calls.some((a) => a[0] === 'pr' && a[1] === 'create'), 'deliveries are removed only once the PR is open');
    removed.push(...accessions);
    return accessions.map((a) => `/ws/delivery/${a}`);
  };
  const result = await cleanProposals({ git: createGit(repo, { exec: gh.exec }), ticket, rebuildBranch: 'rebuild02', build: '74', removeDelivery });
  assert.deepEqual(result.removed, ['GCA_000001.1']);
  assert.deepEqual(removed, result.removed);
  assert.deepEqual(result.deliveries, ['/ws/delivery/GCA_000001.1']);
  const create = gh.calls.find((a) => a[0] === 'pr' && a[1] === 'create');
  assert.match(create[create.indexOf('--body') + 1], /fromProvider\/<accession>/);
  assert.deepEqual(result.kept, []);
  assert.equal(git_(repo, 'ls-tree', '--name-only', 'origin/clean-proposals/build-74', 'Proposals/'), 'Proposals/PRJNA000002\nProposals/PRJNA000003');
  assert.deepEqual(pullRequestCreated(gh), { base: 'master', head: 'clean-proposals/build-74' });
});

test('syncContacts runs again for the next build in the same clone', async (t) => {
  const { repo } = setup(t);
  const sync = (build) => syncContacts({ git: createGit(repo, { exec: stubGh().exec }), repoPath: repo, rebuildBranch: 'rebuild02', build });
  await sync('74');
  mergeSync(repo, '74');
  git_(repo, 'checkout', '-q', 'master');
  git_(repo, 'pull', '-q');
  addContact(repo, 'next.build.person');
  commitAll(repo, 'a contact for the next build');
  git_(repo, 'checkout', '-q', 'rebuild02');
  const result = await sync('75');
  assert.equal(result.changed, true);
  assert.equal(git_(repo, 'rev-parse', `origin/sync-contacts/rebuild02-build-75:${CONTACTS_RELATIVE_PATH}`), git_(repo, 'rev-parse', `origin/master:${CONTACTS_RELATIVE_PATH}`));
});

test('syncContacts refuses a leftover branch with no open PR, naming the delete command', async (t) => {
  const { repo } = setup(t);
  const branch = 'sync-contacts/rebuild02-build-74';
  const sync = () => syncContacts({ git: createGit(repo, { exec: stubGh().exec }), repoPath: repo, rebuildBranch: 'rebuild02', build: '74' });
  git_(repo, 'branch', branch);
  await assert.rejects(sync(), (err) => err.message.includes(`Branch ${branch} already exists`) && err.message.includes(`git -C '${repo}' branch -D ${branch}`));
  git_(repo, 'push', '-q', 'origin', branch);
  git_(repo, 'branch', '-D', branch);
  await assert.rejects(sync(), (err) => err.message.includes(`git -C '${repo}' push origin --delete ${branch}`));
});

test('syncContacts and cleanProposals require a numeric build', async (t) => {
  const { repo } = setup(t);
  const git = createGit(repo, { exec: stubGh().exec });
  await assert.rejects(syncContacts({ git, repoPath: repo, rebuildBranch: 'rebuild02' }), /build must be a build number/);
  await assert.rejects(cleanProposals({ git, ticket: stubTicket(), rebuildBranch: 'rebuild02', build: 'build-74' }), /build must be a build number/);
});

test('cleanProposals refuses a leftover branch with no open PR, naming the delete command', async (t) => {
  const { repo } = setupProposals(t);
  mergeBackDone(repo);
  const branch = 'clean-proposals/build-74';
  git_(repo, 'push', '-q', 'origin', `master:refs/heads/${branch}`);
  const ticket = stubTicket({ builds: { 41: '73' }, statuses: { 41: 'qa' } });
  const removeDelivery = () => assert.fail('removeDelivery must not be called without a PR');
  await assert.rejects(cleanProposals({ git: createGit(repo, { exec: stubGh().exec }), ticket, rebuildBranch: 'rebuild02', build: '74', removeDelivery }),
    (err) => err.message.includes(`git -C '${repo}' push origin --delete ${branch}`));
});

test('cleanProposals keeps and reports a proposal whose ticket cannot be read', async (t) => {
  const { repo } = setupProposals(t);
  mergeBackDone(repo);
  const ticket = stubTicket({ builds: { 41: '73', 42: '73', 43: '73' }, statuses: { 41: 'qa', 42: new Error('ticket 42 is unreachable'), 43: 'done' } });
  const gh = stubGh();
  const result = await cleanProposals({ git: createGit(repo, { exec: gh.exec }), ticket, rebuildBranch: 'rebuild02', build: '74' });
  assert.deepEqual(result.removed, ['GCA_000001.1', 'PRJNA000003']);
  assert.deepEqual(result.kept, [{ accession: 'PRJNA000002', message: 'ticket 42 is unreachable' }]);
  assert.equal(git_(repo, 'ls-tree', '--name-only', 'origin/clean-proposals/build-74', 'Proposals/'), 'Proposals/PRJNA000002');
});

test('cleanProposals removes no deliveries when no proposal is removed', async (t) => {
  const { repo } = setupProposals(t);
  mergeBackDone(repo);
  const ticket = stubTicket({ builds: { 41: '74', 42: '74', 43: '74' }, statuses: { 41: 'qa', 42: 'ready', 43: 'done' } });
  const removeDelivery = () => assert.fail('removeDelivery must not be called');
  const result = await cleanProposals({ git: createGit(repo, { exec: stubGh().exec }), ticket, rebuildBranch: 'rebuild02', build: '74', removeDelivery });
  assert.deepEqual(result.removed, []);
  assert.deepEqual(result.deliveries, []);
});
