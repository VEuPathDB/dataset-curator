import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createGit } from '../shared/scripts/lib/git-ops.js';
import { amendProposal } from '../shared/scripts/lib/amend-ops.js';
import { fixtures, initRepo } from './helpers.js';
import { genomeWorkArea, genomeProposal, editJson, ACCESSION } from './genome-work-area.js';

const TICKET = { system: 'github', id: '42', url: 'https://r/issues/42' };
const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf-8' });
const curated = (repo, file) => JSON.parse(readFileSync(join(repo, 'Proposals', ACCESSION, 'curated', file), 'utf-8'));

/** GCA_000001.1 merged with a ticket and a curator constant, checked out on proposal/GCA_000001.1, and a work area under a validation root. */
function setup({ workArea = true } = {}) {
  const { repo } = initRepo('amend-ops-');
  const dir = join(repo, 'Proposals', ACCESSION);
  cpSync(genomeProposal().dir, dir, { recursive: true });
  editJson(join(dir, 'manifest.json'), (m) => ({ ...m, ticket: TICKET }));
  editJson(join(dir, 'curated/organism.json'), (r) => ({ ...r, constants: { source: 'GenBank' } }));
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'merge GCA_000001.1');
  git(repo, 'push', '-q');
  git(repo, 'checkout', '-q', '-b', `proposal/${ACCESSION}`);
  const root = mkdtempSync(join(tmpdir(), 'validation-root-'));
  if (workArea) genomeWorkArea({ at: join(root, 'annotated-genome-validation/proposals', ACCESSION, 'preprocess') });
  return { repo, root, gitOps: createGit(repo) };
}

const amend = (s, given = { orthomclAbbrev: 'tfak' }, proposalId = ACCESSION) =>
  amendProposal({ git: s.gitOps, repoPath: s.repo, workspace: s.root, proposalId, given });

test('amendProposal writes the entries and the amended record, keeping curator keys and constants, and diffs against master', async () => {
  const s = setup();
  const result = await amend(s);
  const record = curated(s.repo, 'organism.json');
  assert.equal(record.schemaVersion, 2);
  assert.equal(record.organismFullName, 'Testus fakeus ST-1');
  assert.equal(record.orthomclAbbrev, 'tfak');
  assert.deepEqual(record.constants, { source: 'GenBank', genomeSource: 'GenBank', genomeVersion: '2024-03-05', functAnnotVersion: '2024-04-01' });
  assert.equal(curated(s.repo, 'datasets.json').datasets.length, 9);
  assert.deepEqual(result.entries, curated(s.repo, 'datasets.json').datasets);
  assert.equal(result.sources['organism.orthomclAbbrev'], 'given (--organism orthomclAbbrev)');
  assert.match(result.diff, /Proposals\/GCA_000001\.1\/curated\/datasets\.json/);
  assert.match(result.diff, /\+  "schemaVersion": 2,/);
});

test('a re-run replaces what the amendment owns and keeps the rest', async () => {
  const s = setup();
  await amend(s);
  editJson(join(s.repo, 'Proposals', ACCESSION, 'curated/organism.json'), (r) => ({ ...r, organismFullName: 'Testus fakeus strain ST-1' }));
  await amend(s, { isCore: 'true' });
  const record = curated(s.repo, 'organism.json');
  assert.equal(record.organismFullName, 'Testus fakeus strain ST-1');
  assert.equal(record.isCore, 'true');
  assert.equal(record.orthomclAbbrev, 'tfak');
  assert.equal(curated(s.repo, 'datasets.json').datasets.length, 9);
});

test('amendProposal refuses another branch, a type without the hook, and a missing work area, writing nothing', async () => {
  const s = setup();
  git(s.repo, 'checkout', '-q', 'master');
  await assert.rejects(amend(s), /Expected to be on proposal\/GCA_000001\.1, but on "master"/);
  assert.equal(curated(s.repo, 'organism.json').schemaVersion, 1);

  const rna = setup();
  cpSync(join(fixtures, 'proposals/PRJNA000002'), join(rna.repo, 'Proposals/PRJNA000002'), { recursive: true });
  git(rna.repo, 'checkout', '-q', '-b', 'proposal/PRJNA000002');
  await assert.rejects(amend(rna, {}, 'PRJNA000002'), /bulk-rnaseq proposals are not amended from preprocessing/);

  const bare = setup({ workArea: false });
  await assert.rejects(amend(bare), /No preprocessing work area for GCA_000001\.1 at .*annotated-genome-validation\/proposals\/GCA_000001\.1\/preprocess; run preprocessing there first/);
  assert.equal(curated(bare.repo, 'organism.json').schemaVersion, 1);
});

test('amendProposal validates the amended proposal against classes.xml before writing', async () => {
  const s = setup();
  const classes = join(s.repo, 'Model/lib/xml/datasetClass/classes.xml');
  writeFileSync(classes, readFileSync(classes, 'utf-8').replace(/<datasetClass class="geneName"[\s\S]*?<\/datasetClass>/, ''));
  await assert.rejects(amend(s), /geneName GenBank: Dataset class "geneName" not found/);
  assert.deepEqual(curated(s.repo, 'datasets.json').datasets, []);
  assert.equal(curated(s.repo, 'organism.json').schemaVersion, 1);
});
