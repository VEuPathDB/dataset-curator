import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, existsSync, readFileSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createGit } from '../shared/scripts/lib/git-ops.js';
import { startProposal, writeProposal, publishProposal } from '../shared/scripts/lib/proposal-ops.js';
import { readOnRef } from '../shared/scripts/lib/manifest.js';
import { fixtures, initRepo, otherClone, stubTicket, stubGh } from './helpers.js';

const setupRepo = () => initRepo('proposal-ops-');

const manifestInput = {
  accession: 'GCA_000001.1', datasetType: 'genome-assembly', project: 'FungiDB',
  organismAbbrev: 'tfakST1', targetBuild: '02',
  contacts: { primary: 'jane.doe', additional: ['ravi.kumar'] },
  skill: { name: 'propose-genome-assembly', version: '2.0.0' }
};

const plantedManifest = {
  ...manifestInput, schemaVersion: 1, curator: 'someone@apidb.org',
  createdAt: '2026-09-18T00:00:00.000Z'
};

const TICKET = { system: 'redmine', id: '42', url: 'https://r/issues/42' };

/** Commits a manifest for accession onto master in `repo` and pushes it. */
function plantProposalOnMaster(repo, manifest, accession = manifest.accession) {
  const dir = join(repo, 'Proposals', accession);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  execFileSync('git', ['-C', repo, 'add', '.']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', `plant ${accession}`]);
  execFileSync('git', ['-C', repo, 'push', '-q']);
}

/** Copies a fetch fixture into a scratch dir and returns its path. */
function inputFile(root, name = 'GCA_000001.1_dataset_report.json') {
  const tmp = join(root, 'tmp');
  mkdirSync(tmp, { recursive: true });
  const dest = join(tmp, name);
  cpSync(join(fixtures, 'proposals/GCA_000001.1/inputs', name), dest);
  return dest;
}

/** The fewest inputs a genome proposal needs for a complete presenter. */
const genomeInputs = (root) => [inputFile(root), inputFile(root, 'PRJNA000001_bioproject.json')];

// --- startProposal ---------------------------------------------------------

test('startProposal refuses when the tree is dirty', async () => {
  const { repo } = setupRepo();
  const git = createGit(repo);
  writeFileSync(join(repo, 'junk'), 'x');
  await assert.rejects(startProposal({ git, ticket: stubTicket(), accession: 'X' }), /working tree is not clean/);
});

test('startProposal refuses when not on master and names the branch', async () => {
  const { repo } = setupRepo();
  const git = createGit(repo);
  git.createBranch('scratch', 'master');
  await assert.rejects(
    startProposal({ git, ticket: stubTicket(), accession: 'GCA_000001.1' }),
    /Expected to be on master, but on "scratch".*checkout master/s
  );
});

test('startProposal reports a detached HEAD by name', async () => {
  const { repo } = setupRepo();
  const git = createGit(repo);
  execFileSync('git', ['-C', repo, 'checkout', '-q', '--detach', 'HEAD']);
  await assert.rejects(
    startProposal({ git, ticket: stubTicket(), accession: 'GCA_000001.1' }),
    /but on "detached HEAD"/
  );
});

test('startProposal refuses when master is behind origin', async () => {
  const { root, repo, bare } = setupRepo();
  const other = otherClone(root, bare);
  writeFileSync(join(other, 'newfile'), 'x');
  execFileSync('git', ['-C', other, 'add', '.']);
  execFileSync('git', ['-C', other, 'commit', '-q', '-m', 'ahead']);
  execFileSync('git', ['-C', other, 'push', '-q']);
  await assert.rejects(
    startProposal({ git: createGit(repo), ticket: stubTicket(), accession: 'GCA_000001.1' }),
    /behind origin\/master.*pull/s
  );
});

test('startProposal refuses when the local proposal branch exists', async () => {
  const { repo } = setupRepo();
  const git = createGit(repo);
  git.createBranch('proposal/GCA_000001.1', 'master');
  git.checkout('master');
  await assert.rejects(
    startProposal({ git, ticket: stubTicket(), accession: 'GCA_000001.1' }),
    /branch -D proposal\/GCA_000001\.1/
  );
});

test('startProposal refuses when the proposal branch exists on origin', async () => {
  const { root, repo, bare } = setupRepo();
  const other = otherClone(root, bare);
  execFileSync('git', ['-C', other, 'checkout', '-q', '-b', 'proposal/GCA_000001.1']);
  execFileSync('git', ['-C', other, 'push', '-q', '-u', 'origin', 'proposal/GCA_000001.1']);
  await assert.rejects(
    startProposal({ git: createGit(repo), ticket: stubTicket(), accession: 'GCA_000001.1' }),
    /push origin --delete proposal\/GCA_000001\.1/
  );
});

test('startProposal creates the branch for a new accession', async () => {
  const { repo } = setupRepo();
  const git = createGit(repo);
  const result = await startProposal({ git, ticket: stubTicket(), accession: 'GCA_000001.1' });
  assert.equal(result.mode, 'new');
  assert.equal(git.currentBranch(), 'proposal/GCA_000001.1');
});

test('startProposal on an existing proposal consults the ticket', async () => {
  const { repo } = setupRepo();
  plantProposalOnMaster(repo, { ...plantedManifest, ticket: TICKET });

  const blocked = stubTicket({ status: 'loading' });
  await assert.rejects(startProposal({ git: createGit(repo), ticket: blocked, accession: 'GCA_000001.1' }), /status is "loading"/);

  const ok = await startProposal({ git: createGit(repo), ticket: stubTicket({ status: 'proposed' }), accession: 'GCA_000001.1' });
  assert.equal(ok.mode, 'update');
  assert.equal(ok.existingTicket.id, '42');
});

test('startProposal stops on a ticketless existing proposal unless forced', async () => {
  const { repo } = setupRepo();
  plantProposalOnMaster(repo, plantedManifest);
  const git = createGit(repo);
  await assert.rejects(
    startProposal({ git, ticket: stubTicket(), accession: 'GCA_000001.1' }),
    /has no ticket, so its status cannot be checked.*--force-update/s
  );
  assert.equal(git.branchExists('proposal/GCA_000001.1'), false);

  const forced = await startProposal({ git, ticket: stubTicket(), accession: 'GCA_000001.1', forceUpdate: true });
  assert.equal(forced.mode, 'update');
  assert.equal(git.currentBranch(), 'proposal/GCA_000001.1');
});

// --- writeProposal ---------------------------------------------------------

test('writeProposal copies files and writes a valid manifest', async () => {
  const { repo, root } = setupRepo();
  const git = createGit(repo);
  await startProposal({ git, ticket: stubTicket(), accession: 'GCA_000001.1' });
  const tmp = join(root, 'tmp'); mkdirSync(tmp);
  const src = join(fixtures, 'proposals/GCA_000001.1/inputs');
  for (const f of ['GCA_000001.1_dataset_report.json', 'PRJNA000001_bioproject.json', 'GCA_000001.1_pubmed.json']) {
    cpSync(join(src, f), join(tmp, f));
  }
  const { dir } = await writeProposal({
    git, repoPath: repo, manifestInput, curator: 'someone@apidb.org',
    inputs: [join(tmp, 'GCA_000001.1_dataset_report.json'), join(tmp, 'PRJNA000001_bioproject.json'), join(tmp, 'GCA_000001.1_pubmed.json')],
    curated: []
  });
  assert.equal(dir, join(repo, 'Proposals/GCA_000001.1'));
  assert.ok(existsSync(join(dir, 'inputs/GCA_000001.1_dataset_report.json')));
  const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf-8'));
  assert.equal(m.schemaVersion, 1);
  assert.equal(m.curator, 'someone@apidb.org');
  assert.equal(m.ticket, undefined);
  assert.ok(!Number.isNaN(Date.parse(m.createdAt)));
});

test('writeProposal rejects unknown contacts', async () => {
  const { repo, root } = setupRepo();
  const git = createGit(repo);
  await startProposal({ git, ticket: stubTicket(), accession: 'GCA_000001.1' });
  await assert.rejects(writeProposal({
    git, repoPath: repo, curator: 'someone@apidb.org', inputs: genomeInputs(root), curated: [],
    manifestInput: { ...manifestInput, contacts: { primary: 'nobody', additional: [] } }
  }), /nobody.*not found in allContacts/);
});

test('writeProposal refuses when not on the proposal branch', async () => {
  const { repo, root } = setupRepo();
  const git = createGit(repo);
  await assert.rejects(writeProposal({
    git, repoPath: repo, manifestInput, curator: 'someone@apidb.org',
    inputs: genomeInputs(root), curated: []
  }), /Expected to be on proposal\/GCA_000001\.1[\s\S]*start-proposal\.js GCA_000001\.1/);
  assert.equal(existsSync(join(repo, 'Proposals/GCA_000001.1')), false);
});

test('writeProposal lists every missing input and leaves the existing proposal alone', async () => {
  const { repo, root } = setupRepo();
  const git = createGit(repo);
  await startProposal({ git, ticket: stubTicket(), accession: 'GCA_000001.1' });
  const good = genomeInputs(root);
  const { dir } = await writeProposal({ git, repoPath: repo, manifestInput, curator: 'someone@apidb.org', inputs: good, curated: [] });
  const before = readFileSync(join(dir, 'manifest.json'), 'utf-8');

  await assert.rejects(writeProposal({
    git, repoPath: repo, manifestInput, curator: 'someone@apidb.org',
    inputs: [...good, join(root, 'tmp/missing-a.json')], curated: [join(root, 'tmp/missing-b.json')]
  }), (err) => {
    assert.match(err.message, /missing-a\.json/);
    assert.match(err.message, /missing-b\.json/);
    return true;
  });
  assert.equal(readFileSync(join(dir, 'manifest.json'), 'utf-8'), before);
  assert.ok(existsSync(join(dir, 'inputs/GCA_000001.1_dataset_report.json')));
});

test('writeProposal carries the ticket recorded on origin/master into the new manifest', async () => {
  const { repo, root } = setupRepo();
  plantProposalOnMaster(repo, { ...plantedManifest, ticket: TICKET });
  const git = createGit(repo);
  await startProposal({ git, ticket: stubTicket(), accession: 'GCA_000001.1' });
  const { dir } = await writeProposal({ git, repoPath: repo, manifestInput, curator: 'someone@apidb.org', inputs: genomeInputs(root), curated: [] });
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf-8')).ticket, TICKET);
});

const rnaManifestInput = {
  ...manifestInput, accession: 'PRJNA000003', datasetType: 'bulk-rnaseq',
  contacts: { primary: 'jane.doe', additional: [] }, skill: { name: 'propose-bulk-rnaseq', version: '2.0.0' }
};

/** RNA-seq inputs and sample annotations in a scratch dir, plus an overrides file when given. */
function rnaFiles(root, overrides) {
  const tmp = join(root, 'tmp');
  mkdirSync(tmp, { recursive: true });
  const src = join(fixtures, 'proposals/PRJNA000003/inputs');
  const inputs = ['PRJNA000003_sra_metadata.json', 'GSE0002_family.xml'].map((f) => {
    cpSync(join(src, f), join(tmp, f));
    return join(tmp, f);
  });
  const annotations = join(tmp, 'PRJNA000003_sample_annotations.json');
  cpSync(join(fixtures, 'proposals/PRJNA000003/curated/PRJNA000003_sample_annotations.json'), annotations);
  if (!overrides) return { inputs, curated: [annotations] };
  const path = join(tmp, 'overrides.json');
  writeFileSync(path, JSON.stringify(overrides));
  return { inputs, curated: [annotations], overrides: path };
}

test('writeProposal derives curated/presenter.json with the curator overrides folded in', async () => {
  const { repo, root } = setupRepo();
  const git = createGit(repo);
  await startProposal({ git, ticket: stubTicket(), accession: 'PRJNA000003' });
  const { dir, presenter } = await writeProposal({
    git, repoPath: repo, manifestInput: rnaManifestInput, curator: 'someone@apidb.org',
    ...rnaFiles(root, { presenter: { shortDisplayName: 'Cold shock', shortAttribution: 'Roe et al.' } })
  });
  const onDisk = JSON.parse(readFileSync(join(dir, 'curated/presenter.json'), 'utf-8'));
  assert.deepEqual(onDisk, presenter);
  assert.equal(onDisk.shortDisplayName, 'Cold shock');
  assert.equal(onDisk.name, undefined);
  assert.equal(existsSync(join(dir, 'curated/overrides.json')), false);
});

test('writeProposal refuses an incomplete presenter and leaves the existing proposal alone', async () => {
  const { repo, root } = setupRepo();
  const git = createGit(repo);
  await startProposal({ git, ticket: stubTicket(), accession: 'PRJNA000003' });
  const complete = rnaFiles(root, { presenter: { shortDisplayName: 'Cold shock', shortAttribution: 'Roe et al.' } });
  const { dir } = await writeProposal({ git, repoPath: repo, manifestInput: rnaManifestInput, curator: 'someone@apidb.org', ...complete });
  const before = readFileSync(join(dir, 'curated/presenter.json'), 'utf-8');

  await assert.rejects(writeProposal({
    git, repoPath: repo, manifestInput: rnaManifestInput, curator: 'someone@apidb.org', inputs: complete.inputs, curated: complete.curated
  }), /Invalid presenter for PRJNA000003 \(set the missing fields under "presenter" in --overrides\):\n  - shortDisplayName is required and is empty\n  - shortAttribution is required and is empty/);
  assert.equal(readFileSync(join(dir, 'curated/presenter.json'), 'utf-8'), before);
});

test('writeProposal records identity: derived name and version unless overridden', async () => {
  const { repo, root } = setupRepo();
  const git = createGit(repo);
  await startProposal({ git, ticket: stubTicket(), accession: 'PRJNA000003' });
  const presenter = { shortDisplayName: 'Cold shock', shortAttribution: 'Roe et al.' };
  const derived = await writeProposal({
    git, repoPath: repo, manifestInput: rnaManifestInput, curator: 'someone@apidb.org', ...rnaFiles(root, { presenter })
  });
  assert.deepEqual([derived.manifest.datasetClass, derived.manifest.name, derived.manifest.version], ['rnaSeqExperiment', 'Doe_2024', '2024-05-01']);
  assert.deepEqual(Object.keys(derived.manifest), [
    'schemaVersion', 'accession', 'datasetType', 'project', 'organismAbbrev', 'targetBuild',
    'datasetClass', 'name', 'version', 'contacts', 'curator', 'createdAt', 'skill'
  ]);

  const chosen = await writeProposal({
    git, repoPath: repo, manifestInput: rnaManifestInput, curator: 'someone@apidb.org',
    ...rnaFiles(root, { name: 'Doe_cold_shock_2024', version: '2024-06-02', presenter })
  });
  const onDisk = JSON.parse(readFileSync(join(chosen.dir, 'manifest.json'), 'utf-8'));
  assert.deepEqual([onDisk.name, onDisk.version], ['Doe_cold_shock_2024', '2024-06-02']);
});

test('writeProposal asks for a version it cannot derive', async () => {
  const { repo, root } = setupRepo();
  const git = createGit(repo);
  await startProposal({ git, ticket: stubTicket(), accession: 'PRJNA000003' });
  const { inputs, curated, overrides } = rnaFiles(root, { presenter: { shortDisplayName: 'x', shortAttribution: 'y' } });
  await assert.rejects(writeProposal({
    git, repoPath: repo, manifestInput: rnaManifestInput, curator: 'someone@apidb.org', curated,
    inputs: inputs.filter((f) => !f.endsWith('_family.xml')), overrides
  }), /No name or version could be derived for PRJNA000003; set "name" and "version" in the --overrides file/);
  assert.equal(existsSync(join(repo, 'Proposals/PRJNA000003')), false);
});

test('writeProposal refuses a name built from the accession', async () => {
  const { repo, root } = setupRepo();
  const git = createGit(repo);
  await startProposal({ git, ticket: stubTicket(), accession: 'PRJNA000003' });
  await assert.rejects(writeProposal({
    git, repoPath: repo, manifestInput: rnaManifestInput, curator: 'someone@apidb.org',
    ...rnaFiles(root, { name: 'PRJNA000003', presenter: { shortDisplayName: 'x', shortAttribution: 'y' } })
  }), /name "PRJNA000003" must be readable, not built from the accession/);
});

const coldShock = { name: 'Doe_cold_shock_2024', presenter: { shortDisplayName: 'Cold shock', shortAttribution: 'Roe et al.' } };

test('writeProposal derives curated/dataset.json for a type with a dataset class', async () => {
  const { repo, root } = setupRepo();
  const git = createGit(repo);
  await startProposal({ git, ticket: stubTicket(), accession: 'PRJNA000003' });
  const { dir, dataset } = await writeProposal({
    git, repoPath: repo, manifestInput: rnaManifestInput, curator: 'someone@apidb.org', ...rnaFiles(root, coldShock)
  });
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'curated/dataset.json'), 'utf-8')), dataset);
  assert.deepEqual(dataset.source, { type: 'sra' });
  assert.equal(dataset.props.isStrandSpecific, 'true');
});

