import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, existsSync, readFileSync, cpSync, mkdtempSync, rmSync, renameSync, lstatSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createGit } from '../shared/scripts/lib/git-ops.js';
import { CONTACTS_RELATIVE_PATH } from '../shared/scripts/lib/contacts.js';
import { CLASSES_RELATIVE_PATH, readDatasetClass } from '../shared/scripts/lib/dataset-classes.js';
import * as dnaseq from '../shared/scripts/dataset-types/dnaseq.js';
import { checkLoadPreconditions, loadProposal, listProposals, markLoaded, checkOrganisms } from '../shared/scripts/lib/load-ops.js';
import { deriveArtifacts } from '../shared/scripts/dataset-types/bulk-rnaseq.js';
import { fixtures, initRepo, otherClone, stubTicket, stubGh as ghStub, loaded, loadedIn, alignTo } from './helpers.js';

// Only a verified (ready) proposal loads.
const tickets = (opts) => stubTicket({ status: 'ready', builds: { 43: '03' }, ...opts });
const REBUILD = 'rebuild02';
const noFindings = async () => [];

const setupRepo = () => {
  const { root, repo, bare } = initRepo('load-ops-');
  writeFileSync(join(repo, 'Model/lib/xml/datasetPresenters/FungiDB.xml'), '<?xml version="1.0"?>\n<datasetPresenters>\n</datasetPresenters>\n');
  commitAll(repo, 'presenters');
  // rebuild02 is cut before the proposals merge, so it never has them.
  execFileSync('git', ['-C', repo, 'branch', 'rebuild02']);
  execFileSync('git', ['-C', repo, 'push', '-q', '-u', 'origin', 'rebuild02']);
  cpSync(join(fixtures, 'proposals/GCA_000001.1'), join(repo, 'Proposals/GCA_000001.1'), { recursive: true });
  cpSync(join(fixtures, 'proposals/PRJNA000002'), join(repo, 'Proposals/PRJNA000002'), { recursive: true });
  setManifestFields(repo, 'GCA_000001.1', { ticket: { system: 'github', id: '41', url: 'https://r/issues/41' } });
  setManifestFields(repo, 'PRJNA000002', { ticket: { system: 'github', id: '43', url: 'https://r/issues/43' } });
  commitAll(repo, 'merge proposals');
  execFileSync('git', ['-C', repo, 'checkout', '-q', 'rebuild02']);
  return { root, repo, bare };
};

function setManifestFields(repo, accession, fields) {
  const path = join(repo, 'Proposals', accession, 'manifest.json');
  const m = JSON.parse(readFileSync(path, 'utf-8'));
  writeFileSync(path, JSON.stringify({ ...m, ...fields }, null, 2) + '\n');
}

/** Moves a fixture proposal's curated artifacts from tfakST1 to the organism it now proposes. */
function moveArtifacts(repo, accession, proposed) {
  const curated = join(repo, 'Proposals', accession, 'curated');
  renameSync(join(curated, 'tfakST1'), join(curated, proposed));
}

