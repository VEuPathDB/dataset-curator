import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, existsSync, readFileSync, cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createGit } from '../shared/scripts/lib/git-ops.js';
import { CONTACTS_RELATIVE_PATH } from '../shared/scripts/lib/contacts.js';
import { checkLoadPreconditions, loadProposal, listProposals, markLoaded } from '../shared/scripts/lib/load-ops.js';
import { deriveArtifacts } from '../shared/scripts/dataset-types/bulk-rnaseq.js';
import { fixtures, initRepo, otherClone, stubTicket, stubGh as ghStub, loaded } from './helpers.js';

// Only a verified (ready) proposal loads.
const tickets = (opts) => stubTicket({ status: 'ready', builds: { 43: '03' }, ...opts });

const setupRepo = () => {
  const { root, repo, bare } = initRepo('load-ops-');
  writeFileSync(join(repo, 'Model/lib/xml/datasetPresenters/FungiDB.xml'), '<?xml version="1.0"?>\n<datasetPresenters>\n</datasetPresenters>\n');
  cpSync(join(fixtures, 'proposals/GCA_000001.1'), join(repo, 'Proposals/GCA_000001.1'), { recursive: true });
  cpSync(join(fixtures, 'proposals/PRJNA000002'), join(repo, 'Proposals/PRJNA000002'), { recursive: true });
  setManifestFields(repo, 'GCA_000001.1', { ticket: { system: 'github', id: '41', url: 'https://r/issues/41' } });
  setManifestFields(repo, 'PRJNA000002', { ticket: { system: 'github', id: '43', url: 'https://r/issues/43' } });
  commitAll(repo, 'init with proposals');
  execFileSync('git', ['-C', repo, 'checkout', '-q', '-b', 'rebuild02']);
  execFileSync('git', ['-C', repo, 'push', '-q', '-u', 'origin', 'rebuild02']);
  return { root, repo, bare };
};

function setManifestFields(repo, accession, fields) {
  const path = join(repo, 'Proposals', accession, 'manifest.json');
  const m = JSON.parse(readFileSync(path, 'utf-8'));
  writeFileSync(path, JSON.stringify({ ...m, ...fields }, null, 2) + '\n');
}

