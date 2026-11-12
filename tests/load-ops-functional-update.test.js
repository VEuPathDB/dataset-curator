import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createGit } from '../shared/scripts/lib/git-ops.js';
import { loadProposal, composeLoadWrites, composeLoadEdits, assertEditCapabilities } from '../shared/scripts/lib/load-ops.js';
import { formatDeliveryComment } from '../shared/scripts/lib/validation.js';
import { fixtures, initRepo, stubTicket, stubGh } from './helpers.js';

const ID = 'tfakST1_productNames_20261111';
const REBUILD = 'rebuild02';
const ORGANISM = 'Datasets/lib/xml/datasets/FungiDB/tfakST1.xml';
const PRESENTERS = 'Model/lib/xml/datasetPresenters/FungiDB.xml';
const noFindings = async () => [];
const sh = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf-8' });

const GENOME_PRESENTER = `<?xml version="1.0"?>
<datasetPresenters>
  <datasetPresenter name="tfakST1_primary_genome_RSRC"
                    >
    <displayName><![CDATA[Genome Sequence and Annotation]]></displayName>
    <history buildNumber="01"
            genomeSource="INSDC" genomeVersion="GCA_000001.1"
            annotationSource="GenBank" annotationVersion="Jan 01, 2020"/>
    <primaryContactId>jane.doe</primaryContactId>
  </datasetPresenter>
</datasetPresenters>
`;

const LOADED_PRESENTER = GENOME_PRESENTER.replace('    <primaryContactId>', `    <history buildNumber="02"
            genomeSource="INSDC" genomeVersion="GCA_000001.1"
            annotationSource="GenBank" annotationVersion="Jan 01, 2020"
            functionalAnnotationSource="VEuPathDB" functionalAnnotationVersion="Nov 03, 2026">functional annotation updated</history>
    <primaryContactId>`);

const prBodyOf = (gh) => {
  const prCreate = gh.calls.filter((a) => a[0] === 'pr' && a[1] === 'create').pop();
  return prCreate[prCreate.indexOf('--body') + 1];
};

const PRODUCTS = `
  <dataset class="productNames">
    <prop name="projectName">$$projectName$$</prop>
    <prop name="organismAbbrev">$$organismAbbrev$$</prop>
    <prop name="name">VEuPathDB</prop>
    <prop name="version">2026-07-22</prop>
  </dataset>
`;

/** rebuild02 with the genome presenter and a VEuPathDB productNames entry; the fixture proposal on master with ticket 42. */
function setup({ presenters = GENOME_PRESENTER, products = PRODUCTS, mode = 'bump' } = {}) {
  const { repo } = initRepo('load-fu-');
  writeFileSync(join(repo, PRESENTERS), presenters);
  const path = join(repo, ORGANISM);
  writeFileSync(path, readFileSync(path, 'utf-8').replace('</datasets>', `  <constant name="genomeVersion" value="2020-01-01"/>
${products}</datasets>`));
  sh(repo, 'add', '-A');
  sh(repo, 'commit', '-q', '-m', 'genome presenter and products');
  sh(repo, 'push', '-q', 'origin', 'master');
  sh(repo, 'branch', REBUILD);
  sh(repo, 'push', '-q', '-u', 'origin', REBUILD);
  cpSync(join(fixtures, 'proposals', ID), join(repo, 'Proposals', ID), { recursive: true });
  const manifest = join(repo, 'Proposals', ID, 'manifest.json');
  writeFileSync(manifest, JSON.stringify({ ...JSON.parse(readFileSync(manifest, 'utf-8')), ticket: { system: 'github', id: '42', url: 'https://r/issues/42' } }, null, 2) + '\n');
  const update = join(repo, 'Proposals', ID, 'curated', 'update.json');
  writeFileSync(update, readFileSync(update, 'utf-8').replace('"bump"', JSON.stringify(mode)));
  sh(repo, 'add', '-A');
  sh(repo, 'commit', '-q', '-m', 'proposal');
  sh(repo, 'push', '-q', 'origin', 'master');
  sh(repo, 'checkout', '-q', REBUILD);
  return repo;
}

function ready(repo) {
  sh(repo, 'fetch', '-q');
  const proposalTree = sh(repo, 'rev-parse', `origin/master:Proposals/${ID}`).trim();
  const record = { proposalTree, against: `origin/${REBUILD}`, settlement: [{ proposed: 'tfakST1', abbrev: 'tfakST1' }], build: '02', release: '2026-10', corpusStep: null, handoff: 'Copy' };
  return stubTicket({ status: 'ready', existingComments: [formatDeliveryComment(record, 'e'.repeat(64))] });
}

