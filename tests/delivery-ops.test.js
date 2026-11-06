import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, rmSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync, symlinkSync, readdirSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as bulkRnaseq from '../shared/scripts/dataset-types/bulk-rnaseq.js';
import { createGit } from '../shared/scripts/lib/git-ops.js';
import { prepareDelivery } from '../shared/scripts/lib/delivery-ops.js';
import { CLASSES_RELATIVE_PATH } from '../shared/scripts/lib/dataset-classes.js';
import { formatReportComment } from '../shared/scripts/lib/validation.js';
import { fixtures, initRepo, stubTicket, stubGh, validationRoot } from './helpers.js';

const TICKET = { system: 'github', id: '43', url: 'https://r/issues/43' };
const FINAL = 'FungiDB/tfakST1/rnaSeq/Doe_heat_shock_2024/2024-05-01/final';
const CORPUS = 'common/rnaSeq/sampleDetailsForEda/2026-10/final/tfakST1_Doe_heat_shock_2024_rnaSeq_RSRC';

/**
 * PRJNA000002 merged on master with a ticket, origin/rebuild02 cut before it, and a validation root whose hosts are local dirs.
 * organisms replaces the manifest's; genome also merges genome proposal GCA_000001.1.
 */
function setup({ staging, organisms, genome = false, proposalId = 'PRJNA000002' } = {}) {
  const { repo } = initRepo('delivery-ops-');
  writeFileSync(join(repo, 'Model/lib/xml/datasetPresenters/FungiDB.xml'), '<?xml version="1.0"?>\n<datasetPresenters>\n</datasetPresenters>\n');
  execFileSync('git', ['-C', repo, 'add', '-A']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'presenters']);
  execFileSync('git', ['-C', repo, 'push', '-q', 'origin', 'HEAD:rebuild02']);
  const dir = join(repo, 'Proposals', proposalId);
  cpSync(join(fixtures, 'proposals/PRJNA000002'), dir, { recursive: true });
  if (genome) cpSync(join(fixtures, 'proposals/GCA_000001.1'), join(repo, 'Proposals/GCA_000001.1'), { recursive: true });
  const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf-8'));
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ ...m, ticket: TICKET, ...(staging ? { staging } : {}), ...(organisms ? { organisms } : {}) }, null, 2) + '\n');
  execFileSync('git', ['-C', repo, 'add', '-A']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', `merge ${proposalId}`]);
  execFileSync('git', ['-C', repo, 'push', '-q']);
  const git = createGit(repo, { exec: stubGh().exec });
  git.fetch();
  const hosts = mkdtempSync(join(tmpdir(), 'hosts-'));
  mkdirSync(join(hosts, 'manualDelivery/common/rnaSeq/sampleDetailsForEda'), { recursive: true });
  const { root, typeDir } = validationRoot({});
  const env = JSON.parse(readFileSync(join(typeDir, 'env.json'), 'utf-8'));
  writeFileSync(join(typeDir, 'env.json'), JSON.stringify({ ...env, staging: { host: 'local', root: join(hosts, 'dataStaging') }, manualDelivery: { host: 'local', root: join(hosts, 'manualDelivery') } }));
  const report = { schemaVersion: 1, accession: 'PRJNA000002', datasetType: 'bulk-rnaseq', proposalTree: git.objectId('origin/master', `Proposals/${proposalId}`), against: null, workspace: '/ws', tools: {}, findings: [], verdict: 'pass' };
  const ticket = stubTicket({ status: 'verifying', existingComments: [formatReportComment(report)] });
  return { repo, git, root, typeDir, hosts, ticket, proposalId };
}

// Hosts named "local" read the local filesystem, as the deployed code reads yew.
const localRemote = () => (host) => (host === 'local' ? { host: null } : { host });
const prepare = (s, opts = {}) => prepareDelivery({ git: s.git, ticket: s.ticket, workspace: s.root, against: 'origin/rebuild02', proposalId: s.proposalId, remoteOf: localRemote(), ...opts });

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
  assert.match(handoff, /^  rsync -rlt --omit-dir-times --exclude delivery\.json '/m);
});

