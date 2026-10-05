import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, existsSync, readFileSync, cpSync, readdirSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createGit } from '../shared/scripts/lib/git-ops.js';
import { startProposal, writeProposal, publishProposal, artifactsToWrite } from '../shared/scripts/lib/proposal-ops.js';
import { readOnRef } from '../shared/scripts/lib/manifest.js';
import { requestRevision, markReady, startVerification } from '../shared/scripts/lib/verification-ops.js';
import { mergeProposal } from '../shared/scripts/lib/merge-ops.js';
import { fixtures, initRepo, otherClone, stubTicket, stubGh, loaded } from './helpers.js';

const setupRepo = () => initRepo('proposal-ops-');

const manifestInput = {
  accession: 'GCA_000001.1', datasetType: 'genome-assembly', project: 'FungiDB',
  organism: 'tfakST-1',
  contacts: { primary: 'jane.doe', additional: ['ravi.kumar'] },
  skill: { name: 'propose-genome-assembly', version: '2.0.0' }
};

const plantedManifest = {
  accession: 'GCA_000001.1', datasetType: 'genome-assembly', project: 'FungiDB',
  organisms: [{ proposedOrganismAbbrev: 'tfakST-1', source: 'new', species: 'Testus fakeus', strain: 'ST-1', ncbiTaxonId: '999001' }],
  contacts: { primary: 'jane.doe', additional: ['ravi.kumar'] },
  skill: { name: 'propose-genome-assembly', version: '2.0.0' },
  schemaVersion: 3, curator: 'someone@apidb.org', createdAt: '2026-09-18T00:00:00.000Z'
};

const TICKET = { system: 'github', id: '42', url: 'https://r/issues/42' };

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

  const draft = await startProposal({ git: createGit(repo), ticket: stubTicket({ status: 'draft' }), accession: 'GCA_000001.1' });
  assert.equal(draft.mode, 'update');
  execFileSync('git', ['-C', repo, 'checkout', '-q', 'master']);
  execFileSync('git', ['-C', repo, 'branch', '-q', '-D', 'proposal/GCA_000001.1']);
  const ok = await startProposal({ git: createGit(repo), ticket: stubTicket({ status: 'proposed' }), accession: 'GCA_000001.1' });
  assert.equal(ok.mode, 'update');
  assert.equal(ok.existingTicket.id, '42');
});

test('startProposal updates a Ready to load proposal and refuses loading, QA or done, naming the allowed statuses', async () => {
  for (const status of ['loading', 'qa', 'finalqa', 'done']) {
    const { repo } = setupRepo();
    plantProposalOnMaster(repo, { ...plantedManifest, ticket: TICKET });
    await assert.rejects(startProposal({ git: createGit(repo), ticket: stubTicket({ status }), accession: 'GCA_000001.1' }),
      new RegExp(`status is "${status}"\\. Only a draft, proposed, verifying, ready or revision ticket can be updated`));
  }
  const { repo } = setupRepo();
  plantProposalOnMaster(repo, { ...plantedManifest, ticket: TICKET });
  const ready = await startProposal({ git: createGit(repo), ticket: stubTicket({ status: 'ready' }), accession: 'GCA_000001.1' });
  assert.equal(ready.mode, 'update');
  const { repo: other } = setupRepo();
  plantProposalOnMaster(other, { ...plantedManifest, ticket: TICKET });
  const verifying = await startProposal({ git: createGit(other), ticket: stubTicket({ status: 'verifying' }), accession: 'GCA_000001.1' });
  assert.equal(verifying.mode, 'update');
});

test('startProposal updates a proposal that needs revision', async () => {
  const { repo } = setupRepo();
  plantProposalOnMaster(repo, { ...plantedManifest, ticket: TICKET });
  const result = await startProposal({ git: createGit(repo), ticket: stubTicket({ status: 'revision' }), accession: 'GCA_000001.1' });
  assert.equal(result.mode, 'update');
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

const rnaPlanted = (accession, externalIds) => ({
  ...plantedManifest, accession, datasetType: 'bulk-rnaseq', organisms: loaded('tfakST1'), externalIds
});

test('startProposal refuses when a proposal on master already records one of the external ids', async () => {
  const { repo } = setupRepo();
  plantProposalOnMaster(repo, rnaPlanted('PRJNA000002', { bioproject: 'PRJNA000002', geo: 'GSE0002' }));
  await assert.rejects(
    startProposal({ git: createGit(repo), ticket: stubTicket(), accession: 'GSE0002', externalIds: { geo: 'GSE0002', bioproject: 'PRJNA000002' } }),
    /Proposal PRJNA000002 \(origin\/master\) already covers (GSE0002|PRJNA000002)[\s\S]*start-proposal\.js PRJNA000002/
  );
});

test('startProposal refuses when a proposal branch on origin is named for, or records, one of the external ids', async () => {
  const { root, repo, bare } = setupRepo();
  const other = otherClone(root, bare);
  execFileSync('git', ['-C', other, 'checkout', '-q', '-b', 'proposal/PRJNA000002']);
  execFileSync('git', ['-C', other, 'push', '-q', '-u', 'origin', 'proposal/PRJNA000002']);
  await assert.rejects(
    startProposal({ git: createGit(repo), ticket: stubTicket(), accession: 'GSE0002', externalIds: { geo: 'GSE0002', bioproject: 'PRJNA000002' } }),
    /Proposal PRJNA000002 \(origin\/proposal\/PRJNA000002\) already covers PRJNA000002/
  );

  const { root: root2, repo: repo2, bare: bare2 } = setupRepo();
  const third = otherClone(root2, bare2);
  execFileSync('git', ['-C', third, 'checkout', '-q', '-b', 'proposal/PRJNA000003']);
  execFileSync('git', ['-C', third, 'push', '-q', '-u', 'origin', 'proposal/PRJNA000003']);
  plantProposalOnMaster(third, rnaPlanted('PRJNA000003', { bioproject: 'PRJNA000003', geo: 'GSE0003' }));
  await assert.rejects(
    startProposal({ git: createGit(repo2), ticket: stubTicket(), accession: 'GSE0003', externalIds: { geo: 'GSE0003' } }),
    /Proposal PRJNA000003 \(origin\/proposal\/PRJNA000003\) already covers GSE0003/
  );
});

test('startProposal allows an update of the same accession whatever it records', async () => {
  const { repo } = setupRepo();
  plantProposalOnMaster(repo, { ...rnaPlanted('PRJNA000002', { bioproject: 'PRJNA000002', geo: 'GSE0002' }), ticket: TICKET });
  const result = await startProposal({ git: createGit(repo), ticket: stubTicket(), accession: 'PRJNA000002', externalIds: { geo: 'GSE0002', bioproject: 'PRJNA000002' } });
  assert.equal(result.mode, 'update');
});

test('writeProposal records externalIds and keeps those already recorded', async () => {
  const { repo, root } = setupRepo();
  const git = createGit(repo);
  await startProposal({ git, ticket: stubTicket(), accession: 'GCA_000001.1' });
  const write = (externalIds) => writeProposal({
    git, repoPath: repo, manifestInput: { ...manifestInput, externalIds }, curator: 'someone@apidb.org', inputs: genomeInputs(root), curated: []
  });
  const first = await write({ bioproject: 'PRJNA000001' });
  assert.deepEqual(first.manifest.externalIds, { bioproject: 'PRJNA000001' });
  assert.deepEqual(Object.keys(first.manifest).slice(0, 3), ['schemaVersion', 'accession', 'externalIds']);
  const again = await write({});
  assert.deepEqual(again.manifest.externalIds, { bioproject: 'PRJNA000001' });
});

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
  assert.equal(m.schemaVersion, 3);
  assert.deepEqual(m.organisms, [{ proposedOrganismAbbrev: 'tfakST-1', source: 'new', species: 'Testus fakeus', strain: 'ST-1', ncbiTaxonId: '999001' }]);
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

/** Plants a manifest.json in the working tree's Proposals/<accession>/ without committing it. */
function plantWorkingManifest(repo, contents, accession = 'GCA_000001.1') {
  const dir = join(repo, 'Proposals', accession);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), contents);
}

test('writeProposal keeps the ticket from an older-schema manifest already in the working tree', async () => {
  const { repo, root } = setupRepo();
  const git = createGit(repo);
  await startProposal({ git, ticket: stubTicket(), accession: 'GCA_000001.1' });
  plantWorkingManifest(repo, JSON.stringify({ ...plantedManifest, schemaVersion: 1, ticket: TICKET }));
  const { dir } = await writeProposal({ git, repoPath: repo, manifestInput, curator: 'someone@apidb.org', inputs: genomeInputs(root), curated: [] });
  const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf-8'));
  assert.equal(m.schemaVersion, 3);
  assert.deepEqual(m.ticket, TICKET);
});

