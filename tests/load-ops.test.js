import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, existsSync, readFileSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createGit } from '../shared/scripts/lib/git-ops.js';
import { CONTACTS_RELATIVE_PATH } from '../shared/scripts/lib/contacts.js';
import { checkLoadPreconditions, loadProposal, listProposals } from '../shared/scripts/lib/load-ops.js';
import { fixtures, initRepo, otherClone, stubTicket, stubGh as ghStub } from './helpers.js';

const setupRepo = () => {
  const { root, repo, bare } = initRepo('load-ops-');
  writeFileSync(join(repo, 'Model/lib/xml/datasetPresenters/FungiDB.xml'), '<?xml version="1.0"?>\n<datasetPresenters>\n</datasetPresenters>\n');
  cpSync(join(fixtures, 'proposals/GCA_000001.1'), join(repo, 'Proposals/GCA_000001.1'), { recursive: true });
  cpSync(join(fixtures, 'proposals/PRJNA000002'), join(repo, 'Proposals/PRJNA000002'), { recursive: true });
  // PRJNA000002 targets build 03 in this scenario
  setManifestFields(repo, 'PRJNA000002', { targetBuild: '03' });
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

test('listProposals reads manifests on the current branch and filters by build', () => {
  const { repo } = setupRepo();
  const all = listProposals(repo);
  assert.deepEqual(all.proposals.map(p => p.accession).sort(), ['GCA_000001.1', 'PRJNA000002']);
  assert.deepEqual(all.errors, []);
  assert.deepEqual(listProposals(repo, { build: '02' }).proposals.map(p => p.accession), ['GCA_000001.1']);
});

test('listProposals reports a bad manifest instead of failing the whole sweep', () => {
  const { repo } = setupRepo();
  mkdirSync(join(repo, 'Proposals/BROKEN'), { recursive: true });
  writeFileSync(join(repo, 'Proposals/BROKEN/manifest.json'), '{ not json');
  setManifestFields(repo, 'PRJNA000002', { project: 'NotADB' });

  const { proposals, errors } = listProposals(repo);
  assert.deepEqual(proposals.map(p => p.accession), ['GCA_000001.1']);
  assert.deepEqual(errors.map(e => e.accession).sort(), ['BROKEN', 'PRJNA000002']);
  assert.match(errors.find(e => e.accession === 'BROKEN').message, /not valid JSON/);
  assert.match(errors.find(e => e.accession === 'PRJNA000002').message, /project "NotADB" is not valid/);
});

test('listProposals reports a contact that is not in this branch allContacts.xml', () => {
  const { repo } = setupRepo();
  setManifestFields(repo, 'GCA_000001.1', { contacts: { primary: 'nobody.here', additional: [] } });

  const { proposals, errors } = listProposals(repo);
  assert.deepEqual(proposals.map(p => p.accession), ['PRJNA000002']);
  assert.match(errors.find(e => e.accession === 'GCA_000001.1').message,
    /contact "nobody\.here" not found in allContacts\.xml/);
});

test('preconditions: a contact absent from the rebuild branch is refused before any branch exists', async () => {
  const { repo } = setupRepo();
  setManifestFields(repo, 'GCA_000001.1', { contacts: { primary: 'nobody.here', additional: [] } });
  commitAll(repo, 'contact that is not on this branch');
  const git = createGit(repo);

  await assert.rejects(
    checkLoadPreconditions({ git, repoPath: repo, accession: 'GCA_000001.1' }),
    /contact "nobody\.here" not found in allContacts\.xml/
  );
  assert.equal(git.branchExists('load/GCA_000001.1'), false);
});

test('preconditions: wrong branch names the checkout command', async () => {
  const { repo } = setupRepo();
  const git = createGit(repo);
  git.checkout('master');
  await assert.rejects(
    checkLoadPreconditions({ git, repoPath: repo, accession: 'GCA_000001.1' }),
    /Expected to be on rebuild02, but on "master"\. The proposal targets build 02 \(rebuild02\)\..*checkout rebuild02/s
  );
});

test('preconditions: an existing load branch names the delete command', async () => {
  const { repo } = setupRepo();
  const git = createGit(repo);
  git.createBranch('load/GCA_000001.1', 'rebuild02');
  git.checkout('rebuild02');
  await assert.rejects(
    checkLoadPreconditions({ git, repoPath: repo, accession: 'GCA_000001.1' }),
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
    checkLoadPreconditions({ git, repoPath: repo, accession: 'GCA_000001.1' }),
    /origin\/load\/GCA_000001\.1 already exists.*push origin --delete load\/GCA_000001\.1/s
  );
});

test('a fresh load pushes plainly; a resume force-pushes over its own remote branch', async () => {
  const { repo } = setupRepo();
  const pushes = [];
  const real = createGit(repo, { exec: ghStub({ failCreates: 1 }).exec });
  const git = { ...real, push: (branch, opts) => { pushes.push(opts); return real.push(branch, opts); } };

  // The first run pushes, then loses the gh pr create response.
  await assert.rejects(loadProposal({ git, ticket: stubTicket(), repoPath: repo, accession: 'GCA_000001.1' }));
  assert.deepEqual(pushes, [{}]);

  const result = await loadProposal({ git, ticket: stubTicket(), repoPath: repo, accession: 'GCA_000001.1' });
  assert.equal(result.resumed, true);
  assert.deepEqual(pushes[1], { force: true });
});

test('straggler: proposal only on master is cherry-picked onto the load branch and loaded', async () => {
  const { repo } = setupRepo();
  // add a build-02 proposal on master only, after rebuild02 was cut
  const git0 = createGit(repo);
  git0.checkout('master');
  cpSync(join(fixtures, 'proposals/PRJNA000002_no_overrides'), join(repo, 'Proposals/PRJNA000002_no_overrides'), { recursive: true });
  commitAll(repo, 'straggler');
  const sha = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim();
  git0.checkout('rebuild02');

  const pre = await checkLoadPreconditions({ git: git0, repoPath: repo, accession: 'PRJNA000002_no_overrides' });
  assert.deepEqual(pre.straggler, [sha]);

  const git = createGit(repo, { exec: ghStub({ url: 'https://github.com/x/y/pull/2' }).exec });
  const result = await loadProposal({ git, ticket: stubTicket(), repoPath: repo, accession: 'PRJNA000002_no_overrides' });
  assert.deepEqual(result.cherryPicked, [sha]);
  assert.equal(result.presenterName, 'tfak_PRJNA000002_no_overrides_rnaSeq_RSRC');
  assert.equal(git.fileExistsOnRef('origin/load/PRJNA000002_no_overrides', 'Proposals/PRJNA000002_no_overrides/manifest.json'), false);
  assert.match(git.showFile('origin/load/PRJNA000002_no_overrides', 'Model/lib/xml/datasetPresenters/FungiDB.xml'), /tfak_PRJNA000002_no_overrides_rnaSeq_RSRC/);
});

test('straggler: a contact its own commit adds on master travels with it', async () => {
  const { repo } = setupRepo();
  const acc = 'PRJNA000002_no_overrides';
  const git0 = createGit(repo);
  git0.checkout('master');
  cpSync(join(fixtures, `proposals/${acc}`), join(repo, `Proposals/${acc}`), { recursive: true });
  setManifestFields(repo, acc, { contacts: { primary: 'late.arrival', additional: [] } });
  // One Phase 1 commit carries the proposal and the contact it needs; rebuild02
  // was cut before either existed.
  const contacts = join(repo, CONTACTS_RELATIVE_PATH);
  writeFileSync(contacts, readFileSync(contacts, 'utf-8').replace(
    '</contacts>', '  <contact>\n    <contactId>late.arrival</contactId>\n  </contact>\n</contacts>'));
  commitAll(repo, 'propose with a new contact');
  git0.checkout('rebuild02');

  const git = createGit(repo, { exec: ghStub({ url: 'https://github.com/x/y/pull/4' }).exec });
  const result = await loadProposal({ git, ticket: stubTicket(), repoPath: repo, accession: acc });
  assert.equal(result.presenterName, `tfak_${acc}_rnaSeq_RSRC`);
  assert.match(git.showFile(`origin/load/${acc}`, CONTACTS_RELATIVE_PATH), /late\.arrival/);
});

test('straggler: only commits after the rebuild cut are cherry-picked', async () => {
  const { repo } = setupRepo();
  const acc = 'PRJNA000002_no_overrides';
  const git0 = createGit(repo);
  git0.checkout('master');

  // An earlier build proposed and loaded this accession: the proposal went in,
  // then came out again with a presenter of the name it carried back then.
  cpSync(join(fixtures, `proposals/${acc}`), join(repo, `Proposals/${acc}`), { recursive: true });
  commitAll(repo, 'propose (earlier build)');
  execFileSync('git', ['-C', repo, 'rm', '-r', '-q', '--', `Proposals/${acc}`]);
  writeFileSync(join(repo, 'Model/lib/xml/datasetPresenters/FungiDB.xml'),
    '<datasetPresenters>\n  <datasetPresenter name="tfak_old_name_rnaSeq_RSRC"></datasetPresenter>\n</datasetPresenters>\n');
  commitAll(repo, 'load (earlier build)');

  // rebuild02 is cut from that history, then the accession is proposed again.
  execFileSync('git', ['-C', repo, 'branch', '-f', 'rebuild02', 'master']);
  execFileSync('git', ['-C', repo, 'push', '-q', '-f', 'origin', 'rebuild02']);
  cpSync(join(fixtures, `proposals/${acc}`), join(repo, `Proposals/${acc}`), { recursive: true });
  commitAll(repo, 're-propose');
  const sha = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim();
  git0.checkout('rebuild02');

  const pre = await checkLoadPreconditions({ git: git0, repoPath: repo, accession: acc });
  assert.deepEqual(pre.straggler, [sha]);

  const git = createGit(repo, { exec: ghStub({ url: 'https://github.com/x/y/pull/3' }).exec });
  const result = await loadProposal({ git, ticket: stubTicket(), repoPath: repo, accession: acc });
  assert.deepEqual(result.cherryPicked, [sha]);
  assert.equal(result.presenterName, `tfak_${acc}_rnaSeq_RSRC`);
  assert.equal(git.fileExistsOnRef(`origin/load/${acc}`, `Proposals/${acc}/manifest.json`), false);
});

test('straggler: a presenter already on this build is refused before anything is created', async () => {
  const { repo } = setupRepo();
  const acc = 'PRJNA000002_no_overrides';
  const git = createGit(repo);
  git.checkout('master');
  cpSync(join(fixtures, `proposals/${acc}`), join(repo, `Proposals/${acc}`), { recursive: true });
  commitAll(repo, 'straggler');
  git.checkout('rebuild02');
  writeFileSync(join(repo, 'Model/lib/xml/datasetPresenters/FungiDB.xml'),
    `<datasetPresenters>\n  <datasetPresenter name="tfak_${acc}_rnaSeq_RSRC"></datasetPresenter>\n</datasetPresenters>\n`);
  commitAll(repo, 'already loaded on this build');

  await assert.rejects(
    loadProposal({ git, ticket: stubTicket(), repoPath: repo, accession: acc }),
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
    checkLoadPreconditions({ git: createGit(repo), repoPath: repo, accession: 'GCA_000001.1' }),
    /rebuild02 is not at origin\/rebuild02; run: git -C '.*' pull/
  );
});

test('a cherry-pick left mid-flight is aborted by the start-over command', async () => {
  const { repo } = setupRepo();
  const acc = 'PRJNA000002_no_overrides';
  const git0 = createGit(repo);
  git0.checkout('master');
  cpSync(join(fixtures, `proposals/${acc}`), join(repo, `Proposals/${acc}`), { recursive: true });
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
    loadProposal({ git: conflicting, ticket: stubTicket(), repoPath: repo, accession: acc }),
    /To start over: git -C '.*' cherry-pick --abort && git -C '.*' checkout -f rebuild02 && git -C '.*' branch -D load\/PRJNA000002_no_overrides/
  );
});