const HISTORY_ROW = /<history buildNumber="02"\n            genomeSource="INSDC" genomeVersion="GCA_000001\.1"\n            annotationSource="GenBank" annotationVersion="Jan 01, 2020"\n            functionalAnnotationSource="VEuPathDB" functionalAnnotationVersion="Nov 03, 2026">functional annotation updated<\/history>/;
const BUMP_SUBJECT = `Load ${ID}: edit history tfakST1_primary_genome_RSRC build 02; productNames VEuPathDB version 2026-11-03 in tfakST1`;

test('a bump load appends the history row and sets the version, in one commit, with no presenter or dataset added', async () => {
  const repo = setup();
  const gh = stubGh();
  const git = createGit(repo, { exec: gh.exec });
  await loadProposal({ git, ticket: ready(repo), repoPath: repo, rebuildBranch: REBUILD, proposalId: ID, validate: noFindings });
  const ref = `origin/load/${ID}`;
  assert.match(git.showFile(ref, PRESENTERS), HISTORY_ROW);
  assert.match(git.showFile(ref, ORGANISM), /<prop name="name">VEuPathDB<\/prop>\n    <prop name="version">2026-11-03<\/prop>/);
  assert.equal(git.showFile(ref, ORGANISM).split('class="productNames"').length - 1, 1);
  assert.equal(git.headSubject(), BUMP_SUBJECT);
  assert.match(sh(repo, 'log', '-1', '--format=%b'), new RegExp(`Edit: productNames VEuPathDB version 2026-11-03 in tfakST1 in ${ORGANISM}`));
  assert.deepEqual(sh(repo, 'diff', '--name-only', `origin/${REBUILD}`, 'HEAD').trim().split('\n').sort(), [ORGANISM, PRESENTERS]);
  assert.equal(git.isClean(), true);
});

test('a new-mode load inserts the entry and appends the history row', async () => {
  const repo = setup({ products: '', mode: 'new' });
  const git = createGit(repo, { exec: stubGh().exec });
  await loadProposal({ git, ticket: ready(repo), repoPath: repo, rebuildBranch: REBUILD, proposalId: ID, validate: noFindings });
  const ref = `origin/load/${ID}`;
  assert.match(git.showFile(ref, PRESENTERS), HISTORY_ROW);
  assert.match(git.showFile(ref, ORGANISM), /<prop name="name">VEuPathDB<\/prop>\n\s*<prop name="version">2026-11-03<\/prop>/);
  assert.equal(git.headSubject(), `Load ${ID}: edit history tfakST1_primary_genome_RSRC build 02, add VEuPathDB to tfakST1`);
});

test('a dry run lists the edits and changes nothing', async () => {
  const repo = setup();
  const git = createGit(repo, { exec: stubGh().exec });
  const result = await loadProposal({ git, ticket: ready(repo), repoPath: repo, rebuildBranch: REBUILD, proposalId: ID, validate: noFindings, dryRun: true });
  assert.deepEqual(result.edits.map((e) => e.op), ['appendHistory', 'setEntryVersion']);
  assert.deepEqual(result.presenters, []);
  assert.equal(result.dataset, null);
  assert.equal(git.branchExists(`load/${ID}`), false);
  assert.equal(git.isClean(), true);
});

test('edits the rebuild branch already holds commit nothing and report already loaded', async () => {
  const repo = setup({ presenters: LOADED_PRESENTER, products: PRODUCTS.replace('2026-07-22', '2026-11-03') });
  const git = createGit(repo, { exec: stubGh().exec });
  const result = await loadProposal({ git, ticket: ready(repo), repoPath: repo, rebuildBranch: REBUILD, proposalId: ID, validate: noFindings });
  assert.equal(result.alreadyLoaded, true);
  assert.match(result.warnings.join('\n'), /is already loaded: rebuild02 holds every edit or a later one/);
  assert.equal(git.branchExists(`load/${ID}`), false);
  assert.equal(git.currentBranch(), REBUILD);
});