test('writeProposal ignores a malformed existing manifest instead of failing', async () => {
  const { repo, root } = setupRepo();
  const git = createGit(repo);
  await startProposal({ git, ticket: stubTicket(), accession: 'GCA_000001.1' });
  plantWorkingManifest(repo, '{ not json');
  const { dir } = await writeProposal({ git, repoPath: repo, manifestInput, curator: 'someone@apidb.org', inputs: genomeInputs(root), curated: [] });
  assert.equal(JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf-8')).ticket, undefined);
});

test('writeProposal prefers manifestInput.ticket over the working-tree ticket', async () => {
  const { repo, root } = setupRepo();
  const git = createGit(repo);
  await startProposal({ git, ticket: stubTicket(), accession: 'GCA_000001.1' });
  plantWorkingManifest(repo, JSON.stringify({ ...plantedManifest, ticket: TICKET }));
  const given = { system: 'github', id: '7', url: 'https://r/issues/7' };
  const { dir } = await writeProposal({ git, repoPath: repo, manifestInput: { ...manifestInput, ticket: given }, curator: 'someone@apidb.org', inputs: genomeInputs(root), curated: [] });
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf-8')).ticket, given);
});

test('writeProposal prefers the working-tree ticket over a different one on origin/master', async () => {
  const { repo, root } = setupRepo();
  const onMaster = { system: 'github', id: '9', url: 'https://r/issues/9' };
  plantProposalOnMaster(repo, { ...plantedManifest, ticket: onMaster });
  const git = createGit(repo);
  await startProposal({ git, ticket: stubTicket(), accession: 'GCA_000001.1' });
  plantWorkingManifest(repo, JSON.stringify({ ...plantedManifest, ticket: TICKET }));
  const { dir } = await writeProposal({ git, repoPath: repo, manifestInput, curator: 'someone@apidb.org', inputs: genomeInputs(root), curated: [] });
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf-8')).ticket, TICKET);
});

test('writeProposal ignores and warns about a malformed ticket in the existing manifest', async () => {
  const { repo, root } = setupRepo();
  const git = createGit(repo);
  await startProposal({ git, ticket: stubTicket(), accession: 'GCA_000001.1' });
  plantWorkingManifest(repo, JSON.stringify({ ...plantedManifest, ticket: { system: 'github', id: '', url: 'nope' } }));
  const warnings = [];
  const { dir } = await writeProposal({ git, repoPath: repo, manifestInput, curator: 'someone@apidb.org', inputs: genomeInputs(root), curated: [], warn: (m) => warnings.push(m) });
  assert.equal(JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf-8')).ticket, undefined);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /malformed ticket \(ticket\.id is required; ticket\.url must be an http\(s\) URL\)/);
});

test('writeProposal stays silent about an unparseable or ticketless existing manifest', async () => {
  const { repo, root } = setupRepo();
  const git = createGit(repo);
  await startProposal({ git, ticket: stubTicket(), accession: 'GCA_000001.1' });
  const warnings = [];
  for (const contents of ['{ not json', JSON.stringify(plantedManifest)]) {
    plantWorkingManifest(repo, contents);
    await writeProposal({ git, repoPath: repo, manifestInput, curator: 'someone@apidb.org', inputs: genomeInputs(root), curated: [], warn: (m) => warnings.push(m) });
  }
  assert.deepEqual(warnings, []);
});

const rnaManifestInput = {
  ...manifestInput, accession: 'PRJNA000003', datasetType: 'bulk-rnaseq', organism: 'tfakST1',
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
  }), /Invalid presenter for PRJNA000003 \(set missing fields under "presenter" in --overrides; injector props go under "presenter": \{ "injectorProps": \{ \.\.\. \} \}\):\n  - shortDisplayName is required and is empty\n  - shortAttribution is required and is empty/);
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
    'schemaVersion', 'accession', 'datasetType', 'project', 'organisms',
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

test('writeProposal refuses a name an additional organism already has', async () => {
  const { repo, root } = setupRepo();
  cpSync(join(fixtures, 'tfakST1.xml'), join(repo, 'Datasets/lib/xml/datasets/FungiDB/tfakST2.xml'));
  const path = join(repo, 'Datasets/lib/xml/datasets/FungiDB/tfakST2.xml');
  writeFileSync(path, readFileSync(path, 'utf-8').replace('Existing_2020', 'Doe_cold_shock_2024'));
  execFileSync('git', ['-C', repo, 'add', '.']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'tfakST2']);
  execFileSync('git', ['-C', repo, 'push', '-q']);
  const git = createGit(repo);
  await startProposal({ git, ticket: stubTicket(), accession: 'PRJNA000003' });
  await assert.rejects(writeProposal({
    git, repoPath: repo, manifestInput: { ...rnaManifestInput, additionalOrganisms: ['tfakST2'] }, curator: 'someone@apidb.org', ...rnaFiles(root, coldShock)
  }), /FungiDB\/tfakST2\.xml already has a rnaSeqExperiment named "Doe_cold_shock_2024"/);
});

test('writeProposal records the RNA-seq organisms as loaded organisms', async () => {
  const { repo, root } = setupRepo();
  const git = createGit(repo);
  await startProposal({ git, ticket: stubTicket(), accession: 'PRJNA000003' });
  const { manifest } = await writeProposal({
    git, repoPath: repo, manifestInput: rnaManifestInput, curator: 'someone@apidb.org', ...rnaFiles(root, coldShock)
  });
  assert.equal(manifest.schemaVersion, 3);
  assert.deepEqual(manifest.organisms, loaded('tfakST1'));
  for (const k of ['organismAbbrev', 'referenceOrganismAbbrev', 'additionalOrganismAbbrevs']) assert.equal(manifest[k], undefined, k);
  assert.equal(manifest.targetBuild, undefined);
});

test('a genome proposal refuses additional organisms', async () => {
  const { repo, root } = setupRepo();
  const git = createGit(repo);
  await startProposal({ git, ticket: stubTicket(), accession: 'GCA_000001.1' });
  await assert.rejects(writeProposal({
    git, repoPath: repo, manifestInput: { ...manifestInput, additionalOrganisms: ['tfakST2'] }, curator: 'someone@apidb.org', inputs: genomeInputs(root), curated: []
  }), /genome-assembly proposals align to one organism; --also-organism is not allowed/);
});

test('a genome proposal takes organism overrides over what the assembly report says', async () => {
  const { repo, root } = setupRepo();
  const git = createGit(repo);
  await startProposal({ git, ticket: stubTicket(), accession: 'GCA_000001.1' });
  const overrides = join(root, 'organism-overrides.json');
  writeFileSync(overrides, JSON.stringify({ organism: { strain: 'ST 1' } }));
  const { manifest } = await writeProposal({ git, repoPath: repo, manifestInput, curator: 'someone@apidb.org', inputs: genomeInputs(root), curated: [], overrides });
  assert.deepEqual(manifest.organisms, [{ proposedOrganismAbbrev: 'tfakST-1', source: 'new', species: 'Testus fakeus', strain: 'ST 1', ncbiTaxonId: '999001' }]);
});

test('a genome proposal whose report names no species says how to set one', async () => {
  const { repo, root } = setupRepo();
  const git = createGit(repo);
  await startProposal({ git, ticket: stubTicket(), accession: 'GCA_000001.1' });
  const inputs = genomeInputs(root);
  const report = JSON.parse(readFileSync(inputs[0], 'utf-8'));
  delete report.reports[0].organism.organism_name;
  writeFileSync(inputs[0], JSON.stringify(report));
  await assert.rejects(writeProposal({ git, repoPath: repo, manifestInput, curator: 'someone@apidb.org', inputs, curated: [] }),
    /organisms\[0\]\.species must name a genus and species; set "organism": \{ "species": "<Genus species>" \} in --overrides/);

  const overrides = join(root, 'organism-overrides.json');
  writeFileSync(overrides, JSON.stringify({ organism: { species: 'Testus fakeus' } }));
  const { manifest } = await writeProposal({ git, repoPath: repo, manifestInput, curator: 'someone@apidb.org', inputs, curated: [], overrides });
  assert.equal(manifest.organisms[0].species, 'Testus fakeus');
});

test('an RNA-seq proposal refuses organism overrides', async () => {
  const { repo, root } = setupRepo();
  const git = createGit(repo);
  await startProposal({ git, ticket: stubTicket(), accession: 'PRJNA000003' });
  await assert.rejects(writeProposal({
    git, repoPath: repo, manifestInput: rnaManifestInput, curator: 'someone@apidb.org', ...rnaFiles(root, { ...coldShock, organism: { strain: 'x' } })
  }), /bulk-rnaseq proposals take no "organism" overrides; they apply to genome proposals/);
});

test('writeProposal refuses a name another proposal on master already uses', async () => {
  const { repo, root } = setupRepo();
  plantProposalOnMaster(repo, { ...plantedManifest, accession: 'PRJNA000009', datasetType: 'bulk-rnaseq',
    organisms: loaded('tfakST1'),
    datasetClass: 'rnaSeqExperiment', name: 'Doe_cold_shock_2024', version: '2024-05-01' });
  const git = createGit(repo);
  await startProposal({ git, ticket: stubTicket(), accession: 'PRJNA000003' });
  await assert.rejects(writeProposal({
    git, repoPath: repo, manifestInput: rnaManifestInput, curator: 'someone@apidb.org', ...rnaFiles(root, coldShock)
  }), /Proposal PRJNA000009 on master already uses the name "Doe_cold_shock_2024" for tfakST1/);
});