test('writeProposal refuses a name the organism file already has', async () => {
  const { repo, root } = setupRepo();
  const git = createGit(repo);
  await startProposal({ git, ticket: stubTicket(), accession: 'PRJNA000003' });
  await assert.rejects(writeProposal({
    git, repoPath: repo, manifestInput: rnaManifestInput, curator: 'someone@apidb.org', ...rnaFiles(root, { ...coldShock, name: 'Existing_2020' })
  }), /Datasets\/lib\/xml\/datasets\/FungiDB\/tfakST1\.xml already has a rnaSeqExperiment named "Existing_2020"/);
});

test('writeProposal refuses a name another proposal on master already uses', async () => {
  const { repo, root } = setupRepo();
  plantProposalOnMaster(repo, { ...plantedManifest, accession: 'PRJNA000009', datasetType: 'bulk-rnaseq',
    datasetClass: 'rnaSeqExperiment', name: 'Doe_cold_shock_2024', version: '2024-05-01' });
  const git = createGit(repo);
  await startProposal({ git, ticket: stubTicket(), accession: 'PRJNA000003' });
  await assert.rejects(writeProposal({
    git, repoPath: repo, manifestInput: rnaManifestInput, curator: 'someone@apidb.org', ...rnaFiles(root, coldShock)
  }), /Proposal PRJNA000009 on master already uses the name "Doe_cold_shock_2024" for tfakST1/);
});