/** Commits and pushes the current branch. */
function commitAll(repo, message) {
  execFileSync('git', ['-C', repo, 'add', '-A']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', message]);
  execFileSync('git', ['-C', repo, 'push', '-q', '-u', 'origin', 'HEAD']);
}

const ticket42 = { ticket: { system: 'github', id: '42', url: 'https://r/issues/42' } };

/** GCA_000001.1 with ticket 42 on master. */
const genomeTicket42 = (repo) => editOnMaster(repo, () => setManifestFields(repo, 'GCA_000001.1', ticket42), 'ticket');

const loadCommitFiles = (repo) => execFileSync('git', ['-C', repo, 'show', '--name-only', '--format=', 'HEAD'], { encoding: 'utf-8' }).trim().split('\n').sort();

/** Applies edit on master, commits and pushes there, and returns to rebuild02. */
function editOnMaster(repo, edit, message) {
  execFileSync('git', ['-C', repo, 'checkout', '-q', 'master']);
  edit();
  commitAll(repo, message);
  execFileSync('git', ['-C', repo, 'checkout', '-q', 'rebuild02']);
}

test('listProposals reads manifests on origin/master and filters by the ticket build', async () => {
  const { repo } = setupRepo();
  const git = createGit(repo);
  const all = await listProposals(git, { ticket: tickets() });
  assert.deepEqual(all.proposals.map(p => [p.manifest.accession, p.build]).sort(), [['GCA_000001.1', '02'], ['PRJNA000002', '03']]);
  assert.deepEqual(all.errors, []);
  assert.deepEqual((await listProposals(git, { ticket: tickets(), build: '02' })).proposals.map(p => p.manifest.accession), ['GCA_000001.1']);
});

test('listProposals ignores proposals that are only on the rebuild branch', async () => {
  const { repo } = setupRepo();
  const git = createGit(repo);
  cpSync(join(fixtures, 'proposals/PRJNA000003'), join(repo, 'Proposals/PRJNA000003'), { recursive: true });
  commitAll(repo, 'a proposal on rebuild02 only');
  const { proposals } = await listProposals(git, { ticket: tickets() });
  assert.equal(proposals.some(p => p.manifest.accession === 'PRJNA000003'), false);
});

test('listProposals reads each ticket status without changing it, and filters by status', async () => {
  const { repo } = setupRepo();
  const ticket = tickets({ statuses: { 41: 'proposed', 43: 'ready' } });
  const { proposals, errors } = await listProposals(createGit(repo), { ticket });
  assert.deepEqual(errors, []);
  assert.deepEqual(proposals.map(p => [p.manifest.accession, p.status]).sort(), [['GCA_000001.1', 'proposed'], ['PRJNA000002', 'ready']]);
  assert.equal(ticket.calls.some(c => c[0] === 'setStatus' || c[0] === 'comment'), false);
  const ready = await listProposals(createGit(repo), { ticket, status: 'ready' });
  assert.deepEqual(ready.proposals.map(p => p.manifest.accession), ['PRJNA000002']);
  const verifying = await listProposals(createGit(repo), { ticket: tickets({ statuses: { 41: 'verifying', 43: 'ready' } }), status: 'verifying' });
  assert.deepEqual(verifying.proposals.map(p => p.manifest.accession), ['GCA_000001.1']);
  const draft = await listProposals(createGit(repo), { ticket: tickets({ statuses: { 41: 'draft', 43: 'ready' } }), status: 'draft' });
  assert.deepEqual(draft.proposals.map(p => p.manifest.accession), ['GCA_000001.1']);
  const qa = await listProposals(createGit(repo), { ticket: tickets({ statuses: { 41: 'finalqa', 43: 'qa' } }), status: 'qa' });
  assert.deepEqual(qa.proposals.map(p => p.manifest.accession), ['PRJNA000002']);
  await assert.rejects(listProposals(createGit(repo), { ticket, status: 'Ready to load' }), /Unknown ticket status "Ready to load"; expected draft, proposed, verifying, revision, ready, loading, qa, finalqa, done/);
});

test('listProposals reports an unreadable ticket status as an error', async () => {
  const { repo } = setupRepo();
  const ticket = tickets({ statuses: { 43: new Error('Issue #43 is not in project VEuPathDB/25') } });
  const { proposals, errors } = await listProposals(createGit(repo), { ticket });
  assert.deepEqual(proposals.map(p => p.manifest.accession), ['GCA_000001.1']);
  assert.deepEqual(errors, [{ accession: 'PRJNA000002', message: 'Issue #43 is not in project VEuPathDB/25' }]);
});

test('listProposals reports a ticket without a build milestone as an error', async () => {
  const { repo } = setupRepo();
  const { proposals, errors } = await listProposals(createGit(repo), { ticket: tickets({ builds: { 43: null } }) });
  assert.deepEqual(proposals.map(p => p.manifest.accession), ['GCA_000001.1']);
  assert.match(errors[0].message, /Issue #43 has no "Build \{build\}" milestone/);
});

test('listProposals reports a bad manifest instead of failing the whole sweep', async () => {
  const { repo } = setupRepo();
  editOnMaster(repo, () => {
    mkdirSync(join(repo, 'Proposals/BROKEN'), { recursive: true });
    writeFileSync(join(repo, 'Proposals/BROKEN/manifest.json'), '{ not json');
    setManifestFields(repo, 'PRJNA000002', { organisms: loadedIn('NotADB', 'tfakST1') });
  }, 'bad manifests on master');

  const { proposals, errors } = await listProposals(createGit(repo), { ticket: tickets() });
  assert.deepEqual(proposals.map(p => p.manifest.accession), ['GCA_000001.1']);
  assert.deepEqual(errors.map(e => e.accession).sort(), ['BROKEN', 'PRJNA000002']);
  assert.match(errors.find(e => e.accession === 'BROKEN').message, /not valid JSON/);
  assert.match(errors.find(e => e.accession === 'PRJNA000002').message, /organisms\[0\]\.project "NotADB" is not valid/);
});

test('listProposals reports a schemaVersion 1 manifest instead of failing the whole sweep', async () => {
  const { repo } = setupRepo();
  editOnMaster(repo, () => setManifestFields(repo, 'PRJNA000002', { schemaVersion: 1 }), 'schemaVersion 1 on master');
  const { proposals, errors } = await listProposals(createGit(repo), { ticket: tickets() });
  assert.deepEqual(proposals.map(p => p.manifest.accession), ['GCA_000001.1']);
  assert.deepEqual(errors.map(e => e.accession), ['PRJNA000002']);
  assert.match(errors[0].message, /schemaVersion must be one of/);
});

test('listProposals reports a contact that is not in origin/master allContacts.xml', async () => {
  const { repo } = setupRepo();
  editOnMaster(repo, () => setManifestFields(repo, 'GCA_000001.1', { contacts: { primary: 'nobody.here', additional: [] } }), 'unknown contact on master');

  const { proposals, errors } = await listProposals(createGit(repo), { ticket: tickets() });
  assert.deepEqual(proposals.map(p => p.manifest.accession), ['PRJNA000002']);
  assert.match(errors.find(e => e.accession === 'GCA_000001.1').message,
    /contact "nobody\.here" not found in allContacts\.xml/);
});

test('preconditions: a contact absent from origin/master is refused before any branch exists', async () => {
  const { repo } = setupRepo();
  editOnMaster(repo, () => setManifestFields(repo, 'GCA_000001.1', { contacts: { primary: 'nobody.here', additional: [] } }), 'contact that is not on master');
  const git = createGit(repo);

  await assert.rejects(
    checkLoadPreconditions({ git, ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'GCA_000001.1' }),
    /contact "nobody\.here" not found in allContacts\.xml/
  );
  assert.equal(git.branchExists('load/GCA_000001.1'), false);
});

test('preconditions: wrong branch names the checkout command', async () => {
  const { repo } = setupRepo();
  const git = createGit(repo);
  git.checkout('master');
  await assert.rejects(
    checkLoadPreconditions({ git, ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'GCA_000001.1' }),
    /Expected to be on rebuild02, but on "master"\. Loading targets rebuild02\..*checkout rebuild02/s
  );
});

test('preconditions: an existing load branch names the delete command', async () => {
  const { repo } = setupRepo();
  const git = createGit(repo);
  git.createBranch('load/GCA_000001.1', 'rebuild02');
  git.checkout('rebuild02');
  await assert.rejects(
    checkLoadPreconditions({ git, ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'GCA_000001.1' }),
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
    checkLoadPreconditions({ git, ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'GCA_000001.1' }),
    /origin\/load\/GCA_000001\.1 already exists.*push origin --delete load\/GCA_000001\.1/s
  );
});

test('a fresh load pushes plainly; a resume force-pushes over its own remote branch', async () => {
  const { repo } = setupRepo();
  const pushes = [];
  const real = createGit(repo, { exec: ghStub({ failCreates: 1 }).exec });
  const git = { ...real, push: (branch, opts) => { pushes.push(opts); return real.push(branch, opts); } };

  // The first run pushes, then loses the gh pr create response.
  await assert.rejects(loadProposal({ git, ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'GCA_000001.1' }));
  assert.deepEqual(pushes, [{}]);

  const result = await loadProposal({ git, ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'GCA_000001.1' });
  assert.equal(result.resumed, true);
  assert.deepEqual(pushes[1], { force: true });
});

test('a presenter already on the rebuild branch is refused before anything is created', async () => {
  const { repo } = setupRepo();
  const acc = 'PRJNA000003';
  const git = createGit(repo);
  editOnMaster(repo, () => {
    cpSync(join(fixtures, `proposals/${acc}`), join(repo, `Proposals/${acc}`), { recursive: true });
    setManifestFields(repo, acc, ticket42);
  }, 'propose');
  writeFileSync(join(repo, 'Model/lib/xml/datasetPresenters/FungiDB.xml'),
    `<datasetPresenters>\n  <datasetPresenter name="tfakST1_Doe_cold_shock_2024_rnaSeq_RSRC"></datasetPresenter>\n</datasetPresenters>\n`);
  commitAll(repo, 'already loaded on this build');

  await assert.rejects(
    loadProposal({ git, ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: acc }),
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
    checkLoadPreconditions({ git: createGit(repo), ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'GCA_000001.1' }),
    /rebuild02 is not at origin\/rebuild02; run: git -C '.*' pull/
  );
});

test('preconditions: a dirty load branch is told how to start over', async () => {
  const { repo } = setupRepo();
  const git = createGit(repo);
  git.createBranch('load/GCA_000001.1', 'rebuild02');
  writeFileSync(join(repo, 'Model/lib/xml/datasetPresenters/FungiDB.xml'), '<datasetPresenters>half-written\n');

  await assert.rejects(
    checkLoadPreconditions({ git, ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'GCA_000001.1' }),
    /A previous load left uncommitted changes on load\/GCA_000001\.1; to start over: git -C '.*' checkout -f rebuild02 && git -C '.*' branch -D load\/GCA_000001\.1/
  );
});

test('a failure after the load commit tells the user to re-run to resume', async () => {
  const { repo } = setupRepo();
  const git = createGit(repo, { exec: ghStub().exec });
  let pushes = 0;
  const flaky = { ...git, push: (...args) => { if (++pushes === 1) throw new Error('network is down'); return git.push(...args); } };

  await assert.rejects(
    loadProposal({ git: flaky, ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'GCA_000001.1' }),
    /network is down\nRe-run the same command to resume\./
  );
  assert.equal(git.currentBranch(), 'load/GCA_000001.1');
  assert.equal(existsSync(join(repo, 'Proposals/GCA_000001.1')), false);

  // and the advice holds: the same command finishes the load
  const result = await loadProposal({ git, ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'GCA_000001.1' });
  assert.equal(result.resumed, true);
});

test('a failure before the load commit tells the user how to start over', async () => {
  const { repo } = setupRepo();
  const git = createGit(repo, { exec: ghStub().exec });
  const broken = { ...git, commit: () => { throw new Error('commit hook exploded'); } };

  await assert.rejects(
    loadProposal({ git: broken, ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'GCA_000001.1' }),
    /commit hook exploded\nTo start over: git -C '.*' checkout -f rebuild02 && git -C '.*' branch -D load\/GCA_000001\.1/
  );
});

test('a proposal missing from origin/master is a clear error', async () => {
  const { repo } = setupRepo();
  await assert.rejects(
    checkLoadPreconditions({ git: createGit(repo), ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'NOPE' }),
    /No proposal found at Proposals\/NOPE on origin\/master/
  );
});

test('a resume is refused when HEAD is not this accession\'s load commit', async () => {
  const { repo } = setupRepo();
  execFileSync('git', ['-C', repo, 'checkout', '-q', '-b', 'load/GCA_000001.1']);
  writeFileSync(join(repo, 'NOTES'), 'not a load\n');
  commitAll(repo, 'unrelated work');
  await assert.rejects(
    checkLoadPreconditions({ git: createGit(repo), ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'GCA_000001.1' }),
    /Branch load\/GCA_000001\.1 is checked out but does not hold a load commit for GCA_000001\.1; to start over: git -C '.*' checkout -f rebuild02 && git -C '.*' branch -D load\/GCA_000001\.1$/);
});

test('a load commit that removed the proposal is not resumed', async () => {
  const { repo } = setupRepo();
  execFileSync('git', ['-C', repo, 'checkout', '-q', '-b', 'load/GCA_000001.1']);
  writeFileSync(join(repo, 'Model/lib/xml/datasetPresenters/FungiDB.xml'),
    '<datasetPresenters>\n  <datasetPresenter name="tfakST-1_primary_genome_RSRC"></datasetPresenter>\n</datasetPresenters>\n');
  commitAll(repo, 'Load GCA_000001.1: add tfakST-1_primary_genome_RSRC to FungiDB, remove proposal');
  await assert.rejects(
    checkLoadPreconditions({ git: createGit(repo), ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'GCA_000001.1' }),
    /Branch load\/GCA_000001\.1 is checked out but does not hold a load commit for GCA_000001\.1; to start over: /);
});

test('preconditions: presenter name collision', async () => {
  const { repo } = setupRepo();
  writeFileSync(join(repo, 'Model/lib/xml/datasetPresenters/FungiDB.xml'),
    '<datasetPresenters>\n  <datasetPresenter name="tfakST-1_primary_genome_RSRC"></datasetPresenter>\n</datasetPresenters>\n');
  commitAll(repo, 'collide');
  const git = createGit(repo);
  await assert.rejects(
    checkLoadPreconditions({ git, ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'GCA_000001.1' }),
    /already exists in Model\/lib\/xml\/datasetPresenters\/FungiDB\.xml/
  );
});

test('loadProposal renders, commits, pushes, opens PR, updates ticket', async () => {
  const { repo } = setupRepo();
  genomeTicket42(repo);

  const gh = ghStub({ url: 'https://github.com/VEuPathDB/VEuPathDatasets/pull/11' });
  const git = createGit(repo, { exec: gh.exec });
  const ticket = tickets();
  const result = await loadProposal({ git, ticket, repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'GCA_000001.1' });

  const prCreate = gh.calls.find(a => a[0] === 'pr' && a[1] === 'create');
  assert.match(prCreate[prCreate.indexOf('--title') + 1], / into rebuild02 for build 02$/);
  assert.match(prCreate[prCreate.indexOf('--body') + 1], /^Part of https:\/\/r\/issues\/42$/m);
  assert.match(prCreate[prCreate.indexOf('--body') + 1], /^Proposal: `Proposals\/GCA_000001\.1` on master \(archived in delivery\)$/m);
  assert.deepEqual(result.presenterNames, ['tfakST-1_primary_genome_RSRC']);
  assert.equal(result.prUrl, 'https://github.com/VEuPathDB/VEuPathDatasets/pull/11');
  assert.equal(git.currentBranch(), 'load/GCA_000001.1');
  assert.equal(git.isClean(), true);
  assert.equal(git.headSubject(), 'Load GCA_000001.1: add tfakST-1_primary_genome_RSRC to FungiDB');
  assert.deepEqual(loadCommitFiles(repo), ['Model/lib/xml/datasetPresenters/FungiDB.xml']);
  const presenterFile = git.showFile('origin/load/GCA_000001.1', 'Model/lib/xml/datasetPresenters/FungiDB.xml');
  assert.match(presenterFile, /name="tfakST-1_primary_genome_RSRC"/);
  assert.equal(git.fileExistsOnRef('origin/load/GCA_000001.1', 'Proposals/GCA_000001.1/manifest.json'), false);
  assert.deepEqual(ticket.calls.map(c => c[0]).filter((c) => c !== 'getBuild' && c !== 'getStatus'), ['comment', 'setStatus']);
  assert.equal(ticket.calls.find(c => c[0] === 'setStatus')[2], 'loading');
  assert.match(ticket.calls.find(c => c[0] === 'comment')[2], /pull\/11/);
});

test('loadProposal resumes after a run that failed once the commit was pushed', async () => {
  const { repo } = setupRepo();
  genomeTicket42(repo);

  // First run: the PR is opened but gh loses the response, so the run fails
  // with the commit made and pushed.
  const gh = ghStub({ url: 'https://github.com/x/y/pull/9', failCreates: 1 });
  const git = createGit(repo, { exec: gh.exec });
  const ticket = tickets();
  await assert.rejects(loadProposal({ git, ticket, repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'GCA_000001.1' }));
  assert.equal(git.currentBranch(), 'load/GCA_000001.1');
  assert.equal(ticket.calls.filter(c => c[0] !== 'getBuild' && c[0] !== 'getStatus').length, 0);

  const result = await loadProposal({ git, ticket, repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'GCA_000001.1' });
  assert.equal(result.resumed, true);
  assert.equal(result.prUrl, 'https://github.com/x/y/pull/9');
  assert.equal(gh.calls.filter(a => a[0] === 'pr' && a[1] === 'create').length, 1);
  // the presenter name comes back from the commit the failed run wrote
  assert.deepEqual(result.presenterNames, ['tfakST-1_primary_genome_RSRC']);
  assert.deepEqual(ticket.calls.map(c => c[0]).filter((c) => c !== 'getBuild' && c !== 'getStatus'), ['comment', 'setStatus']);
});

test('a resume is refused when the load branch was not cut from the given rebuild branch', async () => {
  const { repo } = setupRepo();
  genomeTicket42(repo);

  const gh = ghStub({ url: 'https://github.com/x/y/pull/9', failCreates: 1 });
  const git = createGit(repo, { exec: gh.exec });
  await assert.rejects(loadProposal({ git, ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'GCA_000001.1' }));
  const pushedBefore = git.showFile('origin/load/GCA_000001.1', 'Model/lib/xml/datasetPresenters/FungiDB.xml');

  const run = (...args) => execFileSync('git', ['-C', repo, ...args]);
  run('checkout', '-q', '-b', 'rebuild03', 'master');
  writeFileSync(join(repo, 'NOTES'), 'a different rebuild\n');
  run('add', '-A');
  run('commit', '-q', '-m', 'start rebuild03');
  run('push', '-q', 'origin', 'rebuild03');
  run('checkout', '-q', 'load/GCA_000001.1');

  await assert.rejects(loadProposal({ git, ticket: tickets(), repoPath: repo, rebuildBranch: 'rebuild03', validate: noFindings, accession: 'GCA_000001.1' }),
    /Branch load\/GCA_000001\.1 was not cut from rebuild03; resume with the --rebuild-branch it was loaded from/);
  assert.equal(git.showFile('origin/load/GCA_000001.1', 'Model/lib/xml/datasetPresenters/FungiDB.xml'), pushedBefore);
  assert.equal(gh.calls.filter(a => a[0] === 'pr' && a[1] === 'create').length, 1);
});

test('a resumed load does not repeat the ticket comment but still sets the status', async () => {
  const { repo } = setupRepo();
  genomeTicket42(repo);

  const gh = ghStub({ url: 'https://github.com/x/y/pull/9' });
  const git = createGit(repo, { exec: gh.exec });
  const ticket = tickets();
  await loadProposal({ git, ticket, repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'GCA_000001.1' });
  await loadProposal({ git, ticket, repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'GCA_000001.1' });
  assert.equal(ticket.comments(), 1);
  assert.equal(ticket.calls.filter(c => c[0] === 'setStatus').length, 2);
});

test('loadProposal --dry-run changes nothing', async () => {
  const { repo } = setupRepo();
  const git = createGit(repo, { exec: ghStub().exec });
  const ticket = tickets();
  const result = await loadProposal({ git, ticket, repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'GCA_000001.1', dryRun: true });
  assert.deepEqual(result.presenterNames, ['tfakST-1_primary_genome_RSRC']);
  assert.match(result.presenters[0].xml, /<datasetPresenter /);
  assert.equal(git.currentBranch(), 'rebuild02');
  assert.equal(git.isClean(), true);
  assert.equal(ticket.calls.filter(c => c[0] !== 'getBuild' && c[0] !== 'getStatus').length, 0);
});

test('a dry run only reads the build and status from the ticket', async () => {
  const { repo } = setupRepo();
  const ticket = tickets();
  await loadProposal({ git: createGit(repo), ticket, repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'GCA_000001.1', dryRun: true });
  assert.deepEqual(ticket.calls.map(c => c[0]).sort(), ['getBuild', 'getStatus']);
});

test('load and dry run explain an Initial draft ticket', async () => {
  for (const dryRun of [false, true]) {
    const { repo } = setupRepo();
    await assert.rejects(loadProposal({ git: createGit(repo), ticket: tickets({ status: 'draft' }), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'GCA_000001.1', dryRun }),
      /An "Initial draft" ticket's proposal PR is still being worked on, or was merged without moving the ticket to "Proposed"\./);
  }
});

test('a dry run serves verification: it runs every check at Proposed, Preprocessing, Ready to load or Needs revision', async () => {
  for (const status of ['proposed', 'verifying', 'ready', 'revision']) {
    const { repo } = setupRepo();
    const git = createGit(repo);
    const ticket = tickets({ status });
    const result = await loadProposal({ git, ticket, repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'GCA_000001.1', dryRun: true });
    assert.equal(result.dryRun, true);
    assert.deepEqual(result.presenterNames, ['tfakST-1_primary_genome_RSRC']);
    assert.equal(git.branchExists('load/GCA_000001.1'), false);
    assert.equal(ticket.calls.some(c => c[0] === 'setStatus' || c[0] === 'comment'), false);
  }
});

test('only a Ready to load proposal loads: anything else is refused before any branch; a dry run refuses only loading or done', async () => {
  for (const [status, option] of [['draft', 'Initial draft'], ['proposed', 'Proposed'], ['verifying', 'Preprocessing'], ['revision', 'Needs revision'], ['loading', 'Loading in progress'], ['qa', 'Post Load QA'], ['finalqa', 'Final QA'], ['done', 'Done']]) {
    for (const dryRun of (['draft', 'loading', 'qa', 'finalqa', 'done'].includes(status) ? [false, true] : [false])) {
      const { repo } = setupRepo();
      const git = createGit(repo);
      const ticket = tickets({ status });
      await assert.rejects(loadProposal({ git, ticket, repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'GCA_000001.1', dryRun }),
        dryRun
          ? new RegExp(`The proposal's ticket https://r/issues/41 is at "${option}"; a dry run needs "Proposed", "Preprocessing", "Ready to load" or "Needs revision"`)
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
  await assert.rejects(loadProposal({ git, ticket, repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'GCA_000001.1' }), /has no option "Ready to load"/);
  assert.equal(git.branchExists('load/GCA_000001.1'), false);
  assert.equal(ticket.calls.some(c => c[0] === 'setStatus' || c[0] === 'comment'), false);
  const ok = tickets();
  await loadProposal({ git: createGit(repo, { exec: ghStub().exec }), ticket: ok, repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'GCA_000001.1' });
  assert.ok(ok.projectChecks >= 1);
});

test('a load without a ticket is refused: the build lives on the ticket', async () => {
  const { repo } = setupRepo();
  editOnMaster(repo, () => setManifestFields(repo, 'GCA_000001.1', { ticket: undefined }), 'drop ticket');
  await assert.rejects(checkLoadPreconditions({ git: createGit(repo), ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'GCA_000001.1' }),
    /Proposal GCA_000001\.1 has no ticket, so it has no build/);
});

test('the milestone is the release, not the branch: a build 03 proposal dry-runs on rebuild02', async () => {
  const { repo } = setupRepo();
  const result = await loadProposal({ git: createGit(repo), ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'PRJNA000002', dryRun: true });
  assert.equal(result.dryRun, true);
  assert.equal(result.presenterNames.length, 1);
});

test('a load without a rebuild branch is refused before anything is read', async () => {
  const { repo } = setupRepo();
  for (const rebuildBranch of [undefined, 'master', 'build73', 'rebuild']) {
    await assert.rejects(checkLoadPreconditions({ git: createGit(repo), ticket: tickets(), repoPath: repo, rebuildBranch, accession: 'GCA_000001.1' }),
      /rebuildBranch must name a rebuild branch \(rebuildRR\); got "/);
  }
});

// --- dataset entry and loading artifacts --------------------------------------

const DELIVERY = 'FungiDB/tfakST1/rnaSeq/Doe_heat_shock_2024/2024-05-01/final';

/** PRJNA000002 moved onto build 02 with a ticket, so it loads into rebuild02. */
function rnaOnRebuild(t) {
  const { repo, root } = setupRepo();
  editOnMaster(repo, () => setManifestFields(repo, 'PRJNA000002', ticket42), 'PRJNA000002 into build 02');
  const deliveryBase = mkdtempSync(join(tmpdir(), 'load-delivery-'));
  t.after(() => rmSync(deliveryBase, { recursive: true, force: true }));
  return { repo, root, deliveryBase };
}

test('an rnaseq load adds the dataset entry in the same commit and hands off the artifacts', async (t) => {
  const { repo, deliveryBase } = rnaOnRebuild(t);
  const gh = ghStub({ url: 'https://github.com/VEuPathDB/VEuPathDatasets/pull/21' });
  const git = createGit(repo, { exec: gh.exec });
  const ticket = tickets();
  const result = await loadProposal({ git, ticket, repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'PRJNA000002', deliveryBase });

  const ref = 'origin/load/PRJNA000002';
  const organismFile = git.showFile(ref, 'Datasets/lib/xml/datasets/FungiDB/tfakST1.xml');
  assert.ok(organismFile.includes(readFileSync(join(fixtures, 'proposals/PRJNA000002/expected-dataset.xml'), 'utf-8').trimEnd()));
  assert.match(git.showFile(ref, 'Model/lib/xml/datasetPresenters/FungiDB.xml'), /name="tfakST1_Doe_heat_shock_2024_rnaSeq_RSRC"/);
  assert.equal(git.commitsForPath('rebuild02..origin/load/PRJNA000002', 'Datasets').length, 1);
  assert.equal(git.headSubject(), 'Load PRJNA000002: add tfakST1_Doe_heat_shock_2024_rnaSeq_RSRC to FungiDB, Doe_heat_shock_2024 to tfakST1');

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

test('a load commit holds the presenter and dataset files, and no proposal', async (t) => {
  const { repo, deliveryBase } = rnaOnRebuild(t);
  const gh = ghStub();
  await loadProposal({ git: createGit(repo, { exec: gh.exec }), ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'PRJNA000002', deliveryBase });
  assert.deepEqual(loadCommitFiles(repo), ['Datasets/lib/xml/datasets/FungiDB/tfakST1.xml', 'Model/lib/xml/datasetPresenters/FungiDB.xml']);
});

test('a contact the proposal added on master arrives with the load commit', async (t) => {
  const { repo, deliveryBase } = rnaOnRebuild(t);
  const contacts = join(repo, CONTACTS_RELATIVE_PATH);
  editOnMaster(repo, () => {
    writeFileSync(contacts, readFileSync(contacts, 'utf-8').replace('</contacts>', '  <contact>\n    <contactId>new.person</contactId>\n    <name>New Person</name>\n  </contact>\n</contacts>'));
    setManifestFields(repo, 'PRJNA000002', { contacts: { primary: 'new.person', additional: [] } });
  }, 'proposal with a new contact');
  const gh = ghStub();
  await loadProposal({ git: createGit(repo, { exec: gh.exec }), ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'PRJNA000002', deliveryBase });
  const master = execFileSync('git', ['-C', repo, 'show', `origin/master:${CONTACTS_RELATIVE_PATH}`], { encoding: 'utf-8' });
  assert.equal(readFileSync(contacts, 'utf-8'), master);
  assert.ok(loadCommitFiles(repo).includes(CONTACTS_RELATIVE_PATH));
});

test('re-loading an accession already on the rebuild branch is refused before any branch, without cherry-picking its earlier commits', async (t) => {
  const { repo, deliveryBase } = rnaOnRebuild(t);
  const first = ghStub();
  await loadProposal({ git: createGit(repo, { exec: first.exec }), ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'PRJNA000002', deliveryBase });
  // The first load merges into rebuild02, which is merged back into master.
  execFileSync('git', ['-C', repo, 'checkout', '-q', 'rebuild02']);
  execFileSync('git', ['-C', repo, 'merge', '-q', '--no-edit', 'load/PRJNA000002']);
  execFileSync('git', ['-C', repo, 'push', '-q']);
  execFileSync('git', ['-C', repo, 'checkout', '-q', 'master']);
  execFileSync('git', ['-C', repo, 'merge', '-q', '--no-edit', 'origin/rebuild02']);
  execFileSync('git', ['-C', repo, 'push', '-q']);
  execFileSync('git', ['-C', repo, 'checkout', '-q', 'rebuild02']);
  execFileSync('git', ['-C', repo, 'branch', '-D', 'load/PRJNA000002']);
  execFileSync('git', ['-C', repo, 'push', '-q', 'origin', '--delete', 'load/PRJNA000002']);
  const second = ghStub();
  await assert.rejects(
    loadProposal({ git: createGit(repo, { exec: second.exec }), ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'PRJNA000002', deliveryBase }),
    /Presenter ".*" already exists in Model\/lib\/xml\/datasetPresenters\/FungiDB\.xml/);
  assert.equal(second.calls.some((a) => a[0] === 'pr' && a[1] === 'create'), false);
});

test('a load is refused before any branch when the organism file already has the name', async (t) => {
  const { repo } = rnaOnRebuild(t);
  const path = join(repo, 'Datasets/lib/xml/datasets/FungiDB/tfakST1.xml');
  writeFileSync(path, readFileSync(path, 'utf-8').replace('Existing_2020', 'Doe_heat_shock_2024'));
  commitAll(repo, 'already loaded');
  const git = createGit(repo);
  await assert.rejects(checkLoadPreconditions({ git, ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'PRJNA000002' }),
    /Datasets\/lib\/xml\/datasets\/FungiDB\/tfakST1\.xml already has a rnaSeqExperiment named "Doe_heat_shock_2024"/);
  assert.equal(git.branchExists('load/PRJNA000002'), false);
});

test('a load is refused before any branch when the organism file is missing', async (t) => {
  const { repo } = rnaOnRebuild(t);
  execFileSync('git', ['-C', repo, 'rm', '-q', 'Datasets/lib/xml/datasets/FungiDB/tfakST1.xml']);
  commitAll(repo, 'organism dropped');
  await assert.rejects(checkLoadPreconditions({ git: createGit(repo), ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'PRJNA000002' }),
    /tfakST1: no organism file FungiDB\/tfakST1\.xml on this branch/);
});

/** PRJNA000002 on rebuild02, aligned to tfakST2 as well, which has its own dataset file. */
function rnaForTwoOrganisms(t) {
  const setup = rnaOnRebuild(t);
  cpSync(join(setup.repo, 'Datasets/lib/xml/datasets/FungiDB/tfakST1.xml'), join(setup.repo, 'Datasets/lib/xml/datasets/FungiDB/tfakST2.xml'));
  commitAll(setup.repo, 'tfakST2 on the build');
  editOnMaster(setup.repo, () => alignTo(join(setup.repo, 'Proposals/PRJNA000002'), [{ abbrev: 'tfakST1' }, { abbrev: 'tfakST2' }], { SAMN1: ['tfakST1', 'tfakST2'], SAMN2: ['tfakST1', 'tfakST2'] }),
    'align to tfakST2 too');
  return setup;
}

const BOTH_PRESENTERS = ['Doe_heat_shock_2024_rnaSeq_RSRC'];

test('an rnaseq load with an additional organism writes each organism its dataset, presenter and delivery', async (t) => {
  const { repo, deliveryBase } = rnaForTwoOrganisms(t);

  const git = createGit(repo, { exec: ghStub({ url: 'https://github.com/x/y/pull/23' }).exec });
  const result = await loadProposal({ git, ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'PRJNA000002', deliveryBase });

  const ref = 'origin/load/PRJNA000002';
  const presenters = git.showFile(ref, 'Model/lib/xml/datasetPresenters/FungiDB.xml');
  assert.match(presenters, /name="Doe_heat_shock_2024_rnaSeq_RSRC"\n\s+datasetNamePattern="%_Doe_heat_shock_2024_rnaSeq_RSRC"/);
  assert.equal(presenters.match(/<templateInjector /g).length, 2);
  for (const org of ['tfakST1', 'tfakST2']) {
    assert.match(git.showFile(ref, `Datasets/lib/xml/datasets/FungiDB/${org}.xml`), /<prop name="name">Doe_heat_shock_2024<\/prop>/);
    assert.ok(existsSync(join(deliveryBase, `FungiDB/${org}/rnaSeq/Doe_heat_shock_2024/2024-05-01/final/samplesheet.csv`)));
    assert.match(result.handoff, new RegExp(`to \`@@manualDeliveryDir@@/FungiDB/${org}/rnaSeq/`));
  }
  assert.deepEqual(result.presenterNames, BOTH_PRESENTERS);
  assert.equal(git.headSubject(),
    'Load PRJNA000002: add Doe_heat_shock_2024_rnaSeq_RSRC to FungiDB, Doe_heat_shock_2024 to tfakST1 tfakST2');
});

test('an rnaseq load archives the proposal in the first organism\'s fromProvider and links the second', async (t) => {
  const { repo, deliveryBase } = rnaForTwoOrganisms(t);
  const result = await loadProposal({ git: createGit(repo, { exec: ghStub().exec }), ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'PRJNA000002', deliveryBase });
  const home = join(deliveryBase, 'FungiDB/tfakST1/rnaSeq/Doe_heat_shock_2024/2024-05-01/fromProvider');
  assert.ok(existsSync(join(home, 'proposal/manifest.json')));
  const second = join(deliveryBase, 'FungiDB/tfakST2/rnaSeq/Doe_heat_shock_2024/2024-05-01/fromProvider');
  assert.ok(lstatSync(second).isSymbolicLink());
  assert.equal(realpathSync(second), realpathSync(home));
  assert.match(result.handoff, /^Proposal archive: `.*tfakST1\/rnaSeq\/Doe_heat_shock_2024\/2024-05-01\/fromProvider` to `@@manualDeliveryDir@@\/FungiDB\/tfakST1\/rnaSeq\/Doe_heat_shock_2024\/2024-05-01\/fromProvider`/m);
});

test('a load whose delivery path does not end in final is refused before any branch', async (t) => {
  const { repo } = rnaOnRebuild(t);
  const classes = join(repo, CLASSES_RELATIVE_PATH);
  writeFileSync(classes, readFileSync(classes, 'utf-8').replace('/${version}/final/ @@dataDir@@/final', '/${version}/data/ @@dataDir@@/final'));
  commitAll(repo, 'delivery no longer ends in final');
  const git = createGit(repo, { exec: ghStub().exec });
  await assert.rejects(loadProposal({ git, ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'PRJNA000002' }), /must end in "final"/);
  assert.equal(git.branchExists('load/PRJNA000002'), false);
});

test('a two-organism load that failed after its commit dry-runs, then resumes with both organisms', async (t) => {
  const { repo, deliveryBase } = rnaForTwoOrganisms(t);
  const flaky = createGit(repo, { exec: ghStub({ url: 'https://github.com/x/y/pull/24', failCreates: 1 }).exec });
  await assert.rejects(loadProposal({ git: flaky, ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'PRJNA000002', deliveryBase }));
  rmSync(join(deliveryBase, 'FungiDB'), { recursive: true, force: true });

  const git = createGit(repo, { exec: ghStub({ url: 'https://github.com/x/y/pull/24' }).exec });
  const dry = await loadProposal({ git, ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'PRJNA000002', dryRun: true, deliveryBase });
  assert.deepEqual(dry.presenterNames, BOTH_PRESENTERS);

  const result = await loadProposal({ git, ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'PRJNA000002', deliveryBase });
  assert.equal(result.resumed, true);
  assert.deepEqual(result.presenterNames, BOTH_PRESENTERS);
  for (const org of ['tfakST1', 'tfakST2']) {
    assert.ok(existsSync(join(deliveryBase, `FungiDB/${org}/rnaSeq/Doe_heat_shock_2024/2024-05-01/final/samplesheet.csv`)));
    assert.match(result.handoff, new RegExp(`^Copy \`.*\` to \`@@manualDeliveryDir@@/FungiDB/${org}/rnaSeq/`, 'm'));
  }
  assert.equal(execFileSync('git', ['-C', repo, 'rev-list', '--count', 'rebuild02..load/PRJNA000002'], { encoding: 'utf-8' }).trim(), '1');
});

test('a two-organism resume that settles an organism differently from its commit is refused', async (t) => {
  const { repo, deliveryBase } = rnaForTwoOrganisms(t);
  cpSync(join(repo, 'Datasets/lib/xml/datasets/FungiDB/tfakST2.xml'), join(repo, 'Datasets/lib/xml/datasets/FungiDB/tfakST3.xml'));
  commitAll(repo, 'tfakST3 is loaded too');
  await assert.rejects(loadProposal({ git: createGit(repo, { exec: ghStub({ failCreates: 1 }).exec }), ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'PRJNA000002', deliveryBase }));

  const git = createGit(repo, { exec: ghStub().exec });
  await assert.rejects(loadProposal({ git, ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'PRJNA000002', deliveryBase, settle: { tfakST2: 'tfakST3' } }),
    /This load was committed with tfakST1 tfakST2; this run settles to tfakST1 tfakST3/);
});

const REVISE = 'Request a revision so the curator chooses another "name" in --overrides.';

test('a two-organism load is refused before any branch when its pattern would match a name in an organism file of another project', async (t) => {
  const { repo } = rnaForTwoOrganisms(t);
  mkdirSync(join(repo, 'Datasets/lib/xml/datasets/ToxoDB'), { recursive: true });
  writeFileSync(join(repo, 'Datasets/lib/xml/datasets/ToxoDB/tgonME49.xml'),
    readFileSync(join(fixtures, 'tfakST1.xml'), 'utf-8').replace(/tfakST1/g, 'tgonME49').replace('Existing_2020', 'X_Doe_heat_shock_2024'));
  commitAll(repo, 'same name in ToxoDB');
  const git = createGit(repo);
  await assert.rejects(checkLoadPreconditions({ git, ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'PRJNA000002' }), (e) => e.message ===
    `Datasets/lib/xml/datasets/ToxoDB/tgonME49.xml on HEAD already has a rnaSeqExperiment named "X_Doe_heat_shock_2024", which the multi-organism presenter's datasetNamePattern "%_Doe_heat_shock_2024_rnaSeq_RSRC" would also match. ${REVISE}`);
  assert.equal(git.branchExists('load/PRJNA000002'), false);
});

test('a load is refused before any branch when the datasetNamePattern of another presenter would match its dataset', async (t) => {
  const { repo } = rnaOnRebuild(t);
  writeFileSync(join(repo, 'Model/lib/xml/datasetPresenters/HostDB.xml'),
    '<datasetPresenters>\n  <datasetPresenter name="heat_shock_2024_rnaSeq_RSRC"\n                    datasetNamePattern="%_heat_shock_2024_rnaSeq_RSRC">\n  </datasetPresenter>\n</datasetPresenters>\n');
  commitAll(repo, 'a multi-organism presenter whose pattern matches');
  const git = createGit(repo);
  await assert.rejects(checkLoadPreconditions({ git, ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'PRJNA000002' }), (e) => e.message ===
    `Model/lib/xml/datasetPresenters/HostDB.xml on HEAD has a presenter with datasetNamePattern "%_heat_shock_2024_rnaSeq_RSRC", which would also match this proposal's dataset tfakST1_Doe_heat_shock_2024_rnaSeq_RSRC. ${REVISE}`);
  assert.equal(git.branchExists('load/PRJNA000002'), false);
});

test('a load is refused before any branch when an additional organism has no dataset file', async (t) => {
  const { repo } = rnaOnRebuild(t);
  editOnMaster(repo, () => setManifestFields(repo, 'PRJNA000002', { organisms: loaded('tfakST1', 'tfakST2') }), 'align to a missing organism');
  const git = createGit(repo);
  await assert.rejects(checkLoadPreconditions({ git, ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'PRJNA000002' }),
    /tfakST2: no organism file FungiDB\/tfakST2\.xml on this branch/);
  assert.equal(git.branchExists('load/PRJNA000002'), false);
});

test('a dry run renders the dataset entry and artifacts but writes nothing', async (t) => {
  const { repo, deliveryBase } = rnaOnRebuild(t);
  const git = createGit(repo);
  const result = await loadProposal({ git, ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'PRJNA000002', dryRun: true, deliveryBase });
  assert.match(result.dataset.xml, /<prop name="name">Doe_heat_shock_2024<\/prop>/);
  assert.ok('samplesheet.csv' in result.dataset.organisms[0].files);
  assert.equal(existsSync(join(deliveryBase, 'FungiDB')), false);
  assert.equal(git.currentBranch(), 'rebuild02');
});

test('a resumed rnaseq load still hands off the artifacts', async (t) => {
  const { repo, deliveryBase } = rnaOnRebuild(t);
  const flaky = createGit(repo, { exec: ghStub({ url: 'https://github.com/x/y/pull/22', failCreates: 1 }).exec });
  await assert.rejects(loadProposal({ git: flaky, ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'PRJNA000002', deliveryBase }));
  rmSync(join(deliveryBase, 'FungiDB'), { recursive: true, force: true });

  const git = createGit(repo, { exec: ghStub({ url: 'https://github.com/x/y/pull/22' }).exec });
  const result = await loadProposal({ git, ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'PRJNA000002', deliveryBase });
  assert.equal(result.resumed, true);
  assert.ok(existsSync(join(deliveryBase, DELIVERY, 'samplesheet.csv')));
  assert.match(result.handoff, /to `@@manualDeliveryDir@@\/FungiDB\/tfakST1\/rnaSeq\/Doe_heat_shock_2024\/2024-05-01\/final\/`/);
});

test('a load is refused before any branch when a curated samplesheet was edited out of agreement', async (t) => {
  const { repo } = rnaOnRebuild(t);
  const path = join(repo, 'Proposals/PRJNA000002/curated/tfakST1/samplesheet.csv');
  editOnMaster(repo, () => writeFileSync(path, readFileSync(path, 'utf-8').replace('SAMN2,', 'SAMN9,')), 'hand edit gone wrong');
  const git = createGit(repo);
  await assert.rejects(checkLoadPreconditions({ git, ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'PRJNA000002' }),
    /Curated artifacts of PRJNA000002 disagree:[\s\S]*only in samplesheet\.csv: SAMN9/);
  assert.equal(git.branchExists('load/PRJNA000002'), false);
});

/** PRJNA000002 on rebuild02 with reads on a server: curator-named files, no SRA metadata. */
function rnaFromServer(t) {
  const setup = rnaOnRebuild(t);
  const dir = join(setup.repo, 'Proposals/PRJNA000002');
  const edit = (rel, fn) => writeFileSync(join(dir, rel), JSON.stringify(fn(JSON.parse(readFileSync(join(dir, rel), 'utf-8'))), null, 2) + '\n');
  editOnMaster(setup.repo, () => {
    edit('curated/PRJNA000002_sample_annotations.json', (a) => ({
      ...a,
      samples: a.samples.map(({ runs, biosample, ...s }) => ({ ...s, files: [{ fastq_1: `${s.sampleId}_R1.fq.gz`, fastq_2: `${s.sampleId}_R2.fq.gz` }] }))
    }));
    edit('curated/dataset.json', (d) => ({ ...d, props: { ...d.props, fromSRA: 'false' }, source: { type: 'server', paths: ['/data/doe'] } }));
    rmSync(join(dir, 'inputs/PRJNA000002_sra_metadata.json'));
    for (const [f, text] of Object.entries(deriveArtifacts(dir))) writeFileSync(join(dir, 'curated', f), text);
  }, 'PRJNA000002 reads on a server');
  return setup;
}

test('an rnaseq load with reads on a server delivers a samplesheet naming the files', async (t) => {
  const { repo, deliveryBase } = rnaFromServer(t);
  const git = createGit(repo, { exec: ghStub({ url: 'https://github.com/x/y/pull/25' }).exec });
  const result = await loadProposal({ git, ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'PRJNA000002', deliveryBase });

  assert.equal(readFileSync(join(deliveryBase, DELIVERY, 'samplesheet.csv'), 'utf-8'),
    'sample,fastq_1,fastq_2\nSAMN1,SAMN1_R1.fq.gz,SAMN1_R2.fq.gz\nSAMN2,SAMN2_R1.fq.gz,SAMN2_R2.fq.gz\n');
  assert.match(git.showFile('origin/load/PRJNA000002', 'Datasets/lib/xml/datasets/FungiDB/tfakST1.xml'), /<prop name="fromSRA">false<\/prop>/);
  assert.match(result.handoff, /Reads: files named in the samplesheet, under: \/data\/doe/);
});

// --- organism settlement ---------------------------------------------------

test('a genome whose abbreviation is already an organism stops before any branch', async () => {
  const { repo } = setupRepo();
  cpSync(join(repo, 'Datasets/lib/xml/datasets/FungiDB/tfakST1.xml'), join(repo, 'Datasets/lib/xml/datasets/FungiDB/tfakST-1.xml'));
  commitAll(repo, 'tfakST-1 already loaded');
  const git = createGit(repo);
  await assert.rejects(checkLoadPreconditions({ git, ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'GCA_000001.1' }),
    /Organism abbreviations need a person before GCA_000001\.1 loads:\n  - tfakST-1: tfakST-1 already names FungiDB\/tfakST-1\.xml on this branch: [^\n]*\nResolve each, then re-run\.$/);
  assert.equal(git.branchExists('load/GCA_000001.1'), false);
});

test('a genome off the convention stops, and loads once a person settles it', async () => {
  const { repo } = setupRepo();
  const organisms = [{ proposedOrganismAbbrev: 'tfakX', source: 'new', project: 'FungiDB', species: 'Testus fakeus', strain: 'ST-1', ncbiTaxonId: '999001' }];
  editOnMaster(repo, () => setManifestFields(repo, 'GCA_000001.1', { organisms }), 'off convention');
  await assert.rejects(checkLoadPreconditions({ git: createGit(repo), ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'GCA_000001.1' }),
    /\n  - tfakX: tfakX differs from the convention tfakST-1 \(a person may decide with --settle tfakX=<abbrev>\)\nResolve each, then re-run\.$/);

  const gh = ghStub({ url: 'https://github.com/VEuPathDB/VEuPathDatasets/pull/12' });
  const git = createGit(repo, { exec: gh.exec });
  const result = await loadProposal({ git, ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'GCA_000001.1', settle: { tfakX: 'tfakST-1' } });
  assert.deepEqual(result.presenterNames, ['tfakST-1_primary_genome_RSRC']);
  assert.deepEqual(result.settled, [{ proposed: 'tfakX', abbrev: 'tfakST-1', notes: ['settled by the loader'] }]);
  const prCreate = gh.calls.find(a => a[0] === 'pr' && a[1] === 'create');
  assert.match(prCreate[prCreate.indexOf('--body') + 1], /^Organism `tfakST-1` \(proposed `tfakX`\): settled by the loader$/m);
});

test('a genome settled away from a taken abbreviation names the conflict in the pull request', async () => {
  const { repo } = setupRepo();
  cpSync(join(repo, 'Datasets/lib/xml/datasets/FungiDB/tfakST1.xml'), join(repo, 'Datasets/lib/xml/datasets/FungiDB/tfakST-1.xml'));
  commitAll(repo, 'tfakST-1 taken');
  const gh = ghStub({ url: 'https://github.com/VEuPathDB/VEuPathDatasets/pull/13' });
  const result = await loadProposal({ git: createGit(repo, { exec: gh.exec }), ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'GCA_000001.1', settle: { 'tfakST-1': 'tfakST-1b' } });
  assert.deepEqual(result.presenterNames, ['tfakST-1b_primary_genome_RSRC']);
  const prCreate = gh.calls.find(a => a[0] === 'pr' && a[1] === 'create');
  assert.match(prCreate[prCreate.indexOf('--body') + 1],
    /^Organism `tfakST-1b` \(proposed `tfakST-1`\): settled by the loader; proposed tfakST-1: tfakST-1 already names FungiDB\/tfakST-1\.xml on this branch/m);
});

test('an rnaseq organism linked to a genome settles to the organism file with its taxon and strain', async (t) => {
  const { repo, deliveryBase } = rnaOnRebuild(t);
  writeFileSync(join(repo, 'Datasets/lib/xml/datasets/FungiDB/tfakST-1b.xml'), readFileSync(join(repo, 'Datasets/lib/xml/datasets/FungiDB/tfakST1.xml'), 'utf-8')
    .replace('<constant name="projectName" value="FungiDB"/>', '<constant name="projectName" value="FungiDB"/>\n  <constant name="ncbiTaxonId" value="999001"/>\n  <constant name="strainAbbrev" value="ST-1"/>'));
  commitAll(repo, 'genome loaded as tfakST-1b');
  editOnMaster(repo, () => {
    setManifestFields(repo, 'PRJNA000002', { organisms: [{ proposedOrganismAbbrev: 'tfakST-1', source: { proposal: 'GCA_000001.1' }, project: 'FungiDB' }] });
    moveArtifacts(repo, 'PRJNA000002', 'tfakST-1');
  }, 'rnaseq linked to the genome');

  const gh = ghStub({ url: 'https://github.com/x/y/pull/24' });
  const git = createGit(repo, { exec: gh.exec });
  const result = await loadProposal({ git, ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'PRJNA000002', deliveryBase });
  assert.deepEqual(result.presenterNames, ['tfakST-1b_Doe_heat_shock_2024_rnaSeq_RSRC']);
  assert.match(git.showFile('origin/load/PRJNA000002', 'Datasets/lib/xml/datasets/FungiDB/tfakST-1b.xml'), /<prop name="name">Doe_heat_shock_2024<\/prop>/);
  const prCreate = gh.calls.find(a => a[0] === 'pr' && a[1] === 'create');
  assert.match(prCreate[prCreate.indexOf('--body') + 1], /^Organism `tfakST-1b` \(proposed `tfakST-1`\): genome GCA_000001\.1 loaded as tfakST-1b$/m);
});

test('an rnaseq organism linked to a genome that is not loaded stops', async (t) => {
  const { repo } = rnaOnRebuild(t);
  editOnMaster(repo, () => setManifestFields(repo, 'PRJNA000002', { organisms: [{ proposedOrganismAbbrev: 'tfakST-1', source: { proposal: 'GCA_000001.1' }, project: 'FungiDB' }] }),
    'linked to an unloaded genome');
  const git = createGit(repo);
  await assert.rejects(checkLoadPreconditions({ git, ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'PRJNA000002' }),
    /genome proposal GCA_000001\.1 \(taxon 999001, strain ST-1\) is not loaded on this branch; load it first/);
  assert.equal(git.branchExists('load/PRJNA000002'), false);
});

/** GCA_000001.1 proposing tfakX, off the convention, so it loads only with --settle. */
function genomeOffConvention() {
  const setup = setupRepo();
  const organisms = [{ proposedOrganismAbbrev: 'tfakX', source: 'new', project: 'FungiDB', species: 'Testus fakeus', strain: 'ST-1', ncbiTaxonId: '999001' }];
  editOnMaster(setup.repo, () => setManifestFields(setup.repo, 'GCA_000001.1', { organisms }), 'off convention');
  return setup;
}

const prBodyOf = (gh) => {
  const prCreate = gh.calls.filter(a => a[0] === 'pr' && a[1] === 'create').pop();
  return prCreate[prCreate.indexOf('--body') + 1];
};

test('a settled genome load that failed after its commit resumes with the same --settle', async () => {
  const { repo } = genomeOffConvention();
  const settle = { tfakX: 'tfakST-1' };
  await assert.rejects(loadProposal({ git: createGit(repo, { exec: ghStub({ failCreates: 1 }).exec }), ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'GCA_000001.1', settle }));

  const gh = ghStub({ url: 'https://github.com/x/y/pull/31' });
  const result = await loadProposal({ git: createGit(repo, { exec: gh.exec }), ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'GCA_000001.1', settle });
  assert.equal(result.resumed, true);
  assert.deepEqual(result.presenterNames, ['tfakST-1_primary_genome_RSRC']);
  assert.match(prBodyOf(gh), /^Presenters: `tfakST-1_primary_genome_RSRC`/m);
  assert.match(prBodyOf(gh), /^Organism `tfakST-1` \(proposed `tfakX`\): settled by the loader$/m);
});

test('a resume that settles differently from its commit is refused before anything is pushed', async () => {
  const { repo } = genomeOffConvention();
  await assert.rejects(loadProposal({ git: createGit(repo, { exec: ghStub({ failCreates: 1 }).exec }), ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'GCA_000001.1', settle: { tfakX: 'tfakST-1' } }));

  const pushes = [];
  const real = createGit(repo, { exec: ghStub().exec });
  const git = { ...real, push: (...args) => { pushes.push(args); return real.push(...args); } };
  await assert.rejects(loadProposal({ git, ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'GCA_000001.1', settle: { tfakX: 'tfakST-1b' } }),
    /This load was committed with tfakST-1_primary_genome_RSRC; this run settles to tfakST-1b_primary_genome_RSRC\. Re-run with the same --settle as the run that committed, or start over: git -C '.*' checkout -f rebuild02 && git -C '.*' branch -D load\/GCA_000001\.1/);
  assert.deepEqual(pushes, []);
});

test('a settled rnaseq load that failed after its commit resumes and delivers under the settled organism', async (t) => {
  const { repo, deliveryBase } = rnaOnRebuild(t);
  editOnMaster(repo, () => {
    setManifestFields(repo, 'PRJNA000002', { organisms: loaded('tfakX') });
    moveArtifacts(repo, 'PRJNA000002', 'tfakX');
  }, 'rnaseq proposes tfakX');
  const settle = { tfakX: 'tfakST1' };
  await assert.rejects(loadProposal({ git: createGit(repo, { exec: ghStub({ failCreates: 1 }).exec }), ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'PRJNA000002', deliveryBase, settle }));
  rmSync(join(deliveryBase, 'FungiDB'), { recursive: true, force: true });

  const gh = ghStub({ url: 'https://github.com/x/y/pull/32' });
  const result = await loadProposal({ git: createGit(repo, { exec: gh.exec }), ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'PRJNA000002', deliveryBase, settle });
  assert.equal(result.resumed, true);
  assert.deepEqual(result.presenterNames, ['tfakST1_Doe_heat_shock_2024_rnaSeq_RSRC']);
  assert.ok(existsSync(join(deliveryBase, DELIVERY, 'samplesheet.csv')));
  assert.match(result.handoff, /to `@@manualDeliveryDir@@\/FungiDB\/tfakST1\/rnaSeq\//);
  assert.match(prBodyOf(gh), /^Organism `tfakST1` \(proposed `tfakX`\): settled by the loader$/m);
});

// --- organism constants (dnaseq ploidy) ---------------------------------------

/** PRJNA000010 curated as propose-dnaseq would, merged on master with ticket 42 (build 02). */
function dnaseqOnRebuild(t) {
  const { repo } = setupRepo();
  editOnMaster(repo, () => {
    const dir = join(repo, 'Proposals', 'PRJNA000010');
    cpSync(join(fixtures, 'proposals/PRJNA000010'), dir, { recursive: true, filter: (p) => !/expected/.test(p) });
    setManifestFields(repo, 'PRJNA000010', ticket42);
    dnaseq.normalizeCurated(dir);
    const curated = (f, text) => { mkdirSync(dirname(join(dir, 'curated', f)), { recursive: true }); writeFileSync(join(dir, 'curated', f), text); };
    curated('presenter.json', JSON.stringify(dnaseq.derivePresenter(dir, { shortDisplayName: 'Tfak WGS', shortAttribution: 'Doe 2025' }), null, 2) + '\n');
    curated('dataset.json', JSON.stringify(dnaseq.deriveDataset(dir, readDatasetClass(repo, 'dnaseqExperiment'), {}), null, 2) + '\n');
    for (const [f, text] of Object.entries(dnaseq.deriveArtifacts(dir))) curated(f, text);
  }, 'PRJNA000010 into build 02');
  const deliveryBase = mkdtempSync(join(tmpdir(), 'load-delivery-'));
  t.after(() => rmSync(deliveryBase, { recursive: true, force: true }));
  return { repo, deliveryBase };
}

const PLOIDY_1 = { tfakST1: { ploidy: '1' } };

test('a dnaseq load into an organism file without ploidy stops until the loader gives one', async (t) => {
  const { repo, deliveryBase } = dnaseqOnRebuild(t);
  const args = { git: createGit(repo), ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'PRJNA000010', deliveryBase };
  await assert.rejects(loadProposal({ ...args, dryRun: true }), /tfakST1 has no ploidy constant; confirm the value with the data loader, then pass --ploidy tfakST1=<N>/);
  const result = await loadProposal({ ...args, dryRun: true, organismConstants: PLOIDY_1 });
  assert.deepEqual(result.dataset.organisms[0].constantsAdded, ['ploidy=1']);
  assert.equal(args.git.branchExists('load/PRJNA000010'), false);
});

test('a dnaseq load commits the ploidy constant with the dataset entry and names it in the pull request', async (t) => {
  const { repo, deliveryBase } = dnaseqOnRebuild(t);
  const gh = ghStub({ url: 'https://github.com/VEuPathDB/VEuPathDatasets/pull/40' });
  const git = createGit(repo, { exec: gh.exec });
  await loadProposal({ git, ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'PRJNA000010', deliveryBase, organismConstants: PLOIDY_1 });
  const organismFile = git.showFile('origin/load/PRJNA000010', 'Datasets/lib/xml/datasets/FungiDB/tfakST1.xml');
  assert.match(organismFile, /<constant name="projectName" value="FungiDB"\/>\n  <constant name="ploidy" value="1"\/>\n/);
  assert.ok(organismFile.includes(readFileSync(join(fixtures, 'proposals/PRJNA000010/expected-dataset.xml'), 'utf-8').trimEnd()));
  assert.match(prBodyOf(gh), /^Organism constants added to `Datasets\/lib\/xml\/datasets\/FungiDB\/tfakST1\.xml`: ploidy=1 \(confirmed by the data loader\)$/m);
});

test('an rnaseq load ignores organism constants it does not require, and warns that --ploidy was not used', async (t) => {
  const { repo, deliveryBase } = rnaOnRebuild(t);
  const result = await loadProposal({ git: createGit(repo), ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'PRJNA000002', dryRun: true, deliveryBase, organismConstants: PLOIDY_1 });
  assert.deepEqual(result.dataset.organisms[0].constantsAdded, []);
  assert.equal(result.dataset.organisms[0].datasetFile, readFileSync(join(repo, 'Datasets/lib/xml/datasets/FungiDB/tfakST1.xml'), 'utf-8'));
  assert.deepEqual(result.warnings, ['--ploidy tfakST1 was not used: bulk-rnaseq requires no ploidy constant']);
});

test('a dnaseq load warns about --ploidy for an organism the proposal does not have', async (t) => {
  const { repo, deliveryBase } = dnaseqOnRebuild(t);
  const result = await loadProposal({ git: createGit(repo), ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'PRJNA000010', dryRun: true, deliveryBase, organismConstants: { ...PLOIDY_1, tfakX: { ploidy: '2' } } });
  assert.deepEqual(result.warnings, ['--ploidy tfakX was not used: tfakX is not an organism of PRJNA000010']);
});

// --- markLoaded ------------------------------------------------------------

/** Loads GCA_000001.1 (ticket 42) and returns what a merged load PR would report. */
async function loadedProposal() {
  const { root, repo, bare } = setupRepo();
  genomeTicket42(repo);
  await loadProposal({ git: createGit(repo, { exec: ghStub().exec }), ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'GCA_000001.1' });
  const headRefOid = execFileSync('git', ['-C', repo, 'rev-parse', 'load/GCA_000001.1'], { encoding: 'utf-8' }).trim();
  const merged = { url: 'https://github.com/VEuPathDB/VEuPathDatasets/pull/11', number: 11, baseRefName: 'rebuild02', headRefOid, body: 'Presenters: ...\nPart of https://r/issues/42' };
  return { root, repo, bare, merged };
}

test('markLoaded refuses a merged load PR that names another ticket', async () => {
  const { repo, merged } = await loadedProposal();
  const older = { ...merged, url: 'https://github.com/VEuPathDB/VEuPathDatasets/pull/3', number: 3, body: 'Presenters: ...\nPart of https://r/issues/7' };
  const ticket = tickets({ status: 'loading' });
  await assert.rejects(markLoaded({ git: createGit(repo, { exec: ghStub({ merged: older }).exec }), ticket, accession: 'GCA_000001.1' }),
    { message: 'The merged pull request https://github.com/VEuPathDB/VEuPathDatasets/pull/3 from load/GCA_000001.1 is not for https://r/issues/42; mark it loaded after this ticket\'s load pull request merges' });
  assert.equal(ticket.calls.some(c => c[0] === 'setStatus' || c[0] === 'comment'), false);
});

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

test('markLoaded finds the ticket on origin/master from any clone', async () => {
  const { root, bare, merged } = await loadedProposal();
  const other = otherClone(root, bare, 'master');
  const ticket = tickets({ status: 'loading' });
  const result = await markLoaded({ git: createGit(other, { exec: ghStub({ merged }).exec }), ticket, accession: 'GCA_000001.1' });
  assert.equal(result.ticket.id, '42');
  assert.deepEqual(ticket.calls.filter(c => c[0] === 'setStatus'), [['setStatus', '42', 'qa']]);
});

test('markLoaded refuses when the proposal is no longer on origin/master', async () => {
  const { repo, merged } = await loadedProposal();
  editOnMaster(repo, () => execFileSync('git', ['-C', repo, 'rm', '-r', '-q', 'Proposals/GCA_000001.1']), 'cleaned');
  const ticket = tickets({ status: 'loading' });
  await assert.rejects(markLoaded({ git: createGit(repo, { exec: ghStub({ merged }).exec }), ticket, accession: 'GCA_000001.1' }),
    /Proposals\/GCA_000001\.1 is not on origin\/master/);
  assert.deepEqual(ticket.calls, []);
});

test('checkOrganisms reports every ready proposal of a build with its settlement and stops', async () => {
  const { repo } = setupRepo();
  cpSync(join(repo, 'Datasets/lib/xml/datasets/FungiDB/tfakST1.xml'), join(repo, 'Datasets/lib/xml/datasets/FungiDB/tfakST-1.xml'));
  commitAll(repo, 'tfakST-1 already loaded');
  const { results, errors } = await checkOrganisms({ git: createGit(repo), ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, build: '02' });
  assert.deepEqual(errors, []);
  assert.deepEqual(results.map((r) => [r.accession, r.stops.length]), [['GCA_000001.1', 1]]);
  assert.match(results[0].stops[0], /tfakST-1 already names FungiDB\/tfakST-1\.xml/);
});

test('checkOrganisms runs only on the rebuild branch, at origin', async () => {
  const { root, repo, bare } = setupRepo();
  const git = createGit(repo);
  git.checkout('master');
  await assert.rejects(checkOrganisms({ git, ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, build: '02' }),
    /Expected to be on rebuild02, but on "master"\. Organisms are checked on rebuild02\..*checkout rebuild02/s);
  git.checkout('rebuild02');
  const other = otherClone(root, bare, 'rebuild02');
  writeFileSync(join(other, 'NOTES'), 'someone else moved the build\n');
  execFileSync('git', ['-C', other, 'add', '-A']);
  execFileSync('git', ['-C', other, 'commit', '-q', '-m', 'advance rebuild02']);
  execFileSync('git', ['-C', other, 'push', '-q']);
  await assert.rejects(checkOrganisms({ git, ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, build: '02' }),
    /rebuild02 is not at origin\/rebuild02; run: git -C '.*' pull/);
});

test('a host and parasite load puts one presenter in the home project and each dataset in its own project', async (t) => {
  const { repo, deliveryBase } = rnaOnRebuild(t);
  mkdirSync(join(repo, 'Datasets/lib/xml/datasets/HostDB'), { recursive: true });
  writeFileSync(join(repo, 'Datasets/lib/xml/datasets/HostDB/hfakH1.xml'),
    readFileSync(join(fixtures, 'tfakST1.xml'), 'utf-8').replace(/tfakST1/g, 'hfakH1').replace('value="FungiDB"', 'value="HostDB"'));
  commitAll(repo, 'host on the build');
  editOnMaster(repo, () => alignTo(join(repo, 'Proposals/PRJNA000002'), [{ abbrev: 'tfakST1' }, { abbrev: 'hfakH1', project: 'HostDB' }], { SAMN1: ['hfakH1'], SAMN2: ['tfakST1', 'hfakH1'] }),
    'host and parasite');

  const git = createGit(repo, { exec: ghStub({ url: 'https://github.com/x/y/pull/31' }).exec });
  const result = await loadProposal({ git, ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'PRJNA000002', deliveryBase });

  const ref = 'origin/load/PRJNA000002';
  const presenters = git.showFile(ref, 'Model/lib/xml/datasetPresenters/FungiDB.xml');
  assert.match(presenters, /<templateInjector projectName="HostDB" datasourceName="hfakH1_Doe_heat_shock_2024_rnaSeq_RSRC"/);
  assert.equal(git.fileExistsOnRef(ref, 'Model/lib/xml/datasetPresenters/HostDB.xml'), false);
  assert.match(git.showFile(ref, 'Datasets/lib/xml/datasets/HostDB/hfakH1.xml'), /<prop name="name">Doe_heat_shock_2024<\/prop>/);
  const sheet = (path) => readFileSync(join(deliveryBase, path, 'samplesheet.csv'), 'utf-8');
  assert.equal(sheet('FungiDB/tfakST1/rnaSeq/Doe_heat_shock_2024/2024-05-01/final'), 'sample,fastq_1,fastq_2\nSAMN2,SRR2,\n');
  assert.equal(sheet('HostDB/hfakH1/rnaSeq/Doe_heat_shock_2024/2024-05-01/final'), 'sample,fastq_1,fastq_2\nSAMN1,SRR1,\nSAMN2,SRR2,\n');
  assert.match(result.prUrl, /pull\/31$/);
  assert.equal(git.headSubject(), 'Load PRJNA000002: add Doe_heat_shock_2024_rnaSeq_RSRC to FungiDB, Doe_heat_shock_2024 to tfakST1 hfakH1');
});

test('a load is refused before any branch when content validation reports an error', async () => {
  const { repo } = setupRepo();
  const git = createGit(repo);
  const failing = async () => [{ validator: 'libraryType', severity: 'error', message: 'OXFORD_NANOPORE (SRR1) is not a short-read platform' }];
  await assert.rejects(loadProposal({ git, ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: failing, accession: 'GCA_000001.1' }),
    /Validation of GCA_000001\.1 failed; request a revision, or fix the validation workspace:\n {2}- ERROR \[libraryType\] OXFORD_NANOPORE/);
  assert.equal(git.branchExists('load/GCA_000001.1'), false);
});

test('validation warnings do not stop a load', async () => {
  const { repo } = setupRepo();
  const warn = async () => [{ validator: 'libraryType', severity: 'warning', message: 'DNBSEQ' }];
  const result = await loadProposal({ git: createGit(repo), ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: warn, accession: 'GCA_000001.1', dryRun: true });
  assert.equal(result.dryRun, true);
});

test('a load without validate is refused', async () => {
  const { repo } = setupRepo();
  await assert.rejects(checkLoadPreconditions({ git: createGit(repo), ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, accession: 'GCA_000001.1' }),
    /validate is required: content validation runs before every load/);
});

test('validation sees the proposal directory and manifest it loads', async () => {
  const { repo } = setupRepo();
  let seen;
  const peek = async ({ proposalDir, manifest }) => { seen = { proposalDir, accession: manifest.accession }; return []; };
  await loadProposal({ git: createGit(repo), ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: peek, accession: 'GCA_000001.1', dryRun: true });
  assert.equal(seen.accession, 'GCA_000001.1');
  assert.ok(seen.proposalDir.endsWith(join('Proposals', 'GCA_000001.1')));
  assert.equal(seen.proposalDir.startsWith(repo), false);
});