test('preconditions: a dirty load branch is told how to start over', async () => {
  const { repo } = setupRepo();
  const git = createGit(repo);
  git.createBranch('load/GCA_000001.1', 'rebuild02');
  writeFileSync(join(repo, 'Model/lib/xml/datasetPresenters/FungiDB.xml'), '<datasetPresenters>half-written\n');

  await assert.rejects(
    checkLoadPreconditions({ git, repoPath: repo, accession: 'GCA_000001.1' }),
    /A previous load left uncommitted changes on load\/GCA_000001\.1; to start over: git -C '.*' checkout -f rebuild02 && git -C '.*' branch -D load\/GCA_000001\.1/
  );
});

test('a failure after the load commit tells the user to re-run to resume', async () => {
  const { repo } = setupRepo();
  const git = createGit(repo, { exec: ghStub().exec });
  let pushes = 0;
  const flaky = { ...git, push: (...args) => { if (++pushes === 1) throw new Error('network is down'); return git.push(...args); } };

  await assert.rejects(
    loadProposal({ git: flaky, ticket: stubTicket(), repoPath: repo, accession: 'GCA_000001.1' }),
    /network is down\nRe-run the same command to resume\./
  );
  assert.equal(git.currentBranch(), 'load/GCA_000001.1');
  assert.equal(existsSync(join(repo, 'Proposals/GCA_000001.1')), false);

  // and the advice holds: the same command finishes the load
  const result = await loadProposal({ git, ticket: stubTicket(), repoPath: repo, accession: 'GCA_000001.1' });
  assert.equal(result.resumed, true);
});