test('writeProposal refuses an organism with no dataset file in the project', async () => {
  const { repo, root } = setupRepo();
  const git = createGit(repo);
  await startProposal({ git, ticket: stubTicket(), accession: 'PRJNA000003' });
  await assert.rejects(writeProposal({
    git, repoPath: repo, manifestInput: { ...rnaManifestInput, organismAbbrev: 'nopeST1' }, curator: 'someone@apidb.org', ...rnaFiles(root, coldShock)
  }), /Datasets\/lib\/xml\/datasets\/FungiDB\/nopeST1\.xml does not exist; is nopeST1 a FungiDB organism\?/);
});

test('writeProposal refuses a hand-written dataset.json among the curated files', async () => {
  const { repo, root } = setupRepo();
  const git = createGit(repo);
  await startProposal({ git, ticket: stubTicket(), accession: 'PRJNA000003' });
  const handWritten = join(root, 'dataset.json');
  writeFileSync(handWritten, '{}');
  const files = rnaFiles(root, coldShock);
  await assert.rejects(writeProposal({
    git, repoPath: repo, manifestInput: rnaManifestInput, curator: 'someone@apidb.org', ...files, curated: [...files.curated, handWritten]
  }), /dataset\.json is derived by this script; pass curator edits with --overrides/);
});