test('prepareDelivery reads classes.xml once per class', async () => {
  const s = setup();
  const reads = [];
  const git = { ...s.git, showFile: (ref, path) => { reads.push(path); return s.git.showFile(ref, path); } };
  await prepare({ ...s, git });
  assert.equal(reads.filter((p) => p === CLASSES_RELATIVE_PATH).length, 1);
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
  symlinkSync('../big.gff3', join(stagingRoot, 'reads/alias.gff3'));
  const cache = join(s.typeDir, 'delivery/PRJNA000002.staging');
  mkdirSync(cache, { recursive: true });
  mkdirSync(join(cache, 'old'), { recursive: true });
  writeFileSync(join(cache, 'old/stale.txt'), 'no longer listed');
  const { dir, record } = await prepare(s);
  const fromProvider = join(dir, FINAL, '../fromProvider');
  assert.equal(existsSync(cache), false);
  assert.equal(existsSync(join(fromProvider, 'old')), false);
  assert.equal(existsSync(join(fromProvider, 'reads/alias.gff3')), false);
  assert.equal(readFileSync(join(fromProvider, 'big.gff3'), 'utf-8'), gff);
  assert.equal(readFileSync(join(fromProvider, 'reads/a.fq.gz'), 'utf-8'), 'fq');
  assert.ok(existsSync(join(fromProvider, 'PRJNA000002/manifest.json')));
  assert.deepEqual(record.staging, { host: 'local', path: stagingRoot, files: ['reads/a.fq.gz', 'big.gff3'] });
  const listed = Object.fromEntries(record.files.map((f) => [f.path, f.sha256]));
  const fromProviderRel = join(FINAL, '../fromProvider');
  assert.equal(listed[join(fromProviderRel, 'big.gff3')], sha);
  assert.equal(listed[join(fromProviderRel, 'reads/a.fq.gz')], createHash('sha256').update('fq').digest('hex'));
});

test('a corpus clash is refused before staging is pulled', async () => {
  const s = setup({ staging: [{ path: 'big.gff3' }] });
  mkdirSync(join(s.hosts, 'dataStaging/PRJNA000002'), { recursive: true });
  writeFileSync(join(s.hosts, 'dataStaging/PRJNA000002/big.gff3'), 'gff');
  mkdirSync(join(s.hosts, 'manualDelivery/common/rnaSeq/sampleDetailsForEda/2026-07/final/tfakST1_Doe_heat_shock_2024_rnaSeq_RSRC'), { recursive: true });
  await assert.rejects(prepare(s), /is already in 2026-07\/final/);
  assert.equal(existsSync(join(s.typeDir, 'delivery/PRJNA000002.staging')), false);
  assert.equal(existsSync(join(s.typeDir, 'delivery/PRJNA000002')), false);
});

test('a failed staging check keeps the pulled staging for the next run', async () => {
  const s = setup({ staging: [{ path: 'big.gff3', sha256: 'b'.repeat(64) }] });
  mkdirSync(join(s.hosts, 'dataStaging/PRJNA000002'), { recursive: true });
  writeFileSync(join(s.hosts, 'dataStaging/PRJNA000002/big.gff3'), 'gff');
  await assert.rejects(prepare(s), /big\.gff3 has sha256/);
  assert.equal(readFileSync(join(s.typeDir, 'delivery/PRJNA000002.staging/big.gff3'), 'utf-8'), 'gff');
});

test('a listed staging directory is refused rather than delivered empty', async () => {
  const s = setup({ staging: [{ path: 'reads' }] });
  mkdirSync(join(s.hosts, 'dataStaging/PRJNA000002/reads'), { recursive: true });
  writeFileSync(join(s.hosts, 'dataStaging/PRJNA000002/reads/a.fq.gz'), 'fq');
  await assert.rejects(prepare(s), /dataStaging\/PRJNA000002: staging lists reads, which is a directory; list its files/);
  assert.equal(existsSync(join(s.typeDir, 'delivery/PRJNA000002')), false);
});

test('a listed path ending in "/" is refused as not naming a file, not reported missing', async () => {
  const s = setup({ staging: [{ path: 'reads/' }] });
  mkdirSync(join(s.hosts, 'dataStaging/PRJNA000002/reads'), { recursive: true });
  writeFileSync(join(s.hosts, 'dataStaging/PRJNA000002/reads/a.fq.gz'), 'fq');
  await assert.rejects(prepare(s), /staging\[0\]\.path must name a file, not end in "\/"/);
  assert.equal(existsSync(join(s.typeDir, 'delivery/PRJNA000002')), false);
});