test('a failure before the load commit tells the user how to start over', async () => {
  const { repo } = setupRepo();
  const git = createGit(repo, { exec: ghStub().exec });
  const broken = { ...git, commit: () => { throw new Error('commit hook exploded'); } };

  await assert.rejects(
    loadProposal({ git: broken, ticket: stubTicket(), repoPath: repo, accession: 'GCA_000001.1' }),
    /commit hook exploded\nTo start over: git -C '.*' checkout -f rebuild02 && git -C '.*' branch -D load\/GCA_000001\.1/
  );
});

test('a missing proposal anywhere is a clear error', async () => {
  const { repo } = setupRepo();
  await assert.rejects(
    checkLoadPreconditions({ git: createGit(repo), repoPath: repo, accession: 'NOPE' }),
    /No proposal found/
  );
});

test('preconditions: presenter name collision', async () => {
  const { repo } = setupRepo();
  writeFileSync(join(repo, 'Model/lib/xml/datasetPresenters/FungiDB.xml'),
    '<datasetPresenters>\n  <datasetPresenter name="tfakST1_primary_genome_RSRC"></datasetPresenter>\n</datasetPresenters>\n');
  commitAll(repo, 'collide');
  const git = createGit(repo);
  await assert.rejects(
    checkLoadPreconditions({ git, repoPath: repo, accession: 'GCA_000001.1' }),
    /already exists in Model\/lib\/xml\/datasetPresenters\/FungiDB\.xml/
  );
});

