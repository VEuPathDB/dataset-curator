import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createGit } from '../shared/scripts/lib/git-ops.js';
import { prepareDelivery } from '../shared/scripts/lib/delivery-ops.js';
import { markReady } from '../shared/scripts/lib/verification-ops.js';
import { loadProposal } from '../shared/scripts/lib/load-ops.js';
import { deliveryReader } from '../shared/scripts/lib/validation-workspace.js';
import { formatReportComment, latestDeliveryRecord } from '../shared/scripts/lib/validation.js';
import { fixtures, initRepo, stubTicket, stubGh, validationRoot } from './helpers.js';

const ACCESSION = 'PRJNA000002';
const TICKET = { system: 'github', id: '43', url: 'https://r/issues/43' };
const noFindings = async () => [];

const run = (repo, ...args) => execFileSync('git', ['-C', repo, ...args]);

/** A passing report for the proposal as origin/master has it now. */
const reportComment = (git) => formatReportComment({
  schemaVersion: 1, accession: ACCESSION, datasetType: 'bulk-rnaseq', proposalTree: git.objectId('origin/master', `Proposals/${ACCESSION}`),
  against: null, workspace: '/ws', tools: {}, findings: [], verdict: 'pass'
});

/** PRJNA000002 merged on master with a ticket, origin/rebuild02 cut before it, a validation root on local hosts, one ticket for every step. */
function setup() {
  const { repo } = initRepo('delivery-roundtrip-');
  writeFileSync(join(repo, 'Model/lib/xml/datasetPresenters/FungiDB.xml'), '<?xml version="1.0"?>\n<datasetPresenters>\n</datasetPresenters>\n');
  run(repo, 'add', '-A');
  run(repo, 'commit', '-q', '-m', 'presenters');
  run(repo, 'push', '-q', 'origin', 'HEAD:rebuild02');
  const dir = join(repo, 'Proposals', ACCESSION);
  cpSync(join(fixtures, 'proposals', ACCESSION), dir, { recursive: true });
  const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf-8'));
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ ...m, ticket: TICKET }, null, 2) + '\n');
  run(repo, 'add', '-A');
  run(repo, 'commit', '-q', '-m', `merge ${ACCESSION}`);
  run(repo, 'push', '-q');
  const gh = stubGh({ url: 'https://github.com/VEuPathDB/VEuPathDatasets/pull/50' });
  const git = createGit(repo, { exec: gh.exec });
  git.fetch();
  const hosts = mkdtempSync(join(tmpdir(), 'hosts-'));
  const { root, typeDir } = validationRoot({});
  const env = JSON.parse(readFileSync(join(typeDir, 'env.json'), 'utf-8'));
  writeFileSync(join(typeDir, 'env.json'), JSON.stringify({ ...env, staging: { host: 'local', root: join(hosts, 'dataStaging') }, manualDelivery: { host: 'local', root: join(hosts, 'manualDelivery') } }));
  const statuses = { [TICKET.id]: 'verifying' };
  const ticket = stubTicket({ statuses, existingComments: [reportComment(git)] });
  return { repo, git, gh, root, ticket, statuses };
}

const localRemote = (host) => (host === 'local' ? { host: null } : { host });
const disposal = () => ({ assertDisposable() {}, where: () => ({ typeDir: '/ws', dir: `/ws/proposals/${ACCESSION}` }), dispose: () => null });

const prepare = (s) => prepareDelivery({ git: s.git, ticket: s.ticket, workspace: s.root, against: 'origin/rebuild02', accession: ACCESSION, remoteOf: localRemote });
const ready = (s) => markReady({ git: s.git, ticket: s.ticket, accession: ACCESSION, workspace: disposal(), delivery: deliveryReader({ root: s.root, accession: ACCESSION }) });
const load = (s, opts = {}) => {
  run(s.repo, 'checkout', '-q', '-B', 'rebuild02', 'origin/rebuild02');
  return loadProposal({ git: s.git, ticket: s.ticket, repoPath: s.repo, rebuildBranch: 'rebuild02', validate: noFindings, accession: ACCESSION, ...opts });
};

/** A curated text edit merged on master after the delivery was prepared. */
function amendOnMaster(s) {
  run(s.repo, 'checkout', '-q', 'master');
  const path = join(s.repo, 'Proposals', ACCESSION, 'curated/presenter.json');
  const presenter = JSON.parse(readFileSync(path, 'utf-8'));
  writeFileSync(path, JSON.stringify({ ...presenter, description: `${presenter.description ?? ''} Amended.` }, null, 2) + '\n');
  run(s.repo, 'commit', '-q', '-am', 'amend presenter text');
  run(s.repo, 'push', '-q');
  s.git.fetch();
}

test('a delivery prepare-delivery writes is the one mark-ready posts and load accepts', async () => {
  const s = setup();
  const { record } = await prepare(s);
  await ready(s);
  assert.equal(s.statuses[TICKET.id], 'ready');
  const posted = latestDeliveryRecord(s.ticket.notes).record;
  assert.equal(posted.proposalTree, record.proposalTree);
  assert.equal(posted.build, '02');

  const dry = await load(s, { dryRun: true });
  assert.ok(!dry.warnings.some((w) => /delivery/i.test(w)), dry.warnings.join('\n'));
  const loaded = await load(s);
  assert.equal(loaded.corpusStep, record.corpusStep);
  assert.deepEqual(loaded.settled.map((o) => o.abbrev), record.settlement.map((o) => o.abbrev));
  assert.equal(s.statuses[TICKET.id], 'loading');
});

test('a proposal amended after its delivery is refused by mark-ready and load until the delivery is prepared again', async () => {
  const s = setup();
  await prepare(s);
  await ready(s);
  amendOnMaster(s);

  await assert.rejects(load(s), /The delivery record is for an earlier version of PRJNA000002; run prepare-delivery\.js/);
  const dry = await load(s, { dryRun: true });
  assert.ok(dry.warnings.some((w) => /earlier version of PRJNA000002.*this dry run settles organisms afresh/.test(w)));

  s.statuses[TICKET.id] = 'verifying';
  s.ticket.notes.push(reportComment(s.git));
  await assert.rejects(ready(s), /The delivery of PRJNA000002 is for an earlier version of it; run prepare-delivery\.js again/);
  assert.equal(s.statuses[TICKET.id], 'verifying');

  await prepare(s);
  await ready(s);
  const loaded = await load(s);
  assert.match(loaded.corpusStep, /make-cumulative-links\.sh 2026-10/);
});