test('writeProposal refuses a hand-written presenter.json among the curated files', async () => {
  const { repo, root } = setupRepo();
  const git = createGit(repo);
  await startProposal({ git, ticket: stubTicket(), accession: 'PRJNA000003' });
  const handWritten = join(root, 'presenter.json');
  writeFileSync(handWritten, '{}');
  await assert.rejects(writeProposal({
    git, repoPath: repo, manifestInput: rnaManifestInput, curator: 'someone@apidb.org', inputs: rnaFiles(root).inputs, curated: [handWritten]
  }), /presenter\.json is derived by this script; pass curator edits with --overrides/);
  assert.equal(existsSync(join(repo, 'Proposals/PRJNA000003')), false);
});

// --- publishProposal -------------------------------------------------------

/** start + write a proposal on its branch, ready to publish. */
async function preparedProposal({ planted, gh = stubGh() } = {}) {
  const { repo, root, bare } = setupRepo();
  if (planted) plantProposalOnMaster(repo, planted);
  const git = createGit(repo, { exec: gh.exec });
  await startProposal({ git, ticket: stubTicket(), accession: 'GCA_000001.1' });
  await writeProposal({ git, repoPath: repo, manifestInput, curator: 'someone@apidb.org', inputs: genomeInputs(root), curated: [] });
  return { repo, root, bare, git, gh };
}