test('a listed symlink arrives as the file it points to', async () => {
  const sha = createHash('sha256').update('gff').digest('hex');
  const s = setup({ staging: [{ path: 'reads/alias.gff3', sha256: sha }] });
  const stagingRoot = join(s.hosts, 'dataStaging/PRJNA000002');
  mkdirSync(join(stagingRoot, 'reads'), { recursive: true });
  writeFileSync(join(stagingRoot, 'big.gff3'), 'gff');
  symlinkSync('../big.gff3', join(stagingRoot, 'reads/alias.gff3'));
  const { dir } = await prepare(s);
  const fromProvider = join(dir, FINAL, '../fromProvider');
  assert.ok(lstatSync(join(fromProvider, 'reads/alias.gff3')).isFile());
  assert.equal(readFileSync(join(fromProvider, 'reads/alias.gff3'), 'utf-8'), 'gff');
  assert.equal(existsSync(join(fromProvider, 'big.gff3')), false);
});

test('a bulk-rnaseq sibling (another type holds the accession) is delivered under its id from its own staging', async () => {
  const s = setup({ proposalId: 'PRJNA000002_bulk-rnaseq', staging: [{ path: 'big.gff3' }] });
  mkdirSync(join(s.hosts, 'dataStaging/PRJNA000002_bulk-rnaseq'), { recursive: true });
  writeFileSync(join(s.hosts, 'dataStaging/PRJNA000002_bulk-rnaseq/big.gff3'), 'gff');
  const { dir, record } = await prepare(s);
  assert.equal(dir, join(s.typeDir, 'delivery/PRJNA000002_bulk-rnaseq'));
  assert.ok(existsSync(join(dir, FINAL, '../fromProvider/PRJNA000002_bulk-rnaseq/manifest.json')));
  assert.equal(record.staging.path, join(s.hosts, 'dataStaging/PRJNA000002_bulk-rnaseq'));
  assert.equal(record.accession, 'PRJNA000002');
  assert.equal(record.proposalId, 'PRJNA000002_bulk-rnaseq');
  const elsewhere = setup({ proposalId: 'PRJNA000002_bulk-rnaseq', staging: [{ path: 'big.gff3' }] });
  mkdirSync(join(elsewhere.hosts, 'dataStaging/PRJNA000002'), { recursive: true });
  writeFileSync(join(elsewhere.hosts, 'dataStaging/PRJNA000002/big.gff3'), 'gff');
  await assert.rejects(prepare(elsewhere), /dataStaging\/PRJNA000002_bulk-rnaseq is missing on local/);
});