/** Commits and pushes the current branch. */
function commitAll(repo, message) {
  execFileSync('git', ['-C', repo, 'add', '-A']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', message]);
  execFileSync('git', ['-C', repo, 'push', '-q']);
}

test('listProposals reads manifests on the current branch and filters by the ticket build', async () => {
  const { repo } = setupRepo();
  const all = await listProposals(repo, { ticket: tickets() });
  assert.deepEqual(all.proposals.map(p => [p.manifest.accession, p.build]).sort(), [['GCA_000001.1', '02'], ['PRJNA000002', '03']]);
  assert.deepEqual(all.errors, []);
  assert.deepEqual((await listProposals(repo, { ticket: tickets(), build: '02' })).proposals.map(p => p.manifest.accession), ['GCA_000001.1']);
});

test('listProposals reads each ticket status without changing it, and filters by status', async () => {
  const { repo } = setupRepo();
  const ticket = tickets({ statuses: { 41: 'proposed', 43: 'ready' } });
  const { proposals, errors } = await listProposals(repo, { ticket });
  assert.deepEqual(errors, []);
  assert.deepEqual(proposals.map(p => [p.manifest.accession, p.status]).sort(), [['GCA_000001.1', 'proposed'], ['PRJNA000002', 'ready']]);
  assert.equal(ticket.calls.some(c => c[0] === 'setStatus' || c[0] === 'comment'), false);
  const ready = await listProposals(repo, { ticket, status: 'ready' });
  assert.deepEqual(ready.proposals.map(p => p.manifest.accession), ['PRJNA000002']);
  const verifying = await listProposals(repo, { ticket: tickets({ statuses: { 41: 'verifying', 43: 'ready' } }), status: 'verifying' });
  assert.deepEqual(verifying.proposals.map(p => p.manifest.accession), ['GCA_000001.1']);
  const draft = await listProposals(repo, { ticket: tickets({ statuses: { 41: 'draft', 43: 'ready' } }), status: 'draft' });
  assert.deepEqual(draft.proposals.map(p => p.manifest.accession), ['GCA_000001.1']);
  const qa = await listProposals(repo, { ticket: tickets({ statuses: { 41: 'finalqa', 43: 'qa' } }), status: 'qa' });
  assert.deepEqual(qa.proposals.map(p => p.manifest.accession), ['PRJNA000002']);
  await assert.rejects(listProposals(repo, { ticket, status: 'Ready to load' }), /Unknown ticket status "Ready to load"; expected draft, proposed, verifying, revision, ready, loading, qa, finalqa, done/);
});

test('listProposals reports an unreadable ticket status as an error', async () => {
  const { repo } = setupRepo();
  const ticket = tickets({ statuses: { 43: new Error('Issue #43 is not in project VEuPathDB/25') } });
  const { proposals, errors } = await listProposals(repo, { ticket });
  assert.deepEqual(proposals.map(p => p.manifest.accession), ['GCA_000001.1']);
  assert.deepEqual(errors, [{ accession: 'PRJNA000002', message: 'Issue #43 is not in project VEuPathDB/25' }]);
});

test('listProposals reports a ticket without a build milestone as an error', async () => {
  const { repo } = setupRepo();
  const { proposals, errors } = await listProposals(repo, { ticket: tickets({ builds: { 43: null } }) });
  assert.deepEqual(proposals.map(p => p.manifest.accession), ['GCA_000001.1']);
  assert.match(errors[0].message, /Issue #43 has no "Build \{build\}" milestone/);
});

test('listProposals reports a bad manifest instead of failing the whole sweep', async () => {
  const { repo } = setupRepo();
  mkdirSync(join(repo, 'Proposals/BROKEN'), { recursive: true });
  writeFileSync(join(repo, 'Proposals/BROKEN/manifest.json'), '{ not json');
  setManifestFields(repo, 'PRJNA000002', { project: 'NotADB' });

  const { proposals, errors } = await listProposals(repo, { ticket: tickets() });
  assert.deepEqual(proposals.map(p => p.manifest.accession), ['GCA_000001.1']);
  assert.deepEqual(errors.map(e => e.accession).sort(), ['BROKEN', 'PRJNA000002']);
  assert.match(errors.find(e => e.accession === 'BROKEN').message, /not valid JSON/);
  assert.match(errors.find(e => e.accession === 'PRJNA000002').message, /project "NotADB" is not valid/);
});

test('listProposals reports a schemaVersion 1 manifest instead of failing the whole sweep', async () => {
  const { repo } = setupRepo();
  setManifestFields(repo, 'PRJNA000002', { schemaVersion: 1 });
  const { proposals, errors } = await listProposals(repo, { ticket: tickets() });
  assert.deepEqual(proposals.map(p => p.manifest.accession), ['GCA_000001.1']);
  assert.deepEqual(errors.map(e => e.accession), ['PRJNA000002']);
  assert.match(errors[0].message, /schemaVersion must be one of/);
});

test('listProposals reports a contact that is not in this branch allContacts.xml', async () => {
  const { repo } = setupRepo();
  setManifestFields(repo, 'GCA_000001.1', { contacts: { primary: 'nobody.here', additional: [] } });

  const { proposals, errors } = await listProposals(repo, { ticket: tickets() });
  assert.deepEqual(proposals.map(p => p.manifest.accession), ['PRJNA000002']);
  assert.match(errors.find(e => e.accession === 'GCA_000001.1').message,
    /contact "nobody\.here" not found in allContacts\.xml/);
});

test('preconditions: a contact absent from the rebuild branch is refused before any branch exists', async () => {
  const { repo } = setupRepo();
  setManifestFields(repo, 'GCA_000001.1', { contacts: { primary: 'nobody.here', additional: [] } });
  commitAll(repo, 'contact that is not on this branch');
  const git = createGit(repo);

  await assert.rejects(
    checkLoadPreconditions({ git, ticket: tickets(), repoPath: repo, accession: 'GCA_000001.1' }),
    /contact "nobody\.here" not found in allContacts\.xml/
  );
  assert.equal(git.branchExists('load/GCA_000001.1'), false);
});

test('preconditions: wrong branch names the checkout command', async () => {
  const { repo } = setupRepo();
  const git = createGit(repo);
  git.checkout('master');
  await assert.rejects(
    checkLoadPreconditions({ git, ticket: tickets(), repoPath: repo, accession: 'GCA_000001.1' }),
    /Expected to be on rebuild02, but on "master"\. The proposal's ticket is in build 02 \(rebuild02\)\..*checkout rebuild02/s
  );
});

test('preconditions: an existing load branch names the delete command', async () => {
  const { repo } = setupRepo();
  const git = createGit(repo);
  git.createBranch('load/GCA_000001.1', 'rebuild02');
  git.checkout('rebuild02');
  await assert.rejects(
    checkLoadPreconditions({ git, ticket: tickets(), repoPath: repo, accession: 'GCA_000001.1' }),
    /load\/GCA_000001\.1 already exists.*branch -D load\/GCA_000001\.1/s
  );
});

test('preconditions: a load branch left on origin names the remote delete', async () => {
  const { repo } = setupRepo();
  const git = createGit(repo);
  git.createBranch('load/GCA_000001.1', 'rebuild02');
  git.push('load/GCA_000001.1');
  git.checkout('rebuild02');
  execFileSync('git', ['-C', repo, 'branch', '-D', 'load/GCA_000001.1']);

  await assert.rejects(
    checkLoadPreconditions({ git, ticket: tickets(), repoPath: repo, accession: 'GCA_000001.1' }),
    /origin\/load\/GCA_000001\.1 already exists.*push origin --delete load\/GCA_000001\.1/s
  );
});

test('a fresh load pushes plainly; a resume force-pushes over its own remote branch', async () => {
  const { repo } = setupRepo();
  const pushes = [];
  const real = createGit(repo, { exec: ghStub({ failCreates: 1 }).exec });
  const git = { ...real, push: (branch, opts) => { pushes.push(opts); return real.push(branch, opts); } };

  // The first run pushes, then loses the gh pr create response.
  await assert.rejects(loadProposal({ git, ticket: tickets(), repoPath: repo, accession: 'GCA_000001.1' }));
  assert.deepEqual(pushes, [{}]);

  const result = await loadProposal({ git, ticket: tickets(), repoPath: repo, accession: 'GCA_000001.1' });
  assert.equal(result.resumed, true);
  assert.deepEqual(pushes[1], { force: true });
});

test('straggler: proposal only on master is cherry-picked onto the load branch and loaded', async () => {
  const { repo } = setupRepo();
  // add a build-02 proposal on master only, after rebuild02 was cut
  const git0 = createGit(repo);
  git0.checkout('master');
  cpSync(join(fixtures, 'proposals/PRJNA000003'), join(repo, 'Proposals/PRJNA000003'), { recursive: true });
  setManifestFields(repo, 'PRJNA000003', { ticket: { system: 'github', id: '42', url: 'https://r/issues/42' } });
  commitAll(repo, 'straggler');
  const sha = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim();
  git0.checkout('rebuild02');

  const pre = await checkLoadPreconditions({ git: git0, ticket: tickets(), repoPath: repo, accession: 'PRJNA000003' });
  assert.deepEqual(pre.straggler, [sha]);

  const git = createGit(repo, { exec: ghStub({ url: 'https://github.com/x/y/pull/2' }).exec });
  const result = await loadProposal({ git, ticket: tickets(), repoPath: repo, accession: 'PRJNA000003' });
  assert.deepEqual(result.cherryPicked, [sha]);
  assert.deepEqual(result.presenterNames, ['tfakST1_Doe_cold_shock_2024_rnaSeq_RSRC']);
  assert.equal(git.fileExistsOnRef('origin/load/PRJNA000003', 'Proposals/PRJNA000003/manifest.json'), false);
  assert.match(git.showFile('origin/load/PRJNA000003', 'Model/lib/xml/datasetPresenters/FungiDB.xml'), /tfakST1_Doe_cold_shock_2024_rnaSeq_RSRC/);
});

test('straggler: a contact its own commit adds on master travels with it', async () => {
  const { repo } = setupRepo();
  const acc = 'PRJNA000003';
  const git0 = createGit(repo);
  git0.checkout('master');
  cpSync(join(fixtures, `proposals/${acc}`), join(repo, `Proposals/${acc}`), { recursive: true });
  setManifestFields(repo, acc, { ticket: { system: 'github', id: '42', url: 'https://r/issues/42' } });
  setManifestFields(repo, acc, { contacts: { primary: 'late.arrival', additional: [] } });
  // One Phase 1 commit carries the proposal and the contact it needs; rebuild02
  // was cut before either existed.
  const contacts = join(repo, CONTACTS_RELATIVE_PATH);
  writeFileSync(contacts, readFileSync(contacts, 'utf-8').replace(
    '</contacts>', '  <contact>\n    <contactId>late.arrival</contactId>\n  </contact>\n</contacts>'));
  commitAll(repo, 'propose with a new contact');
  git0.checkout('rebuild02');

  const git = createGit(repo, { exec: ghStub({ url: 'https://github.com/x/y/pull/4' }).exec });
  const result = await loadProposal({ git, ticket: tickets(), repoPath: repo, accession: acc });
  assert.deepEqual(result.presenterNames, ['tfakST1_Doe_cold_shock_2024_rnaSeq_RSRC']);
  assert.match(git.showFile(`origin/load/${acc}`, CONTACTS_RELATIVE_PATH), /late\.arrival/);
});

test('straggler: only commits after the rebuild cut are cherry-picked', async () => {
  const { repo } = setupRepo();
  const acc = 'PRJNA000003';
  const git0 = createGit(repo);
  git0.checkout('master');

  // An earlier build proposed and loaded this accession: the proposal went in,
  // then came out again with a presenter of the name it carried back then.
  cpSync(join(fixtures, `proposals/${acc}`), join(repo, `Proposals/${acc}`), { recursive: true });
  setManifestFields(repo, acc, { ticket: { system: 'github', id: '42', url: 'https://r/issues/42' } });
  commitAll(repo, 'propose (earlier build)');
  execFileSync('git', ['-C', repo, 'rm', '-r', '-q', '--', `Proposals/${acc}`]);
  writeFileSync(join(repo, 'Model/lib/xml/datasetPresenters/FungiDB.xml'),
    '<datasetPresenters>\n  <datasetPresenter name="tfak_old_name_rnaSeq_RSRC"></datasetPresenter>\n</datasetPresenters>\n');
  commitAll(repo, 'load (earlier build)');

  // rebuild02 is cut from that history, then the accession is proposed again.
  execFileSync('git', ['-C', repo, 'branch', '-f', 'rebuild02', 'master']);
  execFileSync('git', ['-C', repo, 'push', '-q', '-f', 'origin', 'rebuild02']);
  cpSync(join(fixtures, `proposals/${acc}`), join(repo, `Proposals/${acc}`), { recursive: true });
  setManifestFields(repo, acc, { ticket: { system: 'github', id: '42', url: 'https://r/issues/42' } });
  commitAll(repo, 're-propose');
  const sha = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim();
  git0.checkout('rebuild02');

  const pre = await checkLoadPreconditions({ git: git0, ticket: tickets(), repoPath: repo, accession: acc });
  assert.deepEqual(pre.straggler, [sha]);

  const git = createGit(repo, { exec: ghStub({ url: 'https://github.com/x/y/pull/3' }).exec });
  const result = await loadProposal({ git, ticket: tickets(), repoPath: repo, accession: acc });
  assert.deepEqual(result.cherryPicked, [sha]);
  assert.deepEqual(result.presenterNames, ['tfakST1_Doe_cold_shock_2024_rnaSeq_RSRC']);
  assert.equal(git.fileExistsOnRef(`origin/load/${acc}`, `Proposals/${acc}/manifest.json`), false);
});

test('straggler: a presenter already on this build is refused before anything is created', async () => {
  const { repo } = setupRepo();
  const acc = 'PRJNA000003';
  const git = createGit(repo);
  git.checkout('master');
  cpSync(join(fixtures, `proposals/${acc}`), join(repo, `Proposals/${acc}`), { recursive: true });
  setManifestFields(repo, acc, { ticket: { system: 'github', id: '42', url: 'https://r/issues/42' } });
  commitAll(repo, 'straggler');
  git.checkout('rebuild02');
  writeFileSync(join(repo, 'Model/lib/xml/datasetPresenters/FungiDB.xml'),
    `<datasetPresenters>\n  <datasetPresenter name="tfakST1_Doe_cold_shock_2024_rnaSeq_RSRC"></datasetPresenter>\n</datasetPresenters>\n`);
  commitAll(repo, 'already loaded on this build');

  await assert.rejects(
    loadProposal({ git, ticket: tickets(), repoPath: repo, accession: acc }),
    /already exists in Model\/lib\/xml\/datasetPresenters\/FungiDB\.xml/
  );
  assert.equal(git.currentBranch(), 'rebuild02');
  assert.equal(git.branchExists(`load/${acc}`), false);
  assert.equal(git.isClean(), true);
});

test('preconditions: a rebuild branch behind origin names the pull command', async () => {
  const { root, repo, bare } = setupRepo();
  const other = otherClone(root, bare, 'rebuild02');
  writeFileSync(join(other, 'NOTES'), 'someone else moved the build\n');
  execFileSync('git', ['-C', other, 'add', '-A']);
  execFileSync('git', ['-C', other, 'commit', '-q', '-m', 'advance rebuild02']);
  execFileSync('git', ['-C', other, 'push', '-q']);

  await assert.rejects(
    checkLoadPreconditions({ git: createGit(repo), ticket: tickets(), repoPath: repo, accession: 'GCA_000001.1' }),
    /rebuild02 is not at origin\/rebuild02; run: git -C '.*' pull/
  );
});

test('a cherry-pick left mid-flight is aborted by the start-over command', async () => {
  const { repo } = setupRepo();
  const acc = 'PRJNA000003';
  const git0 = createGit(repo);
  git0.checkout('master');
  cpSync(join(fixtures, `proposals/${acc}`), join(repo, `Proposals/${acc}`), { recursive: true });
  setManifestFields(repo, acc, { ticket: { system: 'github', id: '42', url: 'https://r/issues/42' } });
  commitAll(repo, 'straggler');
  git0.checkout('rebuild02');

  const real = createGit(repo, { exec: ghStub().exec });
  const conflicting = {
    ...real,
    cherryPick: () => {
      writeFileSync(join(repo, '.git/CHERRY_PICK_HEAD'), '0000000000000000000000000000000000000000\n');
      throw new Error('Cherry-pick conflicts in:\n  Model/lib/xml/datasetPresenters/contacts/allContacts.xml');
    }
  };

  await assert.rejects(
    loadProposal({ git: conflicting, ticket: tickets(), repoPath: repo, accession: acc }),
    /To start over: git -C '.*' cherry-pick --abort && git -C '.*' checkout -f rebuild02 && git -C '.*' branch -D load\/PRJNA000003/
  );
});

test('preconditions: a dirty load branch is told how to start over', async () => {
  const { repo } = setupRepo();
  const git = createGit(repo);
  git.createBranch('load/GCA_000001.1', 'rebuild02');
  writeFileSync(join(repo, 'Model/lib/xml/datasetPresenters/FungiDB.xml'), '<datasetPresenters>half-written\n');

  await assert.rejects(
    checkLoadPreconditions({ git, ticket: tickets(), repoPath: repo, accession: 'GCA_000001.1' }),
    /A previous load left uncommitted changes on load\/GCA_000001\.1; to start over: git -C '.*' checkout -f rebuild02 && git -C '.*' branch -D load\/GCA_000001\.1/
  );
});

test('a failure after the load commit tells the user to re-run to resume', async () => {
  const { repo } = setupRepo();
  const git = createGit(repo, { exec: ghStub().exec });
  let pushes = 0;
  const flaky = { ...git, push: (...args) => { if (++pushes === 1) throw new Error('network is down'); return git.push(...args); } };

  await assert.rejects(
    loadProposal({ git: flaky, ticket: tickets(), repoPath: repo, accession: 'GCA_000001.1' }),
    /network is down\nRe-run the same command to resume\./
  );
  assert.equal(git.currentBranch(), 'load/GCA_000001.1');
  assert.equal(existsSync(join(repo, 'Proposals/GCA_000001.1')), false);

  // and the advice holds: the same command finishes the load
  const result = await loadProposal({ git, ticket: tickets(), repoPath: repo, accession: 'GCA_000001.1' });
  assert.equal(result.resumed, true);
});

test('a failure before the load commit tells the user how to start over', async () => {
  const { repo } = setupRepo();
  const git = createGit(repo, { exec: ghStub().exec });
  const broken = { ...git, commit: () => { throw new Error('commit hook exploded'); } };

  await assert.rejects(
    loadProposal({ git: broken, ticket: tickets(), repoPath: repo, accession: 'GCA_000001.1' }),
    /commit hook exploded\nTo start over: git -C '.*' checkout -f rebuild02 && git -C '.*' branch -D load\/GCA_000001\.1/
  );
});

test('a missing proposal anywhere is a clear error', async () => {
  const { repo } = setupRepo();
  await assert.rejects(
    checkLoadPreconditions({ git: createGit(repo), ticket: tickets(), repoPath: repo, accession: 'NOPE' }),
    /No proposal found/
  );
});

test('preconditions: presenter name collision', async () => {
  const { repo } = setupRepo();
  writeFileSync(join(repo, 'Model/lib/xml/datasetPresenters/FungiDB.xml'),
    '<datasetPresenters>\n  <datasetPresenter name="tfakST-1_primary_genome_RSRC"></datasetPresenter>\n</datasetPresenters>\n');
  commitAll(repo, 'collide');
  const git = createGit(repo);
  await assert.rejects(
    checkLoadPreconditions({ git, ticket: tickets(), repoPath: repo, accession: 'GCA_000001.1' }),
    /already exists in Model\/lib\/xml\/datasetPresenters\/FungiDB\.xml/
  );
});

test('loadProposal renders, deletes, commits, pushes, opens PR, updates ticket', async () => {
  const { repo } = setupRepo();
  setManifestFields(repo, 'GCA_000001.1', { ticket: { system: 'github', id: '42', url: 'https://r/issues/42' } });
  commitAll(repo, 'ticket');

  const gh = ghStub({ url: 'https://github.com/VEuPathDB/VEuPathDatasets/pull/11' });
  const git = createGit(repo, { exec: gh.exec });
  const ticket = tickets();
  const result = await loadProposal({ git, ticket, repoPath: repo, accession: 'GCA_000001.1' });

  const prCreate = gh.calls.find(a => a[0] === 'pr' && a[1] === 'create');
  assert.match(prCreate[prCreate.indexOf('--body') + 1], /^Part of https:\/\/r\/issues\/42$/m);
  assert.deepEqual(result.presenterNames, ['tfakST-1_primary_genome_RSRC']);
  assert.equal(result.prUrl, 'https://github.com/VEuPathDB/VEuPathDatasets/pull/11');
  assert.equal(git.currentBranch(), 'load/GCA_000001.1');
  assert.equal(git.isClean(), true);
  assert.equal(existsSync(join(repo, 'Proposals/GCA_000001.1')), false);
  const presenterFile = git.showFile('origin/load/GCA_000001.1', 'Model/lib/xml/datasetPresenters/FungiDB.xml');
  assert.match(presenterFile, /name="tfakST-1_primary_genome_RSRC"/);
  assert.equal(git.fileExistsOnRef('origin/load/GCA_000001.1', 'Proposals/GCA_000001.1/manifest.json'), false);
  assert.deepEqual(ticket.calls.map(c => c[0]).filter((c) => c !== 'getBuild' && c !== 'getStatus'), ['comment', 'setStatus']);
  assert.equal(ticket.calls.find(c => c[0] === 'setStatus')[2], 'loading');
  assert.match(ticket.calls.find(c => c[0] === 'comment')[2], /pull\/11/);
});

test('loadProposal resumes after a run that failed once the commit was pushed', async () => {
  const { repo } = setupRepo();
  setManifestFields(repo, 'GCA_000001.1', { ticket: { system: 'github', id: '42', url: 'https://r/issues/42' } });
  commitAll(repo, 'ticket');

  // First run: the PR is opened but gh loses the response, so the run fails
  // with the commit made and pushed.
  const gh = ghStub({ url: 'https://github.com/x/y/pull/9', failCreates: 1 });
  const git = createGit(repo, { exec: gh.exec });
  const ticket = tickets();
  await assert.rejects(loadProposal({ git, ticket, repoPath: repo, accession: 'GCA_000001.1' }));
  assert.equal(git.currentBranch(), 'load/GCA_000001.1');
  assert.equal(ticket.calls.filter(c => c[0] !== 'getBuild' && c[0] !== 'getStatus').length, 0);

  const result = await loadProposal({ git, ticket, repoPath: repo, accession: 'GCA_000001.1' });
  assert.equal(result.resumed, true);
  assert.equal(result.prUrl, 'https://github.com/x/y/pull/9');
  assert.equal(gh.calls.filter(a => a[0] === 'pr' && a[1] === 'create').length, 1);
  // the presenter name comes back from the commit the failed run wrote
  assert.deepEqual(result.presenterNames, ['tfakST-1_primary_genome_RSRC']);
  assert.deepEqual(ticket.calls.map(c => c[0]).filter((c) => c !== 'getBuild' && c !== 'getStatus'), ['comment', 'setStatus']);
});

test('a resumed load does not repeat the ticket comment but still sets the status', async () => {
  const { repo } = setupRepo();
  setManifestFields(repo, 'GCA_000001.1', { ticket: { system: 'github', id: '42', url: 'https://r/issues/42' } });
  commitAll(repo, 'ticket');

  const gh = ghStub({ url: 'https://github.com/x/y/pull/9' });
  const git = createGit(repo, { exec: gh.exec });
  const ticket = tickets();
  await loadProposal({ git, ticket, repoPath: repo, accession: 'GCA_000001.1' });
  await loadProposal({ git, ticket, repoPath: repo, accession: 'GCA_000001.1' });
  assert.equal(ticket.comments(), 1);
  assert.equal(ticket.calls.filter(c => c[0] === 'setStatus').length, 2);
});

test('loadProposal --dry-run changes nothing', async () => {
  const { repo } = setupRepo();
  const git = createGit(repo, { exec: ghStub().exec });
  const ticket = tickets();
  const result = await loadProposal({ git, ticket, repoPath: repo, accession: 'GCA_000001.1', dryRun: true });
  assert.deepEqual(result.presenterNames, ['tfakST-1_primary_genome_RSRC']);
  assert.match(result.presenters[0].xml, /<datasetPresenter /);
  assert.equal(git.currentBranch(), 'rebuild02');
  assert.equal(existsSync(join(repo, 'Proposals/GCA_000001.1')), true);
  assert.equal(ticket.calls.filter(c => c[0] !== 'getBuild' && c[0] !== 'getStatus').length, 0);
});

test('a dry run only reads the build and status from the ticket', async () => {
  const { repo } = setupRepo();
  const ticket = tickets();
  await loadProposal({ git: createGit(repo), ticket, repoPath: repo, accession: 'GCA_000001.1', dryRun: true });
  assert.deepEqual(ticket.calls.map(c => c[0]).sort(), ['getBuild', 'getStatus']);
});

test('load and dry run explain an Initial draft ticket', async () => {
  for (const dryRun of [false, true]) {
    const { repo } = setupRepo();
    await assert.rejects(loadProposal({ git: createGit(repo), ticket: tickets({ status: 'draft' }), repoPath: repo, accession: 'GCA_000001.1', dryRun }),
      /An "Initial draft" ticket's proposal PR is still being worked on, or was merged without moving the ticket to "Proposed"\./);
  }
});

test('a dry run serves verification: it runs every check at Proposed, Verification in progress, Ready to load or Needs revision', async () => {
  for (const status of ['proposed', 'verifying', 'ready', 'revision']) {
    const { repo } = setupRepo();
    const git = createGit(repo);
    const ticket = tickets({ status });
    const result = await loadProposal({ git, ticket, repoPath: repo, accession: 'GCA_000001.1', dryRun: true });
    assert.equal(result.dryRun, true);
    assert.deepEqual(result.presenterNames, ['tfakST-1_primary_genome_RSRC']);
    assert.equal(git.branchExists('load/GCA_000001.1'), false);
    assert.equal(ticket.calls.some(c => c[0] === 'setStatus' || c[0] === 'comment'), false);
  }
});

test('only a Ready to load proposal loads: anything else is refused before any branch; a dry run refuses only loading or done', async () => {
  for (const [status, option] of [['draft', 'Initial draft'], ['proposed', 'Proposed'], ['verifying', 'Verification in progress'], ['revision', 'Needs revision'], ['loading', 'Loading in progress'], ['qa', 'Post Load QA'], ['finalqa', 'Final QA'], ['done', 'Done']]) {
    for (const dryRun of (['draft', 'loading', 'qa', 'finalqa', 'done'].includes(status) ? [false, true] : [false])) {
      const { repo } = setupRepo();
      const git = createGit(repo);
      const ticket = tickets({ status });
      await assert.rejects(loadProposal({ git, ticket, repoPath: repo, accession: 'GCA_000001.1', dryRun }),
        dryRun
          ? new RegExp(`The proposal's ticket https://r/issues/41 is at "${option}"; a dry run needs "Proposed", "Verification in progress", "Ready to load" or "Needs revision"`)
          : new RegExp(`The proposal's ticket https://r/issues/41 is at "${option}"; only "Ready to load" proposals load\\. Verify it and run mark-ready, or request-revision\\.`));
      assert.equal(git.branchExists('load/GCA_000001.1'), false);
      assert.equal(git.currentBranch(), 'rebuild02');
      assert.equal(ticket.calls.some(c => c[0] === 'setStatus' || c[0] === 'comment'), false);
    }
  }
});

test('load checks the project before anything changes', async () => {
  const { repo } = setupRepo();
  const git = createGit(repo);
  const ticket = tickets({ projectError: 'Project VEuPathDB/25 field "Status" has no option "Ready to load"' });
  await assert.rejects(loadProposal({ git, ticket, repoPath: repo, accession: 'GCA_000001.1' }), /has no option "Ready to load"/);
  assert.equal(git.branchExists('load/GCA_000001.1'), false);
  assert.equal(ticket.calls.some(c => c[0] === 'setStatus' || c[0] === 'comment'), false);
  const ok = tickets();
  await loadProposal({ git: createGit(repo, { exec: ghStub().exec }), ticket: ok, repoPath: repo, accession: 'GCA_000001.1' });
  assert.ok(ok.projectChecks >= 1);
});

test('a load without a ticket is refused: the build lives on the ticket', async () => {
  const { repo } = setupRepo();
  setManifestFields(repo, 'GCA_000001.1', { ticket: undefined });
  commitAll(repo, 'drop ticket');
  await assert.rejects(checkLoadPreconditions({ git: createGit(repo), ticket: tickets(), repoPath: repo, accession: 'GCA_000001.1' }),
    /Proposal GCA_000001\.1 has no ticket, so it has no build/);
});

test('the rebuild branch comes from the ticket milestone', async () => {
  const { repo } = setupRepo();
  await assert.rejects(checkLoadPreconditions({ git: createGit(repo), ticket: tickets(), repoPath: repo, accession: 'PRJNA000002' }),
    /The proposal's ticket is in build 03 \(rebuild03\)/);
});

// --- dataset entry and loading artifacts --------------------------------------

const DELIVERY = 'FungiDB/tfakST1/rnaSeq/Doe_heat_shock_2024/2024-05-01/final';

/** PRJNA000002 moved onto build 02 with a ticket, so it loads from rebuild02. */
function rnaOnRebuild(t) {
  const { repo, root } = setupRepo();
  setManifestFields(repo, 'PRJNA000002', { ticket: { system: 'github', id: '42', url: 'https://r/issues/42' } });
  commitAll(repo, 'PRJNA000002 into build 02');
  const deliveryBase = mkdtempSync(join(tmpdir(), 'load-delivery-'));
  t.after(() => rmSync(deliveryBase, { recursive: true, force: true }));
  return { repo, root, deliveryBase };
}

test('an rnaseq load adds the dataset entry in the same commit and hands off the artifacts', async (t) => {
  const { repo, deliveryBase } = rnaOnRebuild(t);
  const gh = ghStub({ url: 'https://github.com/VEuPathDB/VEuPathDatasets/pull/21' });
  const git = createGit(repo, { exec: gh.exec });
  const ticket = tickets();
  const result = await loadProposal({ git, ticket, repoPath: repo, accession: 'PRJNA000002', deliveryBase });

  const ref = 'origin/load/PRJNA000002';
  const organismFile = git.showFile(ref, 'Datasets/lib/xml/datasets/FungiDB/tfakST1.xml');
  assert.ok(organismFile.includes(readFileSync(join(fixtures, 'proposals/PRJNA000002/expected-dataset.xml'), 'utf-8').trimEnd()));
  assert.match(git.showFile(ref, 'Model/lib/xml/datasetPresenters/FungiDB.xml'), /name="tfakST1_Doe_heat_shock_2024_rnaSeq_RSRC"/);
  assert.equal(git.commitsForPath('rebuild02..origin/load/PRJNA000002', 'Datasets').length, 1);
  assert.match(git.headSubject(), /^Load PRJNA000002: add tfakST1_Doe_heat_shock_2024_rnaSeq_RSRC to FungiDB, Doe_heat_shock_2024 to tfakST1, remove proposal$/);

  const golden = join(fixtures, 'proposals/PRJNA000002/expected-artifacts');
  for (const f of ['analysisConfig.xml', 'samplesheet.csv']) {
    assert.equal(readFileSync(join(deliveryBase, DELIVERY, f), 'utf-8'), readFileSync(join(golden, f), 'utf-8'));
  }
  assert.match(result.handoff, /to `@@manualDeliveryDir@@\/FungiDB\/tfakST1\/rnaSeq\/Doe_heat_shock_2024\/2024-05-01\/final\/`/);
  const prCreate = gh.calls.find(a => a[0] === 'pr' && a[1] === 'create');
  const prBody = prCreate[prCreate.indexOf('--body') + 1];
  assert.match(prBody, /Dataset: `Doe_heat_shock_2024` \(rnaSeqExperiment\) in `Datasets\/lib\/xml\/datasets\/FungiDB\/tfakST1\.xml`/);
  assert.ok(prBody.includes(result.handoff));
  assert.ok(ticket.calls.find(c => c[0] === 'comment')[2].includes(result.handoff));
  assert.equal(git.isClean(), true);
});

test('a load is refused before any branch when the organism file already has the name', async (t) => {
  const { repo } = rnaOnRebuild(t);
  const path = join(repo, 'Datasets/lib/xml/datasets/FungiDB/tfakST1.xml');
  writeFileSync(path, readFileSync(path, 'utf-8').replace('Existing_2020', 'Doe_heat_shock_2024'));
  commitAll(repo, 'already loaded');
  const git = createGit(repo);
  await assert.rejects(checkLoadPreconditions({ git, ticket: tickets(), repoPath: repo, accession: 'PRJNA000002' }),
    /Datasets\/lib\/xml\/datasets\/FungiDB\/tfakST1\.xml already has a rnaSeqExperiment named "Doe_heat_shock_2024"/);
  assert.equal(git.branchExists('load/PRJNA000002'), false);
});

test('a load is refused before any branch when the organism file is missing', async (t) => {
  const { repo } = rnaOnRebuild(t);
  execFileSync('git', ['-C', repo, 'rm', '-q', 'Datasets/lib/xml/datasets/FungiDB/tfakST1.xml']);
  commitAll(repo, 'organism dropped');
  await assert.rejects(checkLoadPreconditions({ git: createGit(repo), ticket: tickets(), repoPath: repo, accession: 'PRJNA000002' }),
    /Dataset file missing: Datasets\/lib\/xml\/datasets\/FungiDB\/tfakST1\.xml/);
});

/** PRJNA000002 on rebuild02, aligned to tfakST2 as well, which has its own dataset file. */
function rnaForTwoOrganisms(t) {
  const setup = rnaOnRebuild(t);
  cpSync(join(setup.repo, 'Datasets/lib/xml/datasets/FungiDB/tfakST1.xml'), join(setup.repo, 'Datasets/lib/xml/datasets/FungiDB/tfakST2.xml'));
  setManifestFields(setup.repo, 'PRJNA000002', { organisms: loaded('tfakST1', 'tfakST2') });
  commitAll(setup.repo, 'align to tfakST2 too');
  return setup;
}

const BOTH_PRESENTERS = ['tfakST1_Doe_heat_shock_2024_rnaSeq_RSRC', 'tfakST2_Doe_heat_shock_2024_rnaSeq_RSRC'];

test('an rnaseq load with an additional organism writes each organism its dataset, presenter and delivery', async (t) => {
  const { repo, deliveryBase } = rnaForTwoOrganisms(t);

  const git = createGit(repo, { exec: ghStub({ url: 'https://github.com/x/y/pull/23' }).exec });
  const result = await loadProposal({ git, ticket: tickets(), repoPath: repo, accession: 'PRJNA000002', deliveryBase });

  const ref = 'origin/load/PRJNA000002';
  const presenters = git.showFile(ref, 'Model/lib/xml/datasetPresenters/FungiDB.xml');
  for (const org of ['tfakST1', 'tfakST2']) {
    assert.match(presenters, new RegExp(`name="${org}_Doe_heat_shock_2024_rnaSeq_RSRC"`));
    assert.match(git.showFile(ref, `Datasets/lib/xml/datasets/FungiDB/${org}.xml`), /<prop name="name">Doe_heat_shock_2024<\/prop>/);
    assert.ok(existsSync(join(deliveryBase, `FungiDB/${org}/rnaSeq/Doe_heat_shock_2024/2024-05-01/final/samplesheet.csv`)));
    assert.match(result.handoff, new RegExp(`to \`@@manualDeliveryDir@@/FungiDB/${org}/rnaSeq/`));
  }
  assert.deepEqual(result.presenterNames, BOTH_PRESENTERS);
  assert.equal(git.headSubject(),
    'Load PRJNA000002: add tfakST1_Doe_heat_shock_2024_rnaSeq_RSRC tfakST2_Doe_heat_shock_2024_rnaSeq_RSRC to FungiDB, Doe_heat_shock_2024 to tfakST1 tfakST2, remove proposal');
});

test('a two-organism load that failed after its commit dry-runs, then resumes with both organisms', async (t) => {
  const { repo, deliveryBase } = rnaForTwoOrganisms(t);
  const flaky = createGit(repo, { exec: ghStub({ url: 'https://github.com/x/y/pull/24', failCreates: 1 }).exec });
  await assert.rejects(loadProposal({ git: flaky, ticket: tickets(), repoPath: repo, accession: 'PRJNA000002', deliveryBase }));
  rmSync(join(deliveryBase, 'FungiDB'), { recursive: true, force: true });

  const git = createGit(repo, { exec: ghStub({ url: 'https://github.com/x/y/pull/24' }).exec });
  const dry = await loadProposal({ git, ticket: tickets(), repoPath: repo, accession: 'PRJNA000002', dryRun: true, deliveryBase });
  assert.deepEqual(dry.presenterNames, BOTH_PRESENTERS);

  const result = await loadProposal({ git, ticket: tickets(), repoPath: repo, accession: 'PRJNA000002', deliveryBase });
  assert.equal(result.resumed, true);
  assert.deepEqual(result.presenterNames, BOTH_PRESENTERS);
  for (const org of ['tfakST1', 'tfakST2']) {
    assert.ok(existsSync(join(deliveryBase, `FungiDB/${org}/rnaSeq/Doe_heat_shock_2024/2024-05-01/final/samplesheet.csv`)));
    assert.match(result.handoff, new RegExp(`^Copy \`.*\` to \`@@manualDeliveryDir@@/FungiDB/${org}/rnaSeq/`, 'm'));
  }
  assert.equal(execFileSync('git', ['-C', repo, 'rev-list', '--count', 'rebuild02..load/PRJNA000002'], { encoding: 'utf-8' }).trim(), '1');
});

test('a load is refused before any branch when an additional organism has no dataset file', async (t) => {
  const { repo } = rnaOnRebuild(t);
  setManifestFields(repo, 'PRJNA000002', { organisms: loaded('tfakST1', 'tfakST2') });
  commitAll(repo, 'align to a missing organism');
  const git = createGit(repo);
  await assert.rejects(checkLoadPreconditions({ git, ticket: tickets(), repoPath: repo, accession: 'PRJNA000002' }),
    /Dataset file missing: Datasets\/lib\/xml\/datasets\/FungiDB\/tfakST2\.xml/);
  assert.equal(git.branchExists('load/PRJNA000002'), false);
});

test('a dry run renders the dataset entry and artifacts but writes nothing', async (t) => {
  const { repo, deliveryBase } = rnaOnRebuild(t);
  const git = createGit(repo);
  const result = await loadProposal({ git, ticket: tickets(), repoPath: repo, accession: 'PRJNA000002', dryRun: true, deliveryBase });
  assert.match(result.dataset.xml, /<prop name="name">Doe_heat_shock_2024<\/prop>/);
  assert.ok('samplesheet.csv' in result.dataset.organisms[0].files);
  assert.equal(existsSync(join(deliveryBase, 'FungiDB')), false);
  assert.equal(git.currentBranch(), 'rebuild02');
});

test('a resumed rnaseq load still hands off the artifacts', async (t) => {
  const { repo, deliveryBase } = rnaOnRebuild(t);
  const flaky = createGit(repo, { exec: ghStub({ url: 'https://github.com/x/y/pull/22', failCreates: 1 }).exec });
  await assert.rejects(loadProposal({ git: flaky, ticket: tickets(), repoPath: repo, accession: 'PRJNA000002', deliveryBase }));
  rmSync(join(deliveryBase, 'FungiDB'), { recursive: true, force: true });

  const git = createGit(repo, { exec: ghStub({ url: 'https://github.com/x/y/pull/22' }).exec });
  const result = await loadProposal({ git, ticket: tickets(), repoPath: repo, accession: 'PRJNA000002', deliveryBase });
  assert.equal(result.resumed, true);
  assert.ok(existsSync(join(deliveryBase, DELIVERY, 'samplesheet.csv')));
  assert.match(result.handoff, /to `@@manualDeliveryDir@@\/FungiDB\/tfakST1\/rnaSeq\/Doe_heat_shock_2024\/2024-05-01\/final\/`/);
});

test('a load is refused before any branch when a curated samplesheet was edited out of agreement', async (t) => {
  const { repo } = rnaOnRebuild(t);
  const path = join(repo, 'Proposals/PRJNA000002/curated/samplesheet.csv');
  writeFileSync(path, readFileSync(path, 'utf-8').replace('SAMN2,', 'SAMN9,'));
  commitAll(repo, 'hand edit gone wrong');
  const git = createGit(repo);
  await assert.rejects(checkLoadPreconditions({ git, ticket: tickets(), repoPath: repo, accession: 'PRJNA000002' }),
    /Curated artifacts of PRJNA000002 disagree:[\s\S]*only in samplesheet\.csv: SAMN9/);
  assert.equal(git.branchExists('load/PRJNA000002'), false);
});

/** PRJNA000002 on rebuild02 with reads on a server: curator-named files, no SRA metadata. */
function rnaFromServer(t) {
  const setup = rnaOnRebuild(t);
  const dir = join(setup.repo, 'Proposals/PRJNA000002');
  const edit = (rel, fn) => writeFileSync(join(dir, rel), JSON.stringify(fn(JSON.parse(readFileSync(join(dir, rel), 'utf-8'))), null, 2) + '\n');
  edit('curated/PRJNA000002_sample_annotations.json', (a) => ({
    ...a,
    samples: a.samples.map(({ runs, biosample, ...s }) => ({ ...s, files: [{ fastq_1: `${s.sampleId}_R1.fq.gz`, fastq_2: `${s.sampleId}_R2.fq.gz` }] }))
  }));
  edit('curated/dataset.json', (d) => ({ ...d, props: { ...d.props, fromSRA: 'false' }, source: { type: 'server', paths: ['/data/doe'] } }));
  rmSync(join(dir, 'inputs/PRJNA000002_sra_metadata.json'));
  for (const [f, text] of Object.entries(deriveArtifacts(dir))) writeFileSync(join(dir, 'curated', f), text);
  commitAll(setup.repo, 'PRJNA000002 reads on a server');
  return setup;
}

test('an rnaseq load with reads on a server delivers a samplesheet naming the files', async (t) => {
  const { repo, deliveryBase } = rnaFromServer(t);
  const git = createGit(repo, { exec: ghStub({ url: 'https://github.com/x/y/pull/25' }).exec });
  const result = await loadProposal({ git, ticket: tickets(), repoPath: repo, accession: 'PRJNA000002', deliveryBase });

  assert.equal(readFileSync(join(deliveryBase, DELIVERY, 'samplesheet.csv'), 'utf-8'),
    'sample,fastq_1,fastq_2,strandedness\nSAMN1,SAMN1_R1.fq.gz,SAMN1_R2.fq.gz,stranded\nSAMN2,SAMN2_R1.fq.gz,SAMN2_R2.fq.gz,stranded\n');
  assert.match(git.showFile('origin/load/PRJNA000002', 'Datasets/lib/xml/datasets/FungiDB/tfakST1.xml'), /<prop name="fromSRA">false<\/prop>/);
  assert.match(result.handoff, /Reads: files named in the samplesheet, under: \/data\/doe/);
});

// --- markLoaded ------------------------------------------------------------

/** Loads GCA_000001.1 (ticket 42) and returns what a merged load PR would report. */
async function loadedProposal() {
  const { root, repo, bare } = setupRepo();
  setManifestFields(repo, 'GCA_000001.1', { ticket: { system: 'github', id: '42', url: 'https://r/issues/42' } });
  commitAll(repo, 'ticket');
  await loadProposal({ git: createGit(repo, { exec: ghStub().exec }), ticket: tickets(), repoPath: repo, accession: 'GCA_000001.1' });
  const headRefOid = execFileSync('git', ['-C', repo, 'rev-parse', 'load/GCA_000001.1'], { encoding: 'utf-8' }).trim();
  const merged = { url: 'https://github.com/VEuPathDB/VEuPathDatasets/pull/11', number: 11, baseRefName: 'rebuild02', headRefOid };
  return { root, repo, bare, merged };
}

test('markLoaded moves a loading ticket to Post Load QA and notes the merged load PR once', async () => {
  const { repo, merged } = await loadedProposal();
  const gh = ghStub({ merged });
  const git = createGit(repo, { exec: gh.exec });
  const ticket = tickets({ status: 'loading' });
  const result = await markLoaded({ git, ticket, accession: 'GCA_000001.1' });
  assert.equal(result.prUrl, merged.url);
  assert.equal(result.ticket.id, '42');
  const list = gh.calls.find(a => a[0] === 'pr' && a.includes('merged'));
  assert.equal(list[list.indexOf('--head') + 1], 'load/GCA_000001.1');
  assert.deepEqual(ticket.notes, ['Loaded into rebuild02: https://github.com/VEuPathDB/VEuPathDatasets/pull/11']);
  assert.deepEqual(ticket.calls.filter(c => c[0] === 'setStatus'), [['setStatus', '42', 'qa']]);
  assert.equal(result.alreadyLoaded, false);

  const again = await markLoaded({ git, ticket, accession: 'GCA_000001.1' });
  assert.equal(again.alreadyLoaded, true);
  assert.equal(ticket.comments(), 1);
  assert.equal(ticket.calls.filter(c => c[0] === 'setStatus').length, 1);
});

test('markLoaded changes nothing once the ticket is past loading', async () => {
  const { repo, merged } = await loadedProposal();
  for (const status of ['qa', 'finalqa', 'done']) {
    const ticket = tickets({ status, existingComments: ['Loaded into rebuild02: https://github.com/VEuPathDB/VEuPathDatasets/pull/11'] });
    const result = await markLoaded({ git: createGit(repo, { exec: ghStub({ merged }).exec }), ticket, accession: 'GCA_000001.1' });
    assert.equal(result.alreadyLoaded, true);
    assert.equal(ticket.calls.some(c => c[0] === 'setStatus' || c[0] === 'comment'), false);
  }
});

test('markLoaded refuses before the load PR has merged', async () => {
  const { repo } = await loadedProposal();
  const ticket = tickets({ status: 'loading' });
  await assert.rejects(markLoaded({ git: createGit(repo, { exec: ghStub().exec }), ticket, accession: 'GCA_000001.1' }),
    /No merged pull request from load\/GCA_000001\.1/);
  assert.deepEqual(ticket.calls, []);
});

test('markLoaded refuses a ticket that is not loading', async () => {
  const { repo, merged } = await loadedProposal();
  const ticket = tickets({ status: 'ready' });
  await assert.rejects(markLoaded({ git: createGit(repo, { exec: ghStub({ merged }).exec }), ticket, accession: 'GCA_000001.1' }),
    /ticket https:\/\/r\/issues\/42 status is "ready", not "loading"/);
  assert.equal(ticket.calls.some(c => c[0] === 'setStatus' || c[0] === 'comment'), false);
});

test('markLoaded finds the ticket from a clone without the load branch, fetching the PR head', async () => {
  const { root, bare, merged } = await loadedProposal();
  execFileSync('git', ['-C', bare, 'update-ref', 'refs/pull/11/head', merged.headRefOid]);
  execFileSync('git', ['-C', bare, 'update-ref', '-d', 'refs/heads/load/GCA_000001.1']);
  const other = otherClone(root, bare, 'rebuild02');
  const ticket = tickets({ status: 'loading' });
  const result = await markLoaded({ git: createGit(other, { exec: ghStub({ merged }).exec }), ticket, accession: 'GCA_000001.1' });
  assert.equal(result.ticket.id, '42');
  assert.deepEqual(ticket.calls.filter(c => c[0] === 'setStatus'), [['setStatus', '42', 'qa']]);
});