test('loadProposal renders, deletes, commits, pushes, opens PR, updates ticket', async () => {
  const { repo } = setupRepo();
  setManifestFields(repo, 'GCA_000001.1', { ticket: { system: 'redmine', id: '42', url: 'https://r/issues/42' } });
  commitAll(repo, 'ticket');

  const git = createGit(repo, { exec: ghStub({ url: 'https://github.com/VEuPathDB/VEuPathDatasets/pull/11' }).exec });
  const ticket = stubTicket();
  const result = await loadProposal({ git, ticket, repoPath: repo, accession: 'GCA_000001.1' });

  assert.equal(result.presenterName, 'tfakST1_primary_genome_RSRC');
  assert.equal(result.prUrl, 'https://github.com/VEuPathDB/VEuPathDatasets/pull/11');
  assert.equal(git.currentBranch(), 'load/GCA_000001.1');
  assert.equal(git.isClean(), true);
  assert.equal(existsSync(join(repo, 'Proposals/GCA_000001.1')), false);
  const presenterFile = git.showFile('origin/load/GCA_000001.1', 'Model/lib/xml/datasetPresenters/FungiDB.xml');
  assert.match(presenterFile, /name="tfakST1_primary_genome_RSRC"/);
  assert.equal(git.fileExistsOnRef('origin/load/GCA_000001.1', 'Proposals/GCA_000001.1/manifest.json'), false);
  assert.deepEqual(ticket.calls.map(c => c[0]), ['comment', 'setStatus']);
  assert.equal(ticket.calls[1][2], 'loading');
  assert.match(ticket.calls[0][2], /pull\/11/);
});