test('an edit the rebuild branch already holds is still named, marked already present', async () => {
  const repo = setup({ presenters: LOADED_PRESENTER });
  const gh = stubGh();
  const git = createGit(repo, { exec: gh.exec });
  await loadProposal({ git, ticket: ready(repo), repoPath: repo, rebuildBranch: REBUILD, proposalId: ID, validate: noFindings });
  assert.equal(git.headSubject(), BUMP_SUBJECT);
  const body = sh(repo, 'log', '-1', '--format=%b');
  assert.match(body, /^Edit: history tfakST1_primary_genome_RSRC build 02 in Model\/lib\/xml\/datasetPresenters\/FungiDB\.xml \(already present\)$/m);
  assert.match(body, /^Edit: productNames VEuPathDB version 2026-11-03 in tfakST1 in Datasets\/lib\/xml\/datasets\/FungiDB\/tfakST1\.xml$/m);
  assert.deepEqual(sh(repo, 'diff', '--name-only', `origin/${REBUILD}`, 'HEAD').trim().split('\n'), [ORGANISM]);
  assert.match(prBodyOf(gh), /^Edit: history tfakST1_primary_genome_RSRC build 02 in `Model\/lib\/xml\/datasetPresenters\/FungiDB\.xml` \(already present\)$/m);
  assert.match(prBodyOf(gh), /^Presenters: none added in /m);
});

test('a missing carried history value stops the load before any branch, naming --history; given, it loads', async () => {
  const repo = setup({ presenters: GENOME_PRESENTER.replace(' annotationVersion="Jan 01, 2020"', '') });
  const git = createGit(repo, { exec: stubGh().exec });
  await assert.rejects(loadProposal({ git, ticket: ready(repo), repoPath: repo, rebuildBranch: REBUILD, proposalId: ID, validate: noFindings }), /--history annotationVersion=<value>/);
  assert.equal(git.branchExists(`load/${ID}`), false);
  await loadProposal({ git, ticket: ready(repo), repoPath: repo, rebuildBranch: REBUILD, proposalId: ID, validate: noFindings, history: { annotationVersion: 'Feb 02, 2020' } });
  assert.match(git.showFile(`origin/load/${ID}`, PRESENTERS), /annotationVersion="Feb 02, 2020"/);
});

test('a load without the genome presenter is refused', async () => {
  const repo = setup({ presenters: '<?xml version="1.0"?>\n<datasetPresenters>\n</datasetPresenters>\n' });
  await assert.rejects(loadProposal({ git: createGit(repo, { exec: stubGh().exec }), ticket: ready(repo), repoPath: repo, rebuildBranch: REBUILD, proposalId: ID, validate: noFindings }),
    /Presenter tfakST1_primary_genome_RSRC is not in Model\/lib\/xml\/datasetPresenters\/FungiDB\.xml; functional-update amends an existing presenter/);
});

test('a load that failed after its commit resumes, and lists its edits', async () => {
  const repo = setup();
  const gh = stubGh({ failCreates: 1 });
  const git = createGit(repo, { exec: gh.exec });
  await assert.rejects(loadProposal({ git, ticket: ready(repo), repoPath: repo, rebuildBranch: REBUILD, proposalId: ID, validate: noFindings }), /Re-run the same command to resume/);
  const dry = await loadProposal({ git, ticket: ready(repo), repoPath: repo, rebuildBranch: REBUILD, proposalId: ID, validate: noFindings, dryRun: true });
  assert.deepEqual(dry.edits.map((e) => e.op), ['appendHistory', 'setEntryVersion']);
  assert.deepEqual(dry.presenterNames, []);
  const result = await loadProposal({ git, ticket: ready(repo), repoPath: repo, rebuildBranch: REBUILD, proposalId: ID, validate: noFindings });
  assert.equal(result.resumed, true);
  assert.equal(git.headSubject(), BUMP_SUBJECT);
  assert.match(prBodyOf(gh), /^Presenters: none added in /m);
  assert.match(prBodyOf(gh), /^Edit: productNames VEuPathDB version 2026-11-03 in tfakST1 in `Datasets\/lib\/xml\/datasets\/FungiDB\/tfakST1\.xml`$/m);
});

test('a new-mode resume compares the entries its commit added', async () => {
  const repo = setup({ products: '', mode: 'new' });
  const git = createGit(repo, { exec: stubGh({ failCreates: 1 }).exec });
  await assert.rejects(loadProposal({ git, ticket: ready(repo), repoPath: repo, rebuildBranch: REBUILD, proposalId: ID, validate: noFindings }), /resume/);
  const subject = git.headSubject();
  sh(repo, 'commit', '-q', '--amend', '-m', subject.replace(', add VEuPathDB to', ', add Other to'));
  await assert.rejects(loadProposal({ git, ticket: ready(repo), repoPath: repo, rebuildBranch: REBUILD, proposalId: ID, validate: noFindings }),
    /This load was committed adding Other; the proposal on origin\/master now adds VEuPathDB/);
  sh(repo, 'commit', '-q', '--amend', '-m', subject);
  const result = await loadProposal({ git, ticket: ready(repo), repoPath: repo, rebuildBranch: REBUILD, proposalId: ID, validate: noFindings });
  assert.equal(result.resumed, true);
});