test('a listed staging path under the proposal id is refused, not merged into the proposal copy; an unlisted one is ignored', async () => {
  const s = setup({ staging: [{ path: 'big.gff3' }] });
  const stagingRoot = join(s.hosts, 'dataStaging/PRJNA000002');
  mkdirSync(join(stagingRoot, 'PRJNA000002'), { recursive: true });
  writeFileSync(join(stagingRoot, 'PRJNA000002/manifest.json'), '{}');
  writeFileSync(join(stagingRoot, 'big.gff3'), 'gff');
  const { dir } = await prepare(s);
  assert.notEqual(readFileSync(join(dir, FINAL, '../fromProvider/PRJNA000002/manifest.json'), 'utf-8'), '{}');
  const listing = setup({ staging: [{ path: 'big.gff3' }, { path: 'PRJNA000002/manifest.json' }] });
  cpSync(stagingRoot, join(listing.hosts, 'dataStaging/PRJNA000002'), { recursive: true });
  await assert.rejects(prepare(listing), /staging lists PRJNA000002\/manifest\.json, which would collide with the proposal copy fromProvider\/PRJNA000002\//);
  assert.equal(existsSync(join(listing.typeDir, 'delivery/PRJNA000002')), false);
});

test('for a sibling, a listed path under its id is refused', async () => {
  const clash = setup({ proposalId: 'PRJNA000002_bulk-rnaseq', staging: [{ path: 'PRJNA000002_bulk-rnaseq/notes.txt' }] });
  mkdirSync(join(clash.hosts, 'dataStaging/PRJNA000002_bulk-rnaseq'), { recursive: true });
  await assert.rejects(prepare(clash), /staging lists PRJNA000002_bulk-rnaseq\/notes\.txt, which would collide with the proposal copy fromProvider\/PRJNA000002_bulk-rnaseq\//);
});

test('siblings each read their own drop', async () => {
  const rnaseq = setup({ proposalId: 'PRJNA000002_bulk-rnaseq', staging: [{ path: 'a.fq.gz' }] });
  const other = setup({ staging: [{ path: 'b.fq.gz' }] });
  for (const s of [rnaseq, other]) {
    for (const [id, file] of [['PRJNA000002_bulk-rnaseq', 'a.fq.gz'], ['PRJNA000002', 'b.fq.gz']]) {
      mkdirSync(join(s.hosts, 'dataStaging', id), { recursive: true });
      writeFileSync(join(s.hosts, 'dataStaging', id, file), file);
    }
  }
  const contents = async (s) => {
    const fromProvider = join((await prepare(s)).dir, FINAL, '../fromProvider');
    return readdirSync(fromProvider, { recursive: true }).filter((p) => !p.startsWith(s.proposalId)).sort();
  };
  assert.deepEqual(await contents(rnaseq), ['a.fq.gz']);
  assert.deepEqual(await contents(other), ['b.fq.gz']);
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

test('prepareDelivery refuses invalid dataset entries before reading the report', async () => {
  const s = setup();
  const dir = join(s.repo, 'Proposals', s.proposalId);
  const { datasetClass, name, version, ...m } = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf-8'));
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(m, null, 2) + '\n');
  rmSync(join(dir, 'curated', 'dataset.json'));
  execFileSync('git', ['-C', s.repo, 'commit', '-qam', 'no entries']);
  execFileSync('git', ['-C', s.repo, 'push', '-q']);
  s.git.fetch();
  await assert.rejects(prepare(s), /Invalid dataset entries of PRJNA000002:\n  - bulk-rnaseq proposals hold exactly one dataset entry; this one has 0/);
  assert.equal(s.ticket.calls.some((c) => c[0] === 'listComments'), false);
});

const GENOME_ENTRY = {
  datasetClass: 'fasta_primary_genome_sequence', name: 'GenBank', version: '2017-03-09',
  props: { ncbiTaxonId: '$$ncbiTaxonId$$', table: 'DoTS::ExternalNASequence', soTerm: 'chromosome', sourceIdRegex: '^>(\\S+)', releaseDate: '' },
  source: { type: 'server', paths: ['/data/tfakST-1'] }
};

function setupGenome(entries) {
  const s = setup({ genome: true });
  const dir = join(s.repo, 'Proposals/GCA_000001.1');
  const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf-8'));
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ ...m, ticket: TICKET }, null, 2) + '\n');
  if (entries.length) writeFileSync(join(dir, 'curated', 'datasets.json'), JSON.stringify({ schemaVersion: 2, datasets: entries }, null, 2) + '\n');
  execFileSync('git', ['-C', s.repo, 'add', '-A']);
  execFileSync('git', ['-C', s.repo, 'commit', '-q', '-m', 'genome entries']);
  execFileSync('git', ['-C', s.repo, 'push', '-q']);
  s.git.fetch();
  const genomeDir = join(s.root, 'annotated-genome-validation');
  mkdirSync(genomeDir);
  writeFileSync(join(genomeDir, 'env.json'), readFileSync(join(s.typeDir, 'env.json')));
  const report = {
    schemaVersion: 1, accession: 'GCA_000001.1', proposalId: 'GCA_000001.1', datasetType: 'genome-assembly',
    proposalTree: s.git.objectId('origin/master', 'Proposals/GCA_000001.1'), against: null, workspace: '/ws', tools: {}, findings: [], verdict: 'pass'
  };
  const ticket = stubTicket({ status: 'verifying', existingComments: [formatReportComment(report)] });
  return { ...s, ticket, proposalId: 'GCA_000001.1' };
}

test('prepareDelivery asks for preprocessing when a genome with entries has no work area', async () => {
  const s = setupGenome([GENOME_ENTRY]);
  await assert.rejects(prepare(s), /No preprocessing work area for GCA_000001\.1 at .*annotated-genome-validation\/proposals\/GCA_000001\.1\/preprocess; run preprocessing there first/);
});

test('prepareDelivery refuses a proposal with no dataset entries', async () => {
  const s = setupGenome([]);
  await assert.rejects(prepare(s), /Proposal GCA_000001\.1 has no dataset entries, so it has no delivery/);
});