test('loadProposal resumes after a run that failed once the commit was pushed', async () => {
  const { repo } = setupRepo();
  setManifestFields(repo, 'GCA_000001.1', { ticket: { system: 'redmine', id: '42', url: 'https://r/issues/42' } });
  commitAll(repo, 'ticket');

  // First run: the PR is opened but gh loses the response, so the run fails
  // with the commit made and pushed.
  const gh = ghStub({ url: 'https://github.com/x/y/pull/9', failCreates: 1 });
  const git = createGit(repo, { exec: gh.exec });
  const ticket = stubTicket();
  await assert.rejects(loadProposal({ git, ticket, repoPath: repo, accession: 'GCA_000001.1' }));
  assert.equal(git.currentBranch(), 'load/GCA_000001.1');
  assert.equal(ticket.calls.length, 0);

  const result = await loadProposal({ git, ticket, repoPath: repo, accession: 'GCA_000001.1' });
  assert.equal(result.resumed, true);
  assert.equal(result.prUrl, 'https://github.com/x/y/pull/9');
  assert.equal(gh.calls.filter(a => a[0] === 'pr' && a[1] === 'create').length, 1);
  // the presenter name comes back from the commit the failed run wrote
  assert.equal(result.presenterName, 'tfakST1_primary_genome_RSRC');
  assert.deepEqual(ticket.calls.map(c => c[0]), ['comment', 'setStatus']);
});

test('a resumed load does not repeat the ticket comment but still sets the status', async () => {
  const { repo } = setupRepo();
  setManifestFields(repo, 'GCA_000001.1', { ticket: { system: 'redmine', id: '42', url: 'https://r/issues/42' } });
  commitAll(repo, 'ticket');

  const gh = ghStub({ url: 'https://github.com/x/y/pull/9' });
  const git = createGit(repo, { exec: gh.exec });
  const ticket = stubTicket();
  await loadProposal({ git, ticket, repoPath: repo, accession: 'GCA_000001.1' });
  await loadProposal({ git, ticket, repoPath: repo, accession: 'GCA_000001.1' });
  assert.equal(ticket.comments(), 1);
  assert.equal(ticket.calls.filter(c => c[0] === 'setStatus').length, 2);
});

test('loadProposal --dry-run changes nothing', async () => {
  const { repo } = setupRepo();
  const git = createGit(repo, { exec: ghStub().exec });
  const ticket = stubTicket();
  const result = await loadProposal({ git, ticket, repoPath: repo, accession: 'GCA_000001.1', dryRun: true });
  assert.equal(result.presenterName, 'tfakST1_primary_genome_RSRC');
  assert.match(result.xml, /<datasetPresenter /);
  assert.equal(git.currentBranch(), 'rebuild02');
  assert.equal(existsSync(join(repo, 'Proposals/GCA_000001.1')), true);
  assert.equal(ticket.calls.length, 0);
});

test('loadProposal --dry-run needs no ticket client at all', async () => {
  const { repo } = setupRepo();
  const git = createGit(repo, { exec: ghStub().exec });
  const result = await loadProposal({ git, ticket: null, repoPath: repo, accession: 'GCA_000001.1', dryRun: true });
  assert.equal(result.presenterName, 'tfakST1_primary_genome_RSRC');
  assert.equal(git.currentBranch(), 'rebuild02');
});

test('loadProposal without a ticket in the manifest skips ticket calls and says so', async () => {
  const { repo } = setupRepo();
  const git = createGit(repo, { exec: ghStub().exec });
  const ticket = stubTicket();
  const result = await loadProposal({ git, ticket, repoPath: repo, accession: 'GCA_000001.1' });
  assert.equal(ticket.calls.length, 0);
  assert.match(result.warnings.join(' '), /no ticket/);
});
