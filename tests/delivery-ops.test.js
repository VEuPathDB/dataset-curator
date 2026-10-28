import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createGit } from '../shared/scripts/lib/git-ops.js';
import { prepareDelivery } from '../shared/scripts/lib/delivery-ops.js';
import { formatReportComment } from '../shared/scripts/lib/validation.js';
import { fixtures, initRepo, stubTicket, stubGh, validationRoot } from './helpers.js';

const TICKET = { system: 'github', id: '43', url: 'https://r/issues/43' };
const FINAL = 'FungiDB/tfakST1/rnaSeq/Doe_heat_shock_2024/2024-05-01/final';
const CORPUS = 'common/rnaSeq/sampleDetailsForEda/2026-10/final/tfakST1_Doe_heat_shock_2024_rnaSeq_RSRC';

/**
 * PRJNA000002 merged on master with a ticket, origin/rebuild02 cut before it, and a validation root whose hosts are local dirs.
 * organisms replaces the manifest's; genome also merges genome proposal GCA_000001.1.
 */
function setup({ staging, organisms, genome = false } = {}) {
  const { repo } = initRepo('delivery-ops-');
  writeFileSync(join(repo, 'Model/lib/xml/datasetPresenters/FungiDB.xml'), '<?xml version="1.0"?>\n<datasetPresenters>\n</datasetPresenters>\n');
  execFileSync('git', ['-C', repo, 'add', '-A']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'presenters']);
  execFileSync('git', ['-C', repo, 'push', '-q', 'origin', 'HEAD:rebuild02']);
  const dir = join(repo, 'Proposals/PRJNA000002');
  cpSync(join(fixtures, 'proposals/PRJNA000002'), dir, { recursive: true });
  if (genome) cpSync(join(fixtures, 'proposals/GCA_000001.1'), join(repo, 'Proposals/GCA_000001.1'), { recursive: true });
  const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf-8'));
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ ...m, ticket: TICKET, ...(staging ? { staging } : {}), ...(organisms ? { organisms } : {}) }, null, 2) + '\n');
  execFileSync('git', ['-C', repo, 'add', '-A']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'merge PRJNA000002']);
  execFileSync('git', ['-C', repo, 'push', '-q']);
  const git = createGit(repo, { exec: stubGh().exec });
  git.fetch();
  const hosts = mkdtempSync(join(tmpdir(), 'hosts-'));
  mkdirSync(join(hosts, 'manualDelivery/common/rnaSeq/sampleDetailsForEda'), { recursive: true });
  const { root, typeDir } = validationRoot({});
  const env = JSON.parse(readFileSync(join(typeDir, 'env.json'), 'utf-8'));
  writeFileSync(join(typeDir, 'env.json'), JSON.stringify({ ...env, staging: { host: 'local', root: join(hosts, 'dataStaging') }, manualDelivery: { host: 'local', root: join(hosts, 'manualDelivery') } }));
  const report = { schemaVersion: 1, accession: 'PRJNA000002', datasetType: 'bulk-rnaseq', proposalTree: git.objectId('origin/master', 'Proposals/PRJNA000002'), against: null, workspace: '/ws', tools: {}, findings: [], verdict: 'pass' };
  const ticket = stubTicket({ status: 'verifying', existingComments: [formatReportComment(report)] });
  return { repo, git, root, typeDir, hosts, ticket };
}

// Hosts named "local" read the local filesystem, as the deployed code reads yew.
const localRemote = () => (host) => (host === 'local' ? { host: null } : { host });
const prepare = (s, opts = {}) => prepareDelivery({ git: s.git, ticket: s.ticket, workspace: s.root, against: 'origin/rebuild02', accession: 'PRJNA000002', remoteOf: localRemote(), ...opts });