/** bulk-rnaseq plus a preprocessedFiles hook; calls records each location it was asked about. */
function withHook(result) {
  const calls = [];
  const type = { ...bulkRnaseq, preprocessedFiles: (proposalDir, location, ctx) => { calls.push({ location, ctx }); return result(ctx.workArea, location); } };
  return { calls, loadType: async () => type };
}
const workArea = (s) => join(s.typeDir, 'proposals', s.proposalId, 'preprocess');

test('prepareDelivery hands the hook the current verification report and records the commit it prepared against', async () => {
  const s = setup();
  mkdirSync(workArea(s), { recursive: true });
  const { loadType, calls } = withHook(() => ({ files: [], problems: [] }));
  const { record } = await prepare(s, { loadType });
  assert.equal(calls[0].ctx.report.proposalTree, s.git.objectId('origin/master', 'Proposals/PRJNA000002'));
  assert.equal(record.againstCommit, execFileSync('git', ['-C', s.repo, 'rev-parse', 'origin/rebuild02'], { encoding: 'utf-8' }).trim());
  assert.equal(JSON.parse(readFileSync(join(s.typeDir, 'delivery/PRJNA000002/delivery.json'), 'utf-8')).againstCommit, record.againstCommit);
});

test('prepareDelivery refuses a type with preprocessedFiles when its work area is missing, writing nothing', async () => {
  const s = setup();
  const { loadType } = withHook(() => ({ files: [] }));
  await assert.rejects(prepare(s, { loadType }), /No preprocessing work area for PRJNA000002 at .*proposals\/PRJNA000002\/preprocess; run preprocessing there first/);
  assert.equal(existsSync(join(s.typeDir, 'delivery/PRJNA000002')), false);
  assert.equal(existsSync(join(s.typeDir, 'delivery/PRJNA000002.staging')), false);
});

test('prepareDelivery refuses the type\'s problems under the entry label, pulling no staging', async () => {
  const s = setup({ staging: [{ path: 'reads/a.fq.gz' }] });
  mkdirSync(join(s.hosts, 'dataStaging/PRJNA000002/reads'), { recursive: true });
  writeFileSync(join(s.hosts, 'dataStaging/PRJNA000002/reads/a.fq.gz'), 'fq');
  mkdirSync(workArea(s), { recursive: true });
  const { loadType } = withHook(() => ({ files: [], problems: ['build is stale'] }));
  await assert.rejects(prepare(s, { loadType }), /PRJNA000002: the preprocessing work area cannot be delivered:\n  - rnaSeqExperiment .*: build is stale/);
  assert.equal(existsSync(join(s.typeDir, 'delivery/PRJNA000002')), false);
  assert.equal(existsSync(join(s.typeDir, 'delivery/PRJNA000002.staging')), false);
});

test('prepareDelivery copies the work area files into final/ and records provenance by delivery directory', async () => {
  const s = setup();
  mkdirSync(workArea(s), { recursive: true });
  writeFileSync(join(workArea(s), 'reads.bam'), 'bam');
  const { loadType, calls } = withHook((w) => ({ files: [{ path: 'reads.bam', from: join(w, 'reads.bam') }], problems: [], provenance: { build: 'abc' } }));
  const { dir, record } = await prepare(s, { loadType });
  assert.equal(calls[0].ctx.workArea, workArea(s));
  assert.equal(calls[0].location.relative, FINAL);
  assert.equal(readFileSync(join(dir, FINAL, 'reads.bam'), 'utf-8'), 'bam');
  assert.ok(existsSync(join(dir, FINAL, 'samplesheet.csv')));
  assert.deepEqual(record.provenance, { [FINAL]: { build: 'abc' } });
  const listed = Object.fromEntries(record.files.map((f) => [f.path, f.sha256]));
  assert.equal(listed[join(FINAL, 'reads.bam')], createHash('sha256').update('bam').digest('hex'));
});

test('a type without preprocessedFiles writes no provenance key', async () => {
  const s = setup();
  const { record } = await prepare(s);
  assert.equal(Object.hasOwn(record, 'provenance'), false);
  assert.equal(JSON.parse(readFileSync(join(s.typeDir, 'delivery/PRJNA000002/delivery.json'), 'utf-8')).provenance, undefined);
});