/** The --body passed to the one gh pr create call. */
const prBody = (gh) => {
  const args = gh.calls.find(a => a[0] === 'pr' && a[1] === 'create');
  return args[args.indexOf('--body') + 1];
};

test('publishProposal creates the ticket, commits it in the manifest, opens a PR citing it', async () => {
  const { repo, git, gh } = await preparedProposal();
  const ticket = stubTicket();
  const result = await publishProposal({ git, ticket, repoPath: repo, accession: 'GCA_000001.1' });

  assert.equal(result.prUrl, 'https://github.com/VEuPathDB/VEuPathDatasets/pull/7');
  assert.equal(result.ticket.id, '42');
  assert.equal(result.resumed, false);
  assert.equal(git.isClean(), true);
  assert.equal(gh.calls[0][0], 'auth');
  assert.equal(gh.creates(), 1);
  assert.equal(ticket.calls[0][0], 'create');
  assert.equal(ticket.calls[0][3], manifestInput.targetBuild);
  assert.match(prBody(gh), /^Part of https:\/\/r\/issues\/42\n/);
  assert.deepEqual(ticket.notes, ['Pull request: https://github.com/VEuPathDB/VEuPathDatasets/pull/7']);
  const onRemote = JSON.parse(git.showFile('origin/proposal/GCA_000001.1', 'Proposals/GCA_000001.1/manifest.json'));
  assert.deepEqual(onRemote.ticket, TICKET);
  assert.equal(git.commitsForPath('origin/proposal/GCA_000001.1', 'Proposals/GCA_000001.1').length, 1);
});