test('a resume whose commit does not hold the edits is refused', async () => {
  const repo = setup();
  const git = createGit(repo, { exec: stubGh({ failCreates: 1 }).exec });
  await assert.rejects(loadProposal({ git, ticket: ready(repo), repoPath: repo, rebuildBranch: REBUILD, proposalId: ID, validate: noFindings }), /resume/);
  sh(repo, 'checkout', '-q', `origin/${REBUILD}`, '--', ORGANISM);
  sh(repo, 'commit', '-q', '--amend', '--no-edit');
  await assert.rejects(loadProposal({ git, ticket: ready(repo), repoPath: repo, rebuildBranch: REBUILD, proposalId: ID, validate: noFindings }),
    /The load commit does not hold productNames VEuPathDB version 2026-11-03 in tfakST1/);
});

test('load-proposal.js refuses an unknown or empty --history key before anything else', () => {
  const cli = new URL('../shared/scripts/load-proposal.js', import.meta.url).pathname;
  for (const pair of ['bogus=1', 'genomeSource=', '=x', 'genomeSource']) {
    const r = spawnSync('node', [cli, '--rebuild-branch', REBUILD, '--history', pair, ID], { encoding: 'utf-8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /--history must be <key>=<value> with key one of genomeSource, /);
  }
  const twice = spawnSync('node', [cli, '--rebuild-branch', REBUILD, '--history', 'genomeSource=a', '--history', 'genomeSource=b', ID], { encoding: 'utf-8' });
  assert.equal(twice.status, 1);
  assert.match(twice.stderr, /--history names genomeSource twice/);
});

test('a type that amends presenters or entries must have loadEdits', () => {
  assert.throws(() => assertEditCapabilities({ amendsPresenters: true }, 'broken'), /Dataset type broken declares amendsPresenters but has no loadEdits/);
  assert.throws(() => assertEditCapabilities({ amendsEntries: () => [] }, 'broken'), /declares amendsEntries but has no loadEdits/);
  assert.doesNotThrow(() => assertEditCapabilities({ amendsPresenters: true, loadEdits: () => [] }, 'ok'));
  assert.doesNotThrow(() => assertEditCapabilities({}, 'plain'));
});

test('composeLoadWrites: edits apply to the inserted content, one write per file, unchanged edit files dropped', () => {
  const checkout = { [ORGANISM]: '<datasets>\n</datasets>\n', [PRESENTERS]: GENOME_PRESENTER };
  const read = (rel) => checkout[rel] ?? null;
  const inserted = `<datasets>\n${PRODUCTS}</datasets>\n`;
  const edits = [
    { op: 'setEntryVersion', project: 'FungiDB', organism: 'tfakST1', datasetClass: 'productNames', name: 'VEuPathDB', version: '2026-07-22' },
    { op: 'setEntryVersion', project: 'FungiDB', organism: 'tfakST1', datasetClass: 'productNames', name: 'VEuPathDB', version: '2026-11-03' }
  ];
  assert.deepEqual(composeLoadWrites([{ relFile: ORGANISM, content: inserted }], edits, read), [{ relFile: ORGANISM, content: inserted.replace('2026-07-22', '2026-11-03') }]);
  assert.deepEqual(composeLoadEdits([{ relFile: ORGANISM, content: inserted }], edits, read).held, [true, false]);
  const presenterOnly = { op: 'appendHistory', project: 'FungiDB', presenter: 'tfakST1_primary_genome_RSRC', build: '01', functional: { source: 'VEuPathDB', version: 'Nov 03, 2026' }, text: 't' };
  const loaded = GENOME_PRESENTER.replace('annotationVersion="Jan 01, 2020"/>', 'annotationVersion="Jan 01, 2020" functionalAnnotationSource="VEuPathDB" functionalAnnotationVersion="Nov 03, 2026"/>');
  assert.deepEqual(composeLoadWrites([], [presenterOnly], (rel) => (rel === PRESENTERS ? loaded : null)), []);
});
