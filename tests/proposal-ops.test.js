import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createGit } from '../shared/scripts/lib/git-ops.js';
import { startProposal, writeProposal, publishProposal } from '../shared/scripts/lib/proposal-ops.js';
import { readOnRef } from '../shared/scripts/lib/manifest.js';

const fixtures = new URL('./fixtures/', import.meta.url).pathname;

/** Bare origin + clone that looks like VEuPathDatasets: master with allContacts.xml. */
function setupRepo() {
  const root = mkdtempSync(join(tmpdir(), 'proposal-ops-'));
  const bare = join(root, 'origin.git');
  const repo = join(root, 'VEuPathDatasets');
  execFileSync('git', ['init', '--bare', '-q', '--initial-branch=master', bare]);
  execFileSync('git', ['clone', '-q', bare, repo]);
  execFileSync('git', ['-C', repo, 'config', 'user.email', 'someone@apidb.org']);
  execFileSync('git', ['-C', repo, 'config', 'user.name', 'Some One']);
  mkdirSync(join(repo, 'Model/lib/xml/datasetPresenters/contacts'), { recursive: true });
  cpSync(join(fixtures, 'allContacts.xml'), join(repo, 'Model/lib/xml/datasetPresenters/contacts/allContacts.xml'));
  execFileSync('git', ['-C', repo, 'add', '.']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init']);
  execFileSync('git', ['-C', repo, 'push', '-q', '-u', 'origin', 'master']);
  return { root, repo };
}

function stubTicket({ status = 'proposed' } = {}) {
  const calls = [];
  return {
    calls,
    async create({ title, body }) { calls.push(['create', title, body]); return { system: 'redmine', id: '42', url: 'https://r/issues/42' }; },
    async comment(ref, body) { calls.push(['comment', ref.id, body]); },
    async getStatus(ref) { calls.push(['getStatus', ref.id]); return status; },
    async setStatus(ref, s) { calls.push(['setStatus', ref.id, s]); }
  };
}

const manifestInput = {
  accession: 'GCA_000001.1', datasetType: 'genome-assembly', project: 'FungiDB',
  organismAbbrev: 'tfakST1', targetBuild: '02',
  contacts: { primary: 'jane.doe', additional: ['ravi.kumar'] },
  skill: { name: 'propose-genome-assembly', version: '2.0.0' }
};

test('startProposal refuses when not on master or dirty', async () => {
  const { repo } = setupRepo();
  const git = createGit(repo);
  writeFileSync(join(repo, 'junk'), 'x');
  await assert.rejects(startProposal({ git, ticket: stubTicket(), accession: 'X' }), /working tree is not clean/);
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
  // plant an existing proposal with a ticket on master
  const dir = join(repo, 'Proposals/GCA_000001.1');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
    ...manifestInput, schemaVersion: 1, curator: 'someone@apidb.org', createdAt: '2026-09-18T00:00:00.000Z',
    ticket: { system: 'redmine', id: '42', url: 'https://r/issues/42' }
  }));
  execFileSync('git', ['-C', repo, 'add', '.']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'existing']);
  execFileSync('git', ['-C', repo, 'push', '-q']);

  const blocked = stubTicket({ status: 'loading' });
  await assert.rejects(startProposal({ git: createGit(repo), ticket: blocked, accession: 'GCA_000001.1' }), /status is "loading"/);

  const ok = await startProposal({ git: createGit(repo), ticket: stubTicket({ status: 'proposed' }), accession: 'GCA_000001.1' });
  assert.equal(ok.mode, 'update');
  assert.equal(ok.existingTicket.id, '42');
});