test('publishProposal on an update comments instead of creating a ticket', async () => {
  const { repo, git, gh } = await preparedProposal({ planted: { ...plantedManifest, ticket: TICKET } });
  const ticket = stubTicket();
  const result = await publishProposal({ git, ticket, repoPath: repo, accession: 'GCA_000001.1' });
  assert.equal(result.ticket.id, '42');
  assert.equal(ticket.calls[0][0], 'comment');
  assert.match(ticket.notes[0], /^Proposal updated\. Pull request: .*pull\/7/);
  assert.equal(ticket.created(), 0);
  assert.match(prBody(gh), /^Part of https:\/\/r\/issues\/42\n/);
});

test('publishProposal refuses off the proposal branch and names the cleanup', async () => {
  const { repo, git } = await preparedProposal();
  execFileSync('git', ['-C', repo, 'stash', '-q', '-u']);
  git.checkout('master');
  await assert.rejects(
    publishProposal({ git, ticket: stubTicket(), repoPath: repo, accession: 'GCA_000001.1' }),
    /checkout -- Proposals\/GCA_000001\.1 Model\/lib\/xml\/datasetPresenters\/contacts\/allContacts\.xml/
  );
});

test('publishProposal stops when there is nothing to publish', async () => {
  const { repo } = setupRepo();
  plantProposalOnMaster(repo, { ...plantedManifest, ticket: TICKET });
  const gh = stubGh();
  const git = createGit(repo, { exec: gh.exec });
  // branch cut from master with the proposal already on it and nothing rewritten
  await startProposal({ git, ticket: stubTicket(), accession: 'GCA_000001.1' });
  await assert.rejects(
    publishProposal({ git, ticket: stubTicket(), repoPath: repo, accession: 'GCA_000001.1' }),
    /[Nn]othing to publish/
  );
});