test('prepareDelivery writes final/, fromProvider/, workspace/, the corpus STF and a record', async () => {
  const s = setup();
  const { dir, record, handoff } = await prepare(s);
  assert.equal(dir, join(s.typeDir, 'delivery/PRJNA000002'));
  assert.ok(existsSync(join(dir, FINAL, 'samplesheet.csv')));
  assert.ok(existsSync(join(dir, FINAL, '../fromProvider/PRJNA000002/manifest.json')));
  assert.ok(existsSync(join(dir, FINAL, '../workspace')));
  assert.ok(existsSync(join(dir, CORPUS, 'entity-sample.tsv')));
  assert.equal(record.against, 'origin/rebuild02');
  assert.equal(record.release, '2026-10');
  assert.deepEqual(record.settlement, [{ proposed: 'tfakST1', abbrev: 'tfakST1' }]);
  assert.equal(record.proposalTree, s.git.objectId('origin/master', 'Proposals/PRJNA000002'));
  assert.match(record.corpusStep, /make-cumulative-links\.sh 2026-10'$/);
  assert.match(handoff, /^  rsync -a --exclude delivery\.json /m);
});

test('a re-run replaces the delivery but keeps workspace/', async () => {
  const s = setup();
  const { dir } = await prepare(s);
  writeFileSync(join(dir, FINAL, '../workspace/notes.txt'), 'kept');
  await prepare(s);
  assert.equal(readFileSync(join(dir, FINAL, '../workspace/notes.txt'), 'utf-8'), 'kept');
  assert.ok(existsSync(join(dir, FINAL, 'samplesheet.csv')));
});

test('prepareDelivery copies listed staging files and stops on a missing or mismatched one', async () => {
  const sha = 'b'.repeat(64);
  const s = setup({ staging: [{ path: 'reads/a.fq.gz' }, { path: 'big.gff3', sha256: sha }] });
  await assert.rejects(prepare(s), /dataStaging\/PRJNA000002 is missing on local/);
  mkdirSync(join(s.hosts, 'dataStaging/PRJNA000002/reads'), { recursive: true });
  writeFileSync(join(s.hosts, 'dataStaging/PRJNA000002/reads/a.fq.gz'), 'fq');
  await assert.rejects(prepare(s), /dataStaging\/PRJNA000002 lacks big\.gff3/);
  writeFileSync(join(s.hosts, 'dataStaging/PRJNA000002/big.gff3'), 'gff');
  await assert.rejects(prepare(s), /big\.gff3 has sha256 [0-9a-f]{64}, not b{64}/);
  assert.equal(existsSync(join(s.typeDir, 'delivery/PRJNA000002')), false);
});

test('prepareDelivery copies staging files into fromProvider/ beside the proposal', async () => {
  const gff = 'gff';
  const sha = createHash('sha256').update(gff).digest('hex');
  const s = setup({ staging: [{ path: 'reads/a.fq.gz' }, { path: 'big.gff3', sha256: sha }] });
  const stagingRoot = join(s.hosts, 'dataStaging/PRJNA000002');
  mkdirSync(join(stagingRoot, 'reads'), { recursive: true });
  writeFileSync(join(stagingRoot, 'reads/a.fq.gz'), 'fq');
  writeFileSync(join(stagingRoot, 'big.gff3'), gff);
  const { dir, record } = await prepare(s);
  const fromProvider = join(dir, FINAL, '../fromProvider');
  assert.equal(readFileSync(join(fromProvider, 'big.gff3'), 'utf-8'), gff);
  assert.equal(readFileSync(join(fromProvider, 'reads/a.fq.gz'), 'utf-8'), 'fq');
  assert.ok(existsSync(join(fromProvider, 'PRJNA000002/manifest.json')));
  assert.deepEqual(record.staging, { host: 'local', path: stagingRoot, files: ['reads/a.fq.gz', 'big.gff3'] });
  const listed = Object.fromEntries(record.files.map((f) => [f.path, f.sha256]));
  const fromProviderRel = join(FINAL, '../fromProvider');
  assert.equal(listed[join(fromProviderRel, 'big.gff3')], sha);
  assert.equal(listed[join(fromProviderRel, 'reads/a.fq.gz')], createHash('sha256').update('fq').digest('hex'));
});

test('a staging entry named for the accession is refused, not merged into the proposal copy', async () => {
  const s = setup({ staging: [{ path: 'big.gff3' }] });
  const stagingRoot = join(s.hosts, 'dataStaging/PRJNA000002');
  mkdirSync(join(stagingRoot, 'PRJNA000002'), { recursive: true });
  writeFileSync(join(stagingRoot, 'PRJNA000002/manifest.json'), '{}');
  writeFileSync(join(stagingRoot, 'big.gff3'), 'gff');
  await assert.rejects(prepare(s), /dataStaging\/PRJNA000002 has an entry named PRJNA000002, which would collide with the proposal copy in fromProvider\//);
  assert.equal(existsSync(join(s.typeDir, 'delivery/PRJNA000002')), false);
});

test('prepareDelivery refusals: status, report, against, release, corpus clash', async () => {
  const s = setup();
  await assert.rejects(prepare(s, { against: 'rebuild02' }), /--against must be origin\/rebuild<RR>/);
  await assert.rejects(prepare({ ...s, ticket: stubTicket({ status: 'ready' }) }), /is at "Ready to load"; prepare the delivery while it is "Proposed" or "Preprocessing"/);
  await assert.rejects(prepare({ ...s, ticket: stubTicket({ status: 'verifying' }) }), /has no verification report/);
  await assert.rejects(prepare({ ...s, ticket: stubTicket({ status: 'verifying', existingComments: s.ticket.notes, release: null }) }), /has no due date/);
  mkdirSync(join(s.hosts, 'manualDelivery/common/rnaSeq/sampleDetailsForEda/2026-07/final/tfakST1_Doe_heat_shock_2024_rnaSeq_RSRC'), { recursive: true });
  await assert.rejects(prepare(s), /tfakST1_Doe_heat_shock_2024_rnaSeq_RSRC is already in 2026-07\/final/);
  assert.equal(existsSync(join(s.typeDir, 'delivery/PRJNA000002')), false);
});

test('an organism stop is an error at prepare', async () => {
  const s = setup();
  // tfakST2 has no organism file on rebuild02, and settle never clears a missing abbreviation.
  await assert.rejects(prepare(s, { settle: { tfakST1: 'tfakST2' } }), /Organism abbreviations need a person/);
  assert.equal(existsSync(join(s.typeDir, 'delivery/PRJNA000002')), false);
});

test('--settle resolves an organism stop', async () => {
  // Linked to genome GCA_000001.1 (taxon 999001), which no organism file on rebuild02 records.
  const s = setup({ genome: true, organisms: [{ proposedOrganismAbbrev: 'tfakST1', source: { proposal: 'GCA_000001.1' }, project: 'FungiDB' }] });
  await assert.rejects(prepare(s), /tfakST1: genome proposal GCA_000001\.1 .* is not loaded on this branch/);
  const { record } = await prepare(s, { settle: { tfakST1: 'tfakST1' } });
  assert.deepEqual(record.settlement, [{ proposed: 'tfakST1', abbrev: 'tfakST1' }]);
});