test('writeProposal refuses a name another proposal on master uses for one of its additional organisms', async () => {
  const { repo, root } = setupRepo();
  plantProposalOnMaster(repo, { ...plantedManifest, accession: 'PRJNA000009', datasetType: 'bulk-rnaseq',
    organisms: loaded('tfakST2', 'tfakST1'),
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
    git, repoPath: repo, manifestInput: { ...rnaManifestInput, organism: 'nopeST1' }, curator: 'someone@apidb.org', ...rnaFiles(root, coldShock)
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

test('writeProposal writes the curated artifacts beside presenter.json', async () => {
  const { repo, root } = setupRepo();
  const git = createGit(repo);
  await startProposal({ git, ticket: stubTicket(), accession: 'PRJNA000003' });
  const { dir } = await writeProposal({ git, repoPath: repo, manifestInput: rnaManifestInput, curator: 'someone@apidb.org', ...rnaFiles(root, coldShock) });
  for (const f of ['samplesheet.csv', 'analysisConfig.xml', 'entity-sample.tsv', 'entity-sample.yaml']) {
    assert.equal(readFileSync(join(dir, 'curated', f), 'utf-8'), readFileSync(join(fixtures, 'proposals/PRJNA000003/curated', f), 'utf-8'), f);
  }
});

test('writeProposal refuses a --curated file it derives itself', async () => {
  const { repo, root } = setupRepo();
  const git = createGit(repo);
  await startProposal({ git, ticket: stubTicket(), accession: 'PRJNA000003' });
  const files = rnaFiles(root, coldShock);
  const sheet = join(root, 'tmp', 'samplesheet.csv');
  writeFileSync(sheet, 'sample,fastq_1,fastq_2,strandedness\n');
  await assert.rejects(writeProposal({ git, repoPath: repo, manifestInput: rnaManifestInput, curator: 'someone@apidb.org', ...files, curated: [...files.curated, sheet] }),
    /samplesheet\.csv is derived by this script/);
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
  const result = await publishProposal({ git, ticket, repoPath: repo, accession: 'GCA_000001.1', build: '02' });

  assert.equal(result.prUrl, 'https://github.com/VEuPathDB/VEuPathDatasets/pull/7');
  assert.equal(result.ticket.id, '42');
  assert.equal(result.resumed, false);
  assert.equal(git.isClean(), true);
  assert.equal(gh.calls[0][0], 'auth');
  assert.equal(gh.creates(), 1);
  assert.equal(ticket.calls[0][0], 'create');
  assert.equal(ticket.calls[0][3], '02');
  assert.match(ticket.calls[0][2], /^Proposal: `Proposals\/GCA_000001\.1`$/m);
  assert.match(prBody(gh), /^Part of https:\/\/r\/issues\/42\n/);
  assert.match(prBody(gh), /^Proposal: `Proposals\/GCA_000001\.1`$/m);
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
  assert.deepEqual(ticket.calls.map(c => c[0]), ['getStatus', 'comment']);
  assert.match(ticket.notes[0], /^Proposal updated\. Pull request: .*pull\/7/);
  assert.equal(ticket.created(), 0);
  assert.match(prBody(gh), /^Part of https:\/\/r\/issues\/42\n/);
});

test('re-writing a published proposal keeps its ticket, so the next publish reuses it', async () => {
  const { repo, root, git, gh } = await preparedProposal();
  const ticket = stubTicket();
  await publishProposal({ git, ticket, repoPath: repo, accession: 'GCA_000001.1', build: '02' });

  const { dir } = await writeProposal({ git, repoPath: repo, manifestInput, curator: 'someone@apidb.org', inputs: genomeInputs(root), curated: [] });
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf-8')).ticket, TICKET);

  const second = await publishProposal({ git, ticket, repoPath: repo, accession: 'GCA_000001.1', build: '02' });
  assert.equal(second.ticket.id, '42');
  assert.equal(ticket.created(), 1);
  assert.equal(gh.creates(), 1);
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
  await publishProposal({ git, ticket, repoPath: repo, accession: 'GCA_000001.1', build: '02' });
  const again = await publishProposal({ git, ticket, repoPath: repo, accession: 'GCA_000001.1', build: '02' });

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

  await assert.rejects(publishProposal({ git, ticket, repoPath: repo, accession: 'GCA_000001.1', build: '02' }));
  assert.equal(ticket.created(), 1);
  assert.equal(ticket.comments(), 0);

  const result = await publishProposal({ git, ticket, repoPath: repo, accession: 'GCA_000001.1', build: '02' });
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

  await assert.rejects(publishProposal({ git, ticket, repoPath: repo, accession: 'GCA_000001.1', build: '02' }), /ticket system unavailable/);
  assert.equal(gh.creates(), 0);
  assert.equal(git.aheadOf('origin/master'), 0);

  const result = await publishProposal({ git, ticket, repoPath: repo, accession: 'GCA_000001.1', build: '02' });
  assert.equal(result.ticket.id, '42');
  assert.equal(result.resumed, false);
  assert.equal(ticket.created(), 1);
  assert.equal(ticket.comments(), 1);
  assert.equal(gh.creates(), 1);
  assert.equal(git.aheadOf('origin/master'), 1);
  assert.deepEqual(readOnRef(git, 'origin/proposal/GCA_000001.1', 'GCA_000001.1').ticket, TICKET);
});

test('publishProposal passes the manifest dataset type to the ticket and leaves a fresh status alone', async () => {
  const { repo, git } = await preparedProposal();
  const ticket = stubTicket();
  await publishProposal({ git, ticket, repoPath: repo, accession: 'GCA_000001.1', build: '02' });
  assert.equal(ticket.calls[0][4], 'genome-assembly');
  assert.equal(ticket.calls.some(c => c[0] === 'setStatus'), false);
});

test('publishProposal records a ticket whose project status failed, and the re-run sets it without a second ticket', async () => {
  const { repo, git, gh } = await preparedProposal();
  const ticket = stubTicket({ failProjectOnCreates: 1 });

  await assert.rejects(publishProposal({ git, ticket, repoPath: repo, accession: 'GCA_000001.1', build: '02' }),
    /Issue https:\/\/r\/issues\/42 was created but .*It is recorded in Proposals\/GCA_000001\.1\/manifest\.json: do not discard the working-tree changes in Proposals\/GCA_000001\.1\/\. Fix the cause first \(usually gh auth refresh -s project, or add the missing options to the project's Status field by hand\), then re-run publish\./s);
  assert.deepEqual(JSON.parse(readFileSync(join(repo, 'Proposals/GCA_000001.1/manifest.json'), 'utf-8')).ticket, TICKET);
  assert.equal(gh.creates(), 0);

  const result = await publishProposal({ git, ticket, repoPath: repo, accession: 'GCA_000001.1', build: '02' });
  assert.equal(result.ticket.id, '42');
  assert.equal(ticket.created(), 1);
  assert.deepEqual(ticket.calls.filter(c => c[0] === 'setStatus'), [['setStatus', '42', 'draft']]);
  assert.equal(gh.creates(), 1);
  assert.deepEqual(readOnRef(git, 'origin/proposal/GCA_000001.1', 'GCA_000001.1').ticket, TICKET);
});

test('publishProposal checks the dataset type has an issue label before changing anything, on an update too', async () => {
  const { repo, git, gh } = await preparedProposal({ planted: { ...plantedManifest, ticket: TICKET } });
  const ticket = stubTicket({ unlabelledTypes: ['genome-assembly'] });
  const ahead = git.aheadOf('origin/master');
  await assert.rejects(publishProposal({ git, ticket, repoPath: repo, accession: 'GCA_000001.1' }),
    /No issue label for dataset type "genome-assembly"/);
  assert.equal(git.aheadOf('origin/master'), ahead);
  assert.equal(git.isClean(), false);
  assert.equal(gh.calls.some(a => a[0] === 'pr'), false);
  assert.deepEqual(ticket.calls, []);
});

test('publishing an update returns a ready or revision ticket to proposed, after the pull request', async () => {
  for (const status of ['verifying', 'ready', 'revision']) {
    const { repo, git, gh } = await preparedProposal({ planted: { ...plantedManifest, ticket: TICKET } });
    const ticket = stubTicket({ status });
    await publishProposal({ git, ticket, repoPath: repo, accession: 'GCA_000001.1' });
    assert.deepEqual(ticket.calls.filter(c => c[0] === 'setStatus'), [['setStatus', '42', 'proposed']]);
    assert.equal(gh.creates(), 1);
    const kinds = ticket.calls.map(c => c[0]);
    assert.ok(kinds.indexOf('comment') < kinds.indexOf('setStatus'));
  }
});

test('publishing an update leaves a proposed or merged-draft ticket alone', async () => {
  for (const status of ['proposed', 'draft']) {
    const { repo, git } = await preparedProposal({ planted: { ...plantedManifest, ticket: TICKET } });
    const ticket = stubTicket({ status });
    await publishProposal({ git, ticket, repoPath: repo, accession: 'GCA_000001.1' });
    assert.equal(ticket.calls.some(c => c[0] === 'setStatus'), false);
  }
});

test('a fresh publish re-run keeps the ticket at Initial draft', async () => {
  const { repo, git } = await preparedProposal();
  const ticket = stubTicket({ status: 'draft' });
  await publishProposal({ git, ticket, repoPath: repo, accession: 'GCA_000001.1', build: '02' });
  await publishProposal({ git, ticket, repoPath: repo, accession: 'GCA_000001.1', build: '02' });
  assert.deepEqual(ticket.calls.filter(c => c[0] === 'setStatus'), [['setStatus', '42', 'draft']]);
});

// --- startVerification -----------------------------------------------------

test('startVerification claims a merged Proposed proposal: assigns the issue, then sets verifying', async () => {
  const { repo } = setupRepo();
  plantProposalOnMaster(repo, { ...plantedManifest, ticket: TICKET });
  const ticket = stubTicket({ status: 'proposed' });
  const result = await startVerification({ git: createGit(repo, { exec: stubGh().exec }), ticket, accession: 'GCA_000001.1' });
  assert.deepEqual(result, { ticket: TICKET, status: 'verifying', notice: null });
  assert.deepEqual(ticket.calls.filter(c => c[0] !== 'getStatus'), [['assign', '42'], ['setStatus', '42', 'verifying']]);
});

test('startVerification refuses an unmerged proposal, an open update, a failed lookup and a ticket not Proposed', async () => {
  const notMerged = setupRepo();
  const t1 = stubTicket();
  await assert.rejects(startVerification({ git: createGit(notMerged.repo, { exec: stubGh().exec }), ticket: t1, accession: 'GCA_000001.1' }),
    /Proposal GCA_000001\.1 is not on origin\/master; verify it after its proposal pull request merges/);
  assert.deepEqual(t1.calls, []);

  const { repo } = setupRepo();
  plantProposalOnMaster(repo, { ...plantedManifest, ticket: TICKET });
  const writes = (t) => t.calls.filter(c => ['assign', 'setStatus', 'comment'].includes(c[0]));

  const t2 = stubTicket();
  await assert.rejects(startVerification({ git: createGit(repo, { exec: stubGh({ openPr: 'https://github.com/VEuPathDB/VEuPathDatasets/pull/12' }).exec }), ticket: t2, accession: 'GCA_000001.1' }),
    /An update to GCA_000001\.1 is awaiting review in https:\/\/github\.com\/VEuPathDB\/VEuPathDatasets\/pull\/12/);
  assert.deepEqual(writes(t2), []);

  const t3 = stubTicket();
  await assert.rejects(startVerification({ git: createGit(repo, { exec: stubGh({ failOpenLookup: true }).exec }), ticket: t3, accession: 'GCA_000001.1' }),
    /Cannot check for an open update to GCA_000001\.1 from proposal\/GCA_000001\.1, so verification is not started: gh: HTTP 502/);
  assert.deepEqual(writes(t3), []);

  for (const [status, option] of [['verifying', 'Verification in progress'], ['ready', 'Ready to load'], ['revision', 'Needs revision'], ['loading', 'Loading in progress'], ['qa', 'Post Load QA'], ['finalqa', 'Final QA']]) {
    const t = stubTicket({ status });
    await assert.rejects(startVerification({ git: createGit(repo, { exec: stubGh().exec }), ticket: t, accession: 'GCA_000001.1' }),
      new RegExp(`The ticket https://r/issues/42 is at "${option}"; only a "Proposed" proposal can start verification`));
    assert.deepEqual(writes(t), []);
  }

  const noTicket = setupRepo();
  plantProposalOnMaster(noTicket.repo, plantedManifest);
  await assert.rejects(startVerification({ git: createGit(noTicket.repo, { exec: stubGh().exec }), ticket: stubTicket(), accession: 'GCA_000001.1' }),
    /Proposal GCA_000001\.1 on origin\/master has no ticket/);
});

// --- Initial draft at verification -------------------------------------------

const MERGED_PROPOSAL = { url: 'https://github.com/VEuPathDB/VEuPathDatasets/pull/7', number: 7, baseRefName: 'master', headRefOid: 'b'.repeat(40) };
const DRAFT_NOTICE = 'The proposal PR https://github.com/VEuPathDB/VEuPathDatasets/pull/7 is merged but the ticket was still at "Initial draft"; continuing as Proposed.';

test('verification commands treat a merged Initial draft as Proposed, with a notice', async () => {
  const { repo } = setupRepo();
  plantProposalOnMaster(repo, { ...plantedManifest, ticket: TICKET });
  const git = () => createGit(repo, { exec: stubGh({ merged: MERGED_PROPOSAL }).exec });

  const t1 = stubTicket({ status: 'draft' });
  const started = await startVerification({ git: git(), ticket: t1, accession: 'GCA_000001.1' });
  assert.equal(started.notice, DRAFT_NOTICE);
  assert.deepEqual(t1.calls.filter(c => c[0] === 'setStatus'), [['setStatus', '42', 'verifying']]);

  const t2 = stubTicket({ status: 'draft' });
  const ready = await markReady({ git: git(), ticket: t2, accession: 'GCA_000001.1' });
  assert.equal(ready.notice, DRAFT_NOTICE);
  assert.deepEqual(t2.calls.filter(c => c[0] === 'setStatus'), [['setStatus', '42', 'ready']]);

  const t3 = stubTicket({ status: 'draft' });
  const sent = await requestRevision({ git: git(), ticket: t3, repoPath: repo, accession: 'GCA_000001.1', reason: 'r' });
  assert.equal(sent.notice, DRAFT_NOTICE);
  assert.deepEqual(t3.calls.filter(c => c[0] === 'setStatus'), [['setStatus', '42', 'revision']]);

  const t4 = stubTicket({ status: 'proposed' });
  assert.equal((await markReady({ git: git(), ticket: t4, accession: 'GCA_000001.1' })).notice, null);
});

test('verification commands refuse an Initial draft whose proposal PR has not merged', async () => {
  const { repo } = setupRepo();
  plantProposalOnMaster(repo, { ...plantedManifest, ticket: TICKET });
  const writes = (t) => t.calls.filter(c => ['assign', 'setStatus', 'comment'].includes(c[0]));
  const notMerged = /The proposal PR from proposal\/GCA_000001\.1 is not merged yet; the ticket is at "Initial draft"\./;
  for (const run of [
    (git, ticket) => startVerification({ git, ticket, accession: 'GCA_000001.1' }),
    (git, ticket) => markReady({ git, ticket, accession: 'GCA_000001.1' }),
    (git, ticket) => requestRevision({ git, ticket, repoPath: repo, accession: 'GCA_000001.1', reason: 'r' })
  ]) {
    const ticket = stubTicket({ status: 'draft' });
    await assert.rejects(run(createGit(repo, { exec: stubGh().exec }), ticket), notMerged);
    assert.deepEqual(writes(ticket), []);
  }

  // request-revision on a proposal only on its branch: review happens on the open PR
  const { repo: branchOnly, git } = await preparedProposal({ gh: stubGh({ openPr: 'https://github.com/VEuPathDB/VEuPathDatasets/pull/8' }) });
  const path = join(branchOnly, 'Proposals/GCA_000001.1/manifest.json');
  writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf-8')), ticket: TICKET }, null, 2) + '\n');
  const ticket = stubTicket({ status: 'draft' });
  await assert.rejects(requestRevision({ git, ticket, repoPath: branchOnly, accession: 'GCA_000001.1', reason: 'r' }),
    /The proposal PR https:\/\/github\.com\/VEuPathDB\/VEuPathDatasets\/pull\/8 is not merged yet; the ticket is at "Initial draft"\./);
  assert.deepEqual(writes(ticket), []);
});

test('verification at Initial draft fails closed when the merged-PR lookup fails', async () => {
  const { repo } = setupRepo();
  plantProposalOnMaster(repo, { ...plantedManifest, ticket: TICKET });
  const ticket = stubTicket({ status: 'draft' });
  await assert.rejects(markReady({ git: createGit(repo, { exec: stubGh({ failMergedLookup: true }).exec }), ticket, accession: 'GCA_000001.1' }),
    /Cannot check whether the proposal PR from proposal\/GCA_000001\.1 merged, so it is not marked ready: gh: HTTP 503/);
  assert.equal(ticket.calls.some(c => c[0] === 'setStatus' || c[0] === 'comment'), false);
});

// --- requestRevision -------------------------------------------------------

test('requestRevision comments the reason once and sets the ticket to revision', async () => {
  for (const status of ['proposed', 'verifying', 'ready']) {
    const { repo } = setupRepo();
    plantProposalOnMaster(repo, { ...plantedManifest, ticket: TICKET });
    const ticket = stubTicket({ status });
    const result = await requestRevision({ git: createGit(repo), ticket, repoPath: repo, accession: 'GCA_000001.1', reason: ' Strandedness is wrong ' });
    assert.deepEqual(result.ticket, TICKET);
    assert.deepEqual(ticket.notes, ['Needs revision: Strandedness is wrong']);
    assert.deepEqual(ticket.calls.filter(c => c[0] === 'setStatus'), [['setStatus', '42', 'revision']]);
  }
});

test('requestRevision on a ticket already at revision adds the new reason and leaves the status', async () => {
  const { repo } = setupRepo();
  plantProposalOnMaster(repo, { ...plantedManifest, ticket: TICKET });
  const ticket = stubTicket({ status: 'revision', existingComments: ['Needs revision: first'] });
  const result = await requestRevision({ git: createGit(repo), ticket, repoPath: repo, accession: 'GCA_000001.1', reason: 'second' });
  assert.equal(result.status, 'revision');
  assert.deepEqual(ticket.notes, ['Needs revision: first', 'Needs revision: second']);
  assert.equal(ticket.calls.some(c => c[0] === 'setStatus'), false);
});

// --- markReady -------------------------------------------------------------

test('markReady verifies a merged proposal: notes it once and sets ready', async () => {
  const { repo } = setupRepo();
  plantProposalOnMaster(repo, { ...plantedManifest, ticket: TICKET });
  const git = createGit(repo, { exec: stubGh().exec });
  const ticket = stubTicket({ status: 'proposed' });
  const result = await markReady({ git, ticket, accession: 'GCA_000001.1', note: ' reads resolve ' });
  assert.deepEqual(result.ticket, TICKET);
  assert.deepEqual(ticket.notes, ['Verified: reads resolve']);
  assert.deepEqual(ticket.calls.filter(c => c[0] === 'setStatus'), [['setStatus', '42', 'ready']]);

  const quiet = stubTicket({ status: 'proposed' });
  await markReady({ git, ticket: quiet, accession: 'GCA_000001.1' });
  assert.deepEqual(quiet.notes, []);
  assert.deepEqual(quiet.calls.filter(c => c[0] === 'setStatus'), [['setStatus', '42', 'ready']]);

  const claimed = stubTicket({ status: 'verifying' });
  await markReady({ git, ticket: claimed, accession: 'GCA_000001.1' });
  assert.deepEqual(claimed.calls.filter(c => c[0] === 'setStatus'), [['setStatus', '42', 'ready']]);
});

test('markReady refuses a proposal that is not merged', async () => {
  const { repo } = setupRepo();
  const ticket = stubTicket();
  await assert.rejects(markReady({ git: createGit(repo, { exec: stubGh().exec }), ticket, accession: 'GCA_000001.1' }),
    /Proposal GCA_000001\.1 is not on origin\/master; verify it after its proposal pull request merges/);
  assert.deepEqual(ticket.calls, []);
});

test('markReady refuses while an update awaits review', async () => {
  const { repo } = setupRepo();
  plantProposalOnMaster(repo, { ...plantedManifest, ticket: TICKET });
  const gh = stubGh({ openPr: 'https://github.com/VEuPathDB/VEuPathDatasets/pull/12' });
  const ticket = stubTicket();
  await assert.rejects(markReady({ git: createGit(repo, { exec: gh.exec }), ticket, accession: 'GCA_000001.1' }),
    /An update to GCA_000001\.1 is awaiting review in https:\/\/github\.com\/VEuPathDB\/VEuPathDatasets\/pull\/12; verify it after that merges/);
  const list = gh.calls.find(a => a[0] === 'pr' && a[1] === 'list');
  assert.equal(list[list.indexOf('--head') + 1], 'proposal/GCA_000001.1');
  assert.equal(ticket.calls.some(c => c[0] === 'setStatus' || c[0] === 'comment'), false);
});

test('markReady refuses when it cannot check for an open update', async () => {
  const { repo } = setupRepo();
  plantProposalOnMaster(repo, { ...plantedManifest, ticket: TICKET });
  const ticket = stubTicket();
  await assert.rejects(markReady({ git: createGit(repo, { exec: stubGh({ failOpenLookup: true }).exec }), ticket, accession: 'GCA_000001.1' }),
    /Cannot check for an open update to GCA_000001\.1 from proposal\/GCA_000001\.1, so it is not marked ready: gh: HTTP 502/);
  assert.equal(ticket.calls.some(c => c[0] === 'setStatus' || c[0] === 'comment'), false);
});

test('markReady refuses a ticket that is not Proposed, naming its option', async () => {
  const { repo } = setupRepo();
  plantProposalOnMaster(repo, { ...plantedManifest, ticket: TICKET });
  for (const [status, option] of [['ready', 'Ready to load'], ['revision', 'Needs revision'], ['loading', 'Loading in progress'], ['qa', 'Post Load QA'], ['finalqa', 'Final QA']]) {
    const ticket = stubTicket({ status });
    await assert.rejects(markReady({ git: createGit(repo, { exec: stubGh().exec }), ticket, accession: 'GCA_000001.1', note: 'n' }),
      new RegExp(`The ticket https://r/issues/42 is at "${option}"; only a "Proposed" or "Verification in progress" proposal can be marked ready`));
    assert.equal(ticket.calls.some(c => c[0] === 'setStatus' || c[0] === 'comment'), false);
  }
});

test('markReady refuses a merged proposal with no ticket', async () => {
  const { repo } = setupRepo();
  plantProposalOnMaster(repo, plantedManifest);
  await assert.rejects(markReady({ git: createGit(repo, { exec: stubGh().exec }), ticket: stubTicket(), accession: 'GCA_000001.1' }),
    /Proposal GCA_000001\.1 on origin\/master has no ticket/);
});

test('requestRevision prefers the proposal in the working tree', async () => {
  const { repo, git } = await preparedProposal();
  const working = { system: 'github', id: '77', url: 'https://r/issues/77' };
  const path = join(repo, 'Proposals/GCA_000001.1/manifest.json');
  writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf-8')), ticket: working }, null, 2) + '\n');
  const ticket = stubTicket();
  await requestRevision({ git, ticket, repoPath: repo, accession: 'GCA_000001.1', reason: 'r' });
  assert.deepEqual(ticket.calls.filter(c => c[0] === 'setStatus'), [['setStatus', '77', 'revision']]);
});

test('requestRevision refuses an empty reason, a missing ticket, and a ticket past review', async () => {
  const { repo } = setupRepo();
  plantProposalOnMaster(repo, { ...plantedManifest, ticket: TICKET });
  const git = createGit(repo);
  for (const reason of ['', '   ', undefined]) {
    const ticket = stubTicket();
    await assert.rejects(requestRevision({ git, ticket, repoPath: repo, accession: 'GCA_000001.1', reason }), /A reason is required/);
    assert.deepEqual(ticket.calls, []);
  }
  for (const status of ['loading', 'qa', 'finalqa', 'done']) {
    const ticket = stubTicket({ status });
    await assert.rejects(requestRevision({ git, ticket, repoPath: repo, accession: 'GCA_000001.1', reason: 'r' }),
      new RegExp(`status is "${status}"; only a proposed, verifying, ready or revision ticket can take a revision request`));
    assert.equal(ticket.calls.some(c => c[0] === 'comment' || c[0] === 'setStatus'), false);
  }
  await assert.rejects(requestRevision({ git, ticket: stubTicket(), repoPath: repo, accession: 'GCA_999999.1', reason: 'r' }),
    /No ticket found for GCA_999999\.1/);
});

test('publishing an update refuses a ticket past review before committing or pushing', async () => {
  for (const [status, option] of [['loading', 'Loading in progress'], ['qa', 'Post Load QA'], ['finalqa', 'Final QA'], ['done', 'Done']]) {
    const { repo, git, gh } = await preparedProposal({ planted: { ...plantedManifest, ticket: TICKET } });
    const ticket = stubTicket({ status });
    await assert.rejects(publishProposal({ git, ticket, repoPath: repo, accession: 'GCA_000001.1' }),
      new RegExp(`The ticket https://r/issues/42 is at "${option}"; only Initial draft, Proposed, Verification in progress, Ready to load or Needs revision proposals can be updated`));
    assert.equal(git.aheadOf('origin/master'), 0);
    assert.equal(gh.calls.some(a => a[0] === 'pr'), false);
    assert.equal(git.remoteBranchExists('proposal/GCA_000001.1'), false);
    assert.equal(ticket.calls.some(c => c[0] === 'comment' || c[0] === 'setStatus'), false);
  }
});

test('a re-run publish of a recorded ticket with no project status yet goes on and sets Initial draft', async () => {
  const { repo, git } = await preparedProposal();
  const path = join(repo, 'Proposals/GCA_000001.1/manifest.json');
  writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf-8')), ticket: TICKET }, null, 2) + '\n');
  const noStatus = Object.assign(new Error('Issue #42 is not in project VEuPathDB/25'), { code: 'NO_STATUS' });
  const ticket = stubTicket({ statuses: { 42: noStatus } });
  await publishProposal({ git, ticket, repoPath: repo, accession: 'GCA_000001.1', build: '02' });
  assert.deepEqual(ticket.calls.filter(c => c[0] === 'setStatus'), [['setStatus', '42', 'draft']]);

  const { repo: other, git: otherGit } = await preparedProposal();
  const otherPath = join(other, 'Proposals/GCA_000001.1/manifest.json');
  writeFileSync(otherPath, JSON.stringify({ ...JSON.parse(readFileSync(otherPath, 'utf-8')), ticket: TICKET }, null, 2) + '\n');
  await assert.rejects(publishProposal({ git: otherGit, ticket: stubTicket({ statuses: { 42: new Error('HTTP 502') } }), repoPath: other, accession: 'GCA_000001.1', build: '02' }),
    /HTTP 502/);
  assert.equal(otherGit.aheadOf('origin/master'), 0);
});

test('a recorded ticket with no project status is refused when its issue is closed', async () => {
  const { repo, git } = await preparedProposal();
  const path = join(repo, 'Proposals/GCA_000001.1/manifest.json');
  writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf-8')), ticket: TICKET }, null, 2) + '\n');
  const noStatus = Object.assign(new Error('Issue #42 is not in project VEuPathDB/25'), { code: 'NO_STATUS' });
  const ticket = stubTicket({ statuses: { 42: noStatus }, closed: ['42'] });
  await assert.rejects(publishProposal({ git, ticket, repoPath: repo, accession: 'GCA_000001.1', build: '02' }),
    /The ticket https:\/\/r\/issues\/42 is closed and has no project status; reopen it, or remove it from Proposals\/GCA_000001\.1\/manifest\.json to file a new one/);
  assert.equal(git.aheadOf('origin/master'), 0);
  assert.equal(ticket.calls.some(c => c[0] === 'setStatus' || c[0] === 'comment'), false);
});

test('an update whose ticket has no project status is refused, not repaired', async () => {
  const { repo, git } = await preparedProposal({ planted: { ...plantedManifest, ticket: TICKET } });
  const noStatus = Object.assign(new Error('Issue #42 is not in project VEuPathDB/25'), { code: 'NO_STATUS' });
  const ticket = stubTicket({ statuses: { 42: noStatus } });
  await assert.rejects(publishProposal({ git, ticket, repoPath: repo, accession: 'GCA_000001.1' }), /Issue #42 is not in project/);
  assert.equal(git.aheadOf('origin/master'), 0);
  assert.equal(ticket.calls.some(c => c[0] === 'setStatus' || c[0] === 'comment'), false);
});

test('publish on master with a merged proposal does not claim its committed ticket would be lost', async () => {
  const { repo } = setupRepo();
  plantProposalOnMaster(repo, { ...plantedManifest, ticket: TICKET });
  const err = await publishProposal({ git: createGit(repo, { exec: stubGh().exec }), ticket: stubTicket(), repoPath: repo, accession: 'GCA_000001.1' })
    .then(() => null, e => e);
  assert.match(err.message, /Expected to be on proposal\/GCA_000001\.1/);
  assert.doesNotMatch(err.message, /must not be lost/);
});

test('publish checks the project before changing anything', async () => {
  const { repo, git, gh } = await preparedProposal();
  const ticket = stubTicket({ projectError: 'Project VEuPathDB/25 has no single-select field "Status"' });
  await assert.rejects(publishProposal({ git, ticket, repoPath: repo, accession: 'GCA_000001.1', build: '02' }), /no single-select field "Status"/);
  assert.equal(ticket.created(), 0);
  assert.equal(git.aheadOf('origin/master'), 0);
  assert.equal(gh.calls.some(a => a[0] === 'pr'), false);
  assert.equal(ticket.projectChecks, 1);
});

test('off the proposal branch with a recorded ticket, publish says to switch back rather than discard', async () => {
  const { repo, git } = await preparedProposal();
  const path = join(repo, 'Proposals/GCA_000001.1/manifest.json');
  writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf-8')), ticket: TICKET }, null, 2) + '\n');
  git.checkout('master');
  const err = await publishProposal({ git, ticket: stubTicket(), repoPath: repo, accession: 'GCA_000001.1' }).then(() => null, e => e);
  assert.match(err.message, /records ticket https:\/\/r\/issues\/42, which must not be lost/);
  assert.match(err.message, /checkout proposal\/GCA_000001\.1/);
  assert.doesNotMatch(err.message, /checkout --/);
});

test('publishProposal amends rather than stacking a commit when the manifest changed after the push', async () => {
  const { repo, git } = await preparedProposal();
  const ticket = stubTicket();
  await publishProposal({ git, ticket, repoPath: repo, accession: 'GCA_000001.1', build: '02' });

  // A run that died between writing the manifest and amending leaves the tree
  // dirty on a branch that is already one commit ahead.
  const manifestPath = join(repo, 'Proposals/GCA_000001.1/manifest.json');
  const m = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  writeFileSync(manifestPath, JSON.stringify({ ...m, createdAt: '2026-09-19T12:00:00.000Z' }, null, 2) + '\n');

  await publishProposal({ git, ticket, repoPath: repo, accession: 'GCA_000001.1', build: '02' });
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

test('publish needs a build to create a ticket', async () => {
  const { repo, root } = setupRepo();
  const git = createGit(repo, { exec: stubGh().exec });
  await startProposal({ git, ticket: stubTicket(), accession: 'GCA_000001.1' });
  await writeProposal({ git, repoPath: repo, manifestInput, curator: 'someone@apidb.org', inputs: genomeInputs(root), curated: [] });
  const ticket = stubTicket();
  await assert.rejects(publishProposal({ git, ticket, repoPath: repo, accession: 'GCA_000001.1' }),
    /A new ticket needs a build: re-run with --build NN/);
  assert.equal(ticket.created(), 0);
});

test('publish titles the ticket like the PR and carries the build as its milestone', async () => {
  const { repo, root } = setupRepo();
  const gh = stubGh();
  const git = createGit(repo, { exec: gh.exec });
  await startProposal({ git, ticket: stubTicket(), accession: 'GCA_000001.1' });
  await writeProposal({ git, repoPath: repo, manifestInput, curator: 'someone@apidb.org', inputs: genomeInputs(root), curated: [] });
  const ticket = stubTicket();
  const { title } = await publishProposal({ git, ticket, repoPath: repo, accession: 'GCA_000001.1', build: '73' });
  assert.equal(ticket.calls[0][1], '[FungiDB] genome-assembly GCA_000001.1');
  assert.equal(ticket.calls[0][3], '73');
  assert.equal(title, '[FungiDB] genome-assembly GCA_000001.1');
  assert.doesNotMatch(ticket.calls[0][2], /build/i);
  assert.equal(git.headSubject(), 'Propose GCA_000001.1 (genome-assembly, FungiDB)');
});

test('publish refuses a --build that disagrees with the recorded ticket', async () => {
  const { repo, root } = setupRepo();
  const git = createGit(repo, { exec: stubGh().exec });
  await startProposal({ git, ticket: stubTicket(), accession: 'GCA_000001.1' });
  await writeProposal({ git, repoPath: repo, manifestInput: { ...manifestInput, ticket: TICKET }, curator: 'someone@apidb.org', inputs: genomeInputs(root), curated: [] });
  await assert.rejects(publishProposal({ git, ticket: stubTicket({ build: '72' }), repoPath: repo, accession: 'GCA_000001.1', build: '73' }),
    /ticket https:\/\/r\/issues\/42 is in build 72, not 73; move its milestone instead of passing --build/);
});

test('publish accepts a matching --build on a re-run', async () => {
  const { repo, root } = setupRepo();
  const git = createGit(repo, { exec: stubGh().exec });
  await startProposal({ git, ticket: stubTicket(), accession: 'GCA_000001.1' });
  await writeProposal({ git, repoPath: repo, manifestInput: { ...manifestInput, ticket: TICKET }, curator: 'someone@apidb.org', inputs: genomeInputs(root), curated: [] });
  const r = await publishProposal({ git, ticket: stubTicket({ build: '73' }), repoPath: repo, accession: 'GCA_000001.1', build: '73' });
  assert.ok(r.prUrl);
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

test('writeProposal commits the normalized sample annotations', async () => {
  const { repo, root } = setupRepo();
  const git = createGit(repo);
  await startProposal({ git, ticket: stubTicket(), accession: 'PRJNA000003' });
  const { dir } = await writeProposal({ git, repoPath: repo, manifestInput: rnaManifestInput, curator: 'someone@apidb.org', ...rnaFiles(root, coldShock) });
  const saved = JSON.parse(readFileSync(join(dir, 'curated/PRJNA000003_sample_annotations.json'), 'utf-8'));
  assert.deepEqual(saved.samples.map((s) => [s.sampleId, s.biosample]), [['SAMN1', 'SAMN1'], ['SAMN2', 'SAMN2']]);
});

test('writeProposal refuses a proposal whose x-axis description is blanked', async () => {
  const { repo, root } = setupRepo();
  const git = createGit(repo);
  await startProposal({ git, ticket: stubTicket(), accession: 'PRJNA000003' });
  await assert.rejects(writeProposal({
    git, repoPath: repo, manifestInput: rnaManifestInput, curator: 'someone@apidb.org',
    ...rnaFiles(root, { ...coldShock, presenter: { ...coldShock.presenter, injectorProps: { graphXAxisSamplesDescription: '' } } })
  }), /injectorProps\.graphXAxisSamplesDescription is required and is empty/);
});

test('publish refuses curated artifacts edited out of agreement', async () => {
  const { repo, root } = setupRepo();
  const git = createGit(repo, { exec: stubGh().exec });
  await startProposal({ git, ticket: stubTicket(), accession: 'PRJNA000003' });
  const { dir } = await writeProposal({ git, repoPath: repo, manifestInput: rnaManifestInput, curator: 'someone@apidb.org', ...rnaFiles(root, coldShock) });
  const p = join(dir, 'curated', 'samplesheet.csv');
  writeFileSync(p, readFileSync(p, 'utf-8').replace('SAMN2,', 'SAMN8,'));
  const ticket = stubTicket();
  await assert.rejects(publishProposal({ git, ticket, repoPath: repo, accession: 'PRJNA000003', build: '02' }), /Curated artifacts of PRJNA000003 disagree:/);
  assert.equal(ticket.created(), 0);
});

test('writeProposal takes reads not in SRA from curator-named files', async () => {
  const { repo, root } = setupRepo();
  const git = createGit(repo);
  await startProposal({ git, ticket: stubTicket(), accession: 'PRJNA000003' });
  const { curated, inputs } = rnaFiles(root);
  const a = JSON.parse(readFileSync(curated[0], 'utf-8'));
  a.samples = [
    { sampleId: 'ctl', label: 'Control', factors: { condition: 'control' },
      files: [{ fastq_1: 'ctl_L1_R1.fq.gz', fastq_2: 'ctl_L1_R2.fq.gz' }, { fastq_1: 'ctl_L2_R1.fq.gz', fastq_2: 'ctl_L2_R2.fq.gz' }] },
    { sampleId: 'hot', label: 'Stressed', factors: { condition: 'stressed' }, files: [{ fastq_1: 'hot_R1.fq.gz', fastq_2: 'hot_R2.fq.gz' }] }
  ];
  writeFileSync(curated[0], JSON.stringify(a));
  const overrides = join(root, 'tmp', 'overrides.json');
  writeFileSync(overrides, JSON.stringify({
    ...coldShock,
    presenter: { ...coldShock.presenter, displayName: 'RNA-Seq of <i>Testus fakeus</i>', summary: 'Stress response' },
    dataset: { source: { type: 'server', paths: ['/data/doe'] } }
  }));
  const { dir, dataset } = await writeProposal({
    git, repoPath: repo, manifestInput: rnaManifestInput, curator: 'someone@apidb.org',
    inputs: inputs.filter((f) => f.endsWith('_family.xml')), curated, overrides
  });
  assert.equal(dataset.props.hasPairedEnds, 'true');
  assert.equal(dataset.props.fromSRA, 'false');
  assert.equal(readFileSync(join(dir, 'curated/samplesheet.csv'), 'utf-8'), [
    'sample,fastq_1,fastq_2,strandedness',
    'ctl,ctl_L1_R1.fq.gz,ctl_L1_R2.fq.gz,stranded',
    'ctl,ctl_L2_R1.fq.gz,ctl_L2_R2.fq.gz,stranded',
    'hot,hot_R1.fq.gz,hot_R2.fq.gz,stranded'
  ].join('\n') + '\n');
  assert.match(readFileSync(join(dir, 'curated/analysisConfig.xml'), 'utf-8'), /<value>Control\|ctl<\/value>/);
  assert.doesNotMatch(readFileSync(join(dir, 'curated/entity-sample.tsv'), 'utf-8').split('\n')[0], /SRA\.ID\.s\./);
  assert.doesNotMatch(readFileSync(join(dir, 'curated/entity-sample.yaml'), 'utf-8'), /SRA\.ID\.s\./);
});

// --- hand edits to the curated artifacts -------------------------------------

const ASK = 'Ask the curator, then re-run with --keep-edits to keep them or --replace-edits to rewrite them (or per file: --keep-edit <file>, --replace-edit <file>).';

/** Every path under dir with its contents, to show a refused write changed nothing. */
const treeSnapshot = (dir) => Object.fromEntries(readdirSync(dir, { recursive: true }).sort()
  .map((f) => [f, statSync(join(dir, f)).isFile() ? readFileSync(join(dir, f), 'utf-8') : null]));

/** An RNA-seq proposal written once, with a writer for re-runs. */
async function writtenRnaProposal() {
  const { repo, root } = setupRepo();
  const git = createGit(repo);
  await startProposal({ git, ticket: stubTicket(), accession: 'PRJNA000003' });
  const rewrite = (opts = {}) => writeProposal({ git, repoPath: repo, manifestInput: rnaManifestInput, curator: 'someone@apidb.org', ...rnaFiles(root, coldShock), ...opts });
  const { dir } = await rewrite();
  const curatedText = (f) => readFileSync(join(dir, 'curated', f), 'utf-8');
  const handEdit = (f, from, to) => writeFileSync(join(dir, 'curated', f), curatedText(f).replace(from, to));
  return { dir, root, rewrite, curatedText, handEdit };
}

const editConfig = (handEdit) => handEdit('analysisConfig.xml', 'stress &amp; recovery', 'stress and recovery');
const editSheet = (handEdit) => handEdit('samplesheet.csv', 'sample,fastq_1,fastq_2,strandedness\n', 'sample,fastq_1,fastq_2,strandedness\r\n');

test('writeProposal re-runs without asking when the curated artifacts are as derived', async () => {
  const { rewrite } = await writtenRnaProposal();
  await rewrite();
});

test('writeProposal refuses to replace a hand-edited artifact unless told, and changes nothing', async () => {
  const { dir, rewrite, handEdit } = await writtenRnaProposal();
  editConfig(handEdit);
  const before = treeSnapshot(dir);
  await assert.rejects(rewrite(), (e) =>
    e.message.includes(`curated/analysisConfig.xml differs from what write-proposal would derive (hand edits, or changed annotations). ${ASK}`)
    && !e.message.includes('samplesheet.csv'));
  assert.deepEqual(treeSnapshot(dir), before);
});

test('writeProposal refuses a re-run whose annotations changed a label, naming the files it touches', async () => {
  const { root, rewrite } = await writtenRnaProposal();
  const changed = join(root, 'changed', 'PRJNA000003_sample_annotations.json');
  mkdirSync(join(root, 'changed'));
  const a = JSON.parse(readFileSync(join(fixtures, 'proposals/PRJNA000003/curated/PRJNA000003_sample_annotations.json'), 'utf-8'));
  a.samples[0].label = 'Mock';
  writeFileSync(changed, JSON.stringify(a));
  await assert.rejects(rewrite({ curated: [changed] }), (e) =>
    /^curated\/analysisConfig\.xml, curated\/entity-sample\.tsv differ/.test(e.message) && !e.message.includes('samplesheet.csv'));
});

test('writeProposal keeps or replaces hand edits as the curator decided', async () => {
  const { rewrite, curatedText, handEdit } = await writtenRnaProposal();
  editConfig(handEdit);
  await rewrite({ curatedEdits: 'keep' });
  assert.match(curatedText('analysisConfig.xml'), /stress and recovery/);
  await rewrite({ curatedEdits: 'replace' });
  assert.match(curatedText('analysisConfig.xml'), /stress &amp; recovery/);
});

test('writeProposal keeps one hand-edited file and replaces another when chosen per file', async () => {
  const { rewrite, curatedText, handEdit } = await writtenRnaProposal();
  editConfig(handEdit);
  editSheet(handEdit);
  await rewrite({ curatedEdits: { keep: ['analysisConfig.xml'], replace: ['samplesheet.csv'] } });
  assert.match(curatedText('analysisConfig.xml'), /stress and recovery/);
  assert.doesNotMatch(curatedText('samplesheet.csv'), /\r/);
});

test('writeProposal refuses per-file choices that miss, repeat or name a file that does not differ', async () => {
  const { dir, rewrite, handEdit } = await writtenRnaProposal();
  editConfig(handEdit);
  editSheet(handEdit);
  const before = treeSnapshot(dir);
  const refused = (curatedEdits, line) => assert.rejects(rewrite({ curatedEdits }), (e) => e.message.includes(line) && e.message.includes(ASK));
  await refused({ keep: ['analysisConfig.xml'] }, 'curated/samplesheet.csv differs and has no choice');
  await refused({ keep: ['analysisConfig.xml', 'samplesheet.csv'], replace: ['samplesheet.csv'] }, 'curated/samplesheet.csv is chosen more than once');
  await refused({ keep: ['analysisConfig.xml', 'samplesheet.csv', 'notes.txt'] }, 'curated/notes.txt is not a curated artifact that differs');
  await refused({ keep: ['analysisConfig.xml', 'samplesheet.csv'], replace: ['entity-sample.yaml'] }, 'curated/entity-sample.yaml is not a curated artifact that differs');
  assert.deepEqual(treeSnapshot(dir), before);
});

test('writeProposal still checks agreement of the hand edits it keeps', async () => {
  const { rewrite, handEdit } = await writtenRnaProposal();
  handEdit('samplesheet.csv', 'SAMN2,', 'SAMN8,');
  await assert.rejects(rewrite({ curatedEdits: 'keep' }), /Curated artifacts of PRJNA000003 disagree:/);
  await assert.rejects(rewrite({ curatedEdits: { keep: ['samplesheet.csv'] } }), /Curated artifacts of PRJNA000003 disagree:/);
});

test('writeProposal refuses an unknown curatedEdits choice', async () => {
  const { rewrite } = await writtenRnaProposal();
  for (const curatedEdits of ['merge', { keep: 'samplesheet.csv' }, { drop: [] }]) {
    await assert.rejects(rewrite({ curatedEdits }), /curatedEdits must be "keep", "replace" or \{ keep: \[\.\.\.\], replace: \[\.\.\.\] \}/);
  }
});

test('artifactsToWrite makes the curator decide on a listed artifact the type no longer derives', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'artifacts-to-write-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'curated'));
  writeFileSync(join(dir, 'curated', 'a.txt'), 'a');
  writeFileSync(join(dir, 'curated', 'old.txt'), 'kept');
  assert.throws(() => artifactsToWrite(dir, { 'a.txt': 'a' }, ['a.txt', 'old.txt']), /curated\/old\.txt differs from what write-proposal would derive/);
  assert.deepEqual(artifactsToWrite(dir, { 'a.txt': 'a' }, ['a.txt', 'old.txt'], 'keep'), { 'a.txt': 'a', 'old.txt': 'kept' });
  assert.deepEqual(artifactsToWrite(dir, { 'a.txt': 'a' }, ['a.txt', 'old.txt'], 'replace'), { 'a.txt': 'a' });
});

// --- mergeProposal ----------------------------------------------------------

const PR7 = 'https://github.com/VEuPathDB/VEuPathDatasets/pull/7';

/** A proposal published to proposal/<acc> with its PR open, through the same stubbed gh. */
async function publishedProposal(ghOpts = {}) {
  const gh = stubGh(ghOpts);
  const prepared = await preparedProposal({ gh });
  await publishProposal({ git: prepared.git, ticket: stubTicket({ status: 'draft' }), repoPath: prepared.repo, accession: 'GCA_000001.1', build: '02' });
  return { ...prepared, gh };
}

test('mergeProposal merges an Initial draft PR, notes it once and moves the ticket to Proposed', async () => {
  const { git, gh } = await publishedProposal();
  const ticket = stubTicket({ status: 'draft' });
  const result = await mergeProposal({ git, ticket, accession: 'GCA_000001.1' });
  assert.deepEqual(result, { prUrl: PR7, ticket: TICKET, resumed: false });
  assert.deepEqual(gh.calls.filter(a => a[1] === 'merge'), [['pr', 'merge', 'proposal/GCA_000001.1', '--merge']]);
  assert.deepEqual(ticket.notes, [`Merged ${PR7}`]);
  assert.deepEqual(ticket.calls.filter(c => c[0] === 'setStatus'), [['setStatus', '42', 'proposed']]);
  assert.equal(ticket.projectChecks, 1);
});

test('mergeProposal merges an update PR of a Proposed dataset and leaves the status', async () => {
  const gh = stubGh();
  const { git } = await preparedProposal({ planted: { ...plantedManifest, ticket: TICKET }, gh });
  await publishProposal({ git, ticket: stubTicket(), repoPath: git.repoPath, accession: 'GCA_000001.1' });
  const ticket = stubTicket({ status: 'proposed' });
  await mergeProposal({ git, ticket, accession: 'GCA_000001.1' });
  assert.equal(gh.calls.filter(a => a[1] === 'merge').length, 1);
  assert.deepEqual(ticket.notes, [`Merged ${PR7}`]);
  assert.equal(ticket.calls.some(c => c[0] === 'setStatus'), false);
});

test('mergeProposal re-run after the merge finishes the note and status without merging again', async () => {
  const { git, gh } = await publishedProposal();
  const first = stubTicket({ status: 'draft' });
  first.setStatus = async () => { throw new Error('HTTP 502'); };
  await assert.rejects(mergeProposal({ git, ticket: first, accession: 'GCA_000001.1' }), /HTTP 502/);

  const again = stubTicket({ status: 'draft', existingComments: [`Merged ${PR7}`] });
  const result = await mergeProposal({ git, ticket: again, accession: 'GCA_000001.1' });
  assert.equal(result.resumed, true);
  assert.equal(gh.calls.filter(a => a[1] === 'merge').length, 1);
  assert.equal(again.comments(), 0);
  assert.deepEqual(again.calls.filter(c => c[0] === 'setStatus'), [['setStatus', '42', 'proposed']]);
});

test('mergeProposal refuses a PR gh cannot merge and leaves the ticket alone', async () => {
  const { git } = await publishedProposal({ mergeError: 'Pull request #7 is not mergeable: the merge commit cannot be cleanly created' });
  const ticket = stubTicket({ status: 'draft' });
  await assert.rejects(mergeProposal({ git, ticket, accession: 'GCA_000001.1' }),
    /Cannot merge https:\/\/github\.com\/VEuPathDB\/VEuPathDatasets\/pull\/7: .*not mergeable.*\nThe ticket is unchanged\./s);
  assert.equal(ticket.calls.some(c => c[0] === 'setStatus' || c[0] === 'comment'), false);
});

test('mergeProposal refuses a ticket that is neither Initial draft nor Proposed, before merging', async () => {
  const { git, gh } = await publishedProposal();
  for (const [status, option] of [['verifying', 'Verification in progress'], ['ready', 'Ready to load'], ['loading', 'Loading in progress']]) {
    const ticket = stubTicket({ status });
    await assert.rejects(mergeProposal({ git, ticket, accession: 'GCA_000001.1' }),
      new RegExp(`The ticket https://r/issues/42 is at "${option}"; merge-proposal merges only "Initial draft" or "Proposed" proposals`));
    assert.equal(ticket.calls.some(c => c[0] === 'setStatus' || c[0] === 'comment'), false);
  }
  assert.equal(gh.calls.some(a => a[1] === 'merge'), false);
});

test('mergeProposal fails closed when it cannot look up the PR, and refuses when there is none', async () => {
  const { git } = await publishedProposal({ failOpenLookup: true });
  const ticket = stubTicket({ status: 'draft' });
  await assert.rejects(mergeProposal({ git, ticket, accession: 'GCA_000001.1' }),
    /Cannot check for an open proposal PR from proposal\/GCA_000001\.1, so nothing is merged: gh: HTTP 502/);
  assert.deepEqual(ticket.calls, []);

  const { repo } = setupRepo();
  plantProposalOnMaster(repo, { ...plantedManifest, ticket: TICKET });
  await assert.rejects(mergeProposal({ git: createGit(repo, { exec: stubGh().exec }), ticket: stubTicket(), accession: 'GCA_000001.1' }),
    /No open or merged proposal PR from proposal\/GCA_000001\.1/);
});

test('mergeProposal refuses a merge gh accepted but did not complete, leaving the ticket alone', async () => {
  const { git, gh } = await publishedProposal({ mergeQueued: true });
  const ticket = stubTicket({ status: 'draft' });
  await assert.rejects(mergeProposal({ git, ticket, accession: 'GCA_000001.1' }),
    /https:\/\/github\.com\/VEuPathDB\/VEuPathDatasets\/pull\/7 is queued or pending, not merged; re-run merge-proposal after it merges\. The ticket is unchanged\./);
  assert.equal(gh.calls.filter(a => a[1] === 'merge').length, 1);
  assert.equal(ticket.calls.some(c => c[0] === 'setStatus' || c[0] === 'comment'), false);
});

test('mergeProposal refuses a proposal PR that does not target master', async () => {
  const { git, gh } = await publishedProposal({ openBase: 'rebuild02' });
  const ticket = stubTicket({ status: 'draft' });
  await assert.rejects(mergeProposal({ git, ticket, accession: 'GCA_000001.1' }),
    /The PR https:\/\/github\.com\/VEuPathDB\/VEuPathDatasets\/pull\/7 from proposal\/GCA_000001\.1 targets rebuild02, not master/);
  assert.equal(gh.calls.some(a => a[1] === 'merge'), false);
  assert.deepEqual(ticket.calls, []);
});

test('mergeProposal reads the ticket at the PR head, fetching it when the branch is gone', async () => {
  const { root, bare, repo } = await publishedProposal();
  const head = execFileSync('git', ['-C', repo, 'rev-parse', 'origin/proposal/GCA_000001.1'], { encoding: 'utf-8' }).trim();
  execFileSync('git', ['-C', bare, 'update-ref', 'refs/pull/7/head', head]);
  execFileSync('git', ['-C', bare, 'update-ref', '-d', 'refs/heads/proposal/GCA_000001.1']);
  const other = otherClone(root, bare);
  const gh = stubGh({ openPr: PR7, openHead: head });
  const ticket = stubTicket({ status: 'draft' });
  const result = await mergeProposal({ git: createGit(other, { exec: gh.exec }), ticket, accession: 'GCA_000001.1' });
  assert.deepEqual(result.ticket, TICKET);
  assert.deepEqual(ticket.calls.filter(c => c[0] === 'setStatus'), [['setStatus', '42', 'proposed']]);
});