test('publishProposal stops when gh is not authenticated, before committing', async () => {
  const { repo, root } = setupRepo();
  const exec = (cmd, args, opts) => {
    if (cmd === 'gh') throw new Error('gh: You are not logged into any GitHub hosts');
    return execFileSync(cmd, args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  };
  const git = createGit(repo, { exec });
  await startProposal({ git, ticket: stubTicket(), accession: 'GCA_000001.1' });
  await writeProposal({ git, repoPath: repo, manifestInput, curator: 'someone@apidb.org', inputs: genomeInputs(root), curated: [] });
  await assert.rejects(
    publishProposal({ git, ticket: stubTicket(), repoPath: repo, accession: 'GCA_000001.1' }),
    /gh is not authenticated; run: gh auth login/
  );
  assert.equal(git.aheadOf('origin/master'), 0);
});

test('re-running publishProposal resumes without a second PR or ticket', async () => {
  const { repo, git, gh } = await preparedProposal();
  const ticket = stubTicket();
  await publishProposal({ git, ticket, repoPath: repo, accession: 'GCA_000001.1' });
  const again = await publishProposal({ git, ticket, repoPath: repo, accession: 'GCA_000001.1' });

  assert.equal(again.resumed, true);
  assert.equal(again.prUrl, 'https://github.com/VEuPathDB/VEuPathDatasets/pull/7');
  assert.equal(again.ticket.id, '42');
  assert.equal(gh.creates(), 1);
  assert.equal(ticket.calls.filter(c => c[0] === 'create').length, 1);
  assert.equal(ticket.comments(), 1);
  assert.equal(git.aheadOf('origin/master'), 1);
});

test('publishProposal after gh pr create fails reuses the pull request it opened', async () => {
  const { repo, git, gh } = await preparedProposal({ gh: stubGh({ failCreates: 1 }) });
  const ticket = stubTicket();

  await assert.rejects(publishProposal({ git, ticket, repoPath: repo, accession: 'GCA_000001.1' }));
  assert.equal(ticket.created(), 1);
  assert.equal(ticket.comments(), 0);

  const result = await publishProposal({ git, ticket, repoPath: repo, accession: 'GCA_000001.1' });
  assert.equal(result.resumed, true);
  assert.equal(result.prUrl, 'https://github.com/VEuPathDB/VEuPathDatasets/pull/7');
  assert.equal(gh.creates(), 1);
  assert.equal(ticket.created(), 1);
  assert.equal(ticket.comments(), 1);
  assert.equal(git.aheadOf('origin/master'), 1);
  assert.deepEqual(readOnRef(git, 'origin/proposal/GCA_000001.1', 'GCA_000001.1').ticket, TICKET);
});

test('publishProposal after the ticket system fails creates exactly one ticket', async () => {
  const { repo, git, gh } = await preparedProposal();
  const ticket = stubTicket({ failCreates: 1 });

  await assert.rejects(publishProposal({ git, ticket, repoPath: repo, accession: 'GCA_000001.1' }), /ticket system unavailable/);
  assert.equal(gh.creates(), 0);
  assert.equal(git.aheadOf('origin/master'), 0);

  const result = await publishProposal({ git, ticket, repoPath: repo, accession: 'GCA_000001.1' });
  assert.equal(result.ticket.id, '42');
  assert.equal(result.resumed, false);
  assert.equal(ticket.created(), 1);
  assert.equal(ticket.comments(), 1);
  assert.equal(gh.creates(), 1);
  assert.equal(git.aheadOf('origin/master'), 1);
  assert.deepEqual(readOnRef(git, 'origin/proposal/GCA_000001.1', 'GCA_000001.1').ticket, TICKET);
});

test('publishProposal amends rather than stacking a commit when the manifest changed after the push', async () => {
  const { repo, git } = await preparedProposal();
  const ticket = stubTicket();
  await publishProposal({ git, ticket, repoPath: repo, accession: 'GCA_000001.1' });

  // A run that died between writing the manifest and amending leaves the tree
  // dirty on a branch that is already one commit ahead.
  const manifestPath = join(repo, 'Proposals/GCA_000001.1/manifest.json');
  const m = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  writeFileSync(manifestPath, JSON.stringify({ ...m, createdAt: '2026-09-19T12:00:00.000Z' }, null, 2) + '\n');

  await publishProposal({ git, ticket, repoPath: repo, accession: 'GCA_000001.1' });
  assert.equal(git.aheadOf('origin/master'), 1);
  assert.equal(git.isClean(), true);
  const onRemote = readOnRef(git, 'origin/proposal/GCA_000001.1', 'GCA_000001.1');
  assert.equal(onRemote.createdAt, '2026-09-19T12:00:00.000Z');
  assert.deepEqual(onRemote.ticket, TICKET);
});

test('publishProposal in update mode comments exactly once across two runs', async () => {
  const { repo, git } = await preparedProposal({ planted: { ...plantedManifest, ticket: TICKET } });
  const ticket = stubTicket();
  await publishProposal({ git, ticket, repoPath: repo, accession: 'GCA_000001.1' });
  await publishProposal({ git, ticket, repoPath: repo, accession: 'GCA_000001.1' });
  assert.equal(ticket.comments(), 1);
  assert.match(ticket.calls.find(c => c[0] === 'comment')[2], /pull\/7/);
  assert.equal(ticket.created(), 0);
});

test('publishProposal in update mode stays quiet when the ticket already carries the note', async () => {
  const { repo, git } = await preparedProposal({ planted: { ...plantedManifest, ticket: TICKET } });
  const first = stubTicket();
  await publishProposal({ git, ticket: first, repoPath: repo, accession: 'GCA_000001.1' });
  const body = first.calls.find(c => c[0] === 'comment')[2];

  // a fresh client that sees the note the earlier run left behind
  const preloaded = stubTicket({ existingComments: [body] });
  await publishProposal({ git, ticket: preloaded, repoPath: repo, accession: 'GCA_000001.1' });
  assert.equal(preloaded.comments(), 0);
});

// --- manifest.readOnRef, exercised against a real repository ---------------

test('readOnRef returns the validated manifest on a ref, or null when absent', () => {
  const { repo } = setupRepo();
  const git = createGit(repo);
  assert.equal(readOnRef(git, 'origin/master', 'GCA_000001.1'), null);
  plantProposalOnMaster(repo, { ...plantedManifest, ticket: TICKET });
  git.fetch();
  const m = readOnRef(git, 'origin/master', 'GCA_000001.1');
  assert.equal(m.accession, 'GCA_000001.1');
  assert.equal(m.ticket.id, '42');
});

test('readOnRef rejects an invalid manifest on the ref', () => {
  const { repo } = setupRepo();
  const git = createGit(repo);
  plantProposalOnMaster(repo, { ...plantedManifest, project: 'NotADB' });
  git.fetch();
  assert.throws(() => readOnRef(git, 'origin/master', 'GCA_000001.1'), /project "NotADB" is not valid/);
});