test('writeProposal copies files and writes a valid manifest', async () => {
  const { repo, root } = setupRepo();
  const tmp = join(root, 'tmp'); mkdirSync(tmp);
  const src = join(fixtures, 'proposals/GCA_000001.1/inputs');
  for (const f of ['GCA_000001.1_dataset_report.json', 'PRJNA000001_bioproject.json', 'GCA_000001.1_pubmed.json']) {
    cpSync(join(src, f), join(tmp, f));
  }
  const dir = writeProposal({
    repoPath: repo, manifestInput, curator: 'someone@apidb.org',
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
  const { repo } = setupRepo();
  assert.throws(() => writeProposal({
    repoPath: repo, curator: 'someone@apidb.org', inputs: [], curated: [],
    manifestInput: { ...manifestInput, contacts: { primary: 'nobody', additional: [] } }
  }), /nobody.*not found in allContacts/);
});

test('publishProposal commits, pushes, opens PR, creates ticket, amends manifest', async () => {
  const { repo, root } = setupRepo();
  const ghCalls = [];
  const exec = (cmd, args, opts) => {
    if (cmd === 'gh') { ghCalls.push(args); return 'https://github.com/VEuPathDB/VEuPathDatasets/pull/7\n'; }
    return execFileSync(cmd, args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  };
  const git = createGit(repo, { exec });
  const ticket = stubTicket();
  await startProposal({ git, ticket, accession: 'GCA_000001.1' });

  const tmp = join(root, 'tmp'); mkdirSync(tmp);
  const src = join(fixtures, 'proposals/GCA_000001.1/inputs');
  cpSync(join(src, 'GCA_000001.1_dataset_report.json'), join(tmp, 'GCA_000001.1_dataset_report.json'));
  writeProposal({ repoPath: repo, manifestInput, curator: 'someone@apidb.org', inputs: [join(tmp, 'GCA_000001.1_dataset_report.json')], curated: [] });

  const result = await publishProposal({ git, ticket, repoPath: repo, accession: 'GCA_000001.1' });
  assert.equal(result.prUrl, 'https://github.com/VEuPathDB/VEuPathDatasets/pull/7');
  assert.equal(result.ticket.id, '42');
  assert.equal(git.isClean(), true);
  assert.equal(ghCalls[0][1], 'create');
  assert.ok(ghCalls[0].includes('master'));
  assert.equal(ticket.calls[0][0], 'create');
  assert.match(ticket.calls[0][2], /pull\/7/);
  const onRemote = JSON.parse(git.showFile('origin/proposal/GCA_000001.1', 'Proposals/GCA_000001.1/manifest.json'));
  assert.deepEqual(onRemote.ticket, { system: 'redmine', id: '42', url: 'https://r/issues/42' });
  assert.equal(git.commitsForPath('origin/proposal/GCA_000001.1', 'Proposals/GCA_000001.1').length, 1);
});

test('publishProposal on an update comments instead of creating a ticket', async () => {
  const { repo, root } = setupRepo();
  const exec = (cmd, args, opts) => cmd === 'gh'
    ? 'https://github.com/VEuPathDB/VEuPathDatasets/pull/8\n'
    : execFileSync(cmd, args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  const git = createGit(repo, { exec });
  const ticket = stubTicket();
  await startProposal({ git, ticket, accession: 'GCA_000001.1' });
  const tmp = join(root, 'tmp'); mkdirSync(tmp);
  cpSync(join(fixtures, 'proposals/GCA_000001.1/inputs/GCA_000001.1_dataset_report.json'), join(tmp, 'r.json'));
  writeProposal({ repoPath: repo, manifestInput, curator: 'someone@apidb.org', inputs: [join(tmp, 'r.json')], curated: [] });
  const result = await publishProposal({
    git, ticket, repoPath: repo, accession: 'GCA_000001.1',
    existingTicket: { system: 'redmine', id: '42', url: 'https://r/issues/42' }
  });
  assert.equal(result.ticket.id, '42');
  assert.equal(ticket.calls[0][0], 'comment');
});


/** Commits a manifest for accession onto master and pushes it. */
function plantProposalOnMaster(repo, manifest, accession = manifest.accession) {
  const dir = join(repo, 'Proposals', accession);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  execFileSync('git', ['-C', repo, 'add', '.']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', `plant ${accession}`]);
  execFileSync('git', ['-C', repo, 'push', '-q']);
}

const plantedManifest = {
  ...manifestInput, schemaVersion: 1, curator: 'someone@apidb.org',
  createdAt: '2026-09-18T00:00:00.000Z'
};

test('readOnRef returns the validated manifest on a ref, or null when absent', () => {
  const { repo } = setupRepo();
  const git = createGit(repo);
  assert.equal(readOnRef(git, 'origin/master', 'GCA_000001.1'), null);
  plantProposalOnMaster(repo, { ...plantedManifest, ticket: { system: 'redmine', id: '42', url: 'https://r/issues/42' } });
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
