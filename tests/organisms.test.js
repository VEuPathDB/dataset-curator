import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createGit } from '../shared/scripts/lib/git-ops.js';
import {
  ABBREV_SHAPE, strainAbbrevOf, conventionalAbbrev, readOrganismIndex, pendingGenomeProposals, genomeOrganismOf,
  crossCheckOrganisms, settleOrganisms
} from '../shared/scripts/lib/organisms.js';
import { initRepo } from './helpers.js';

test('the shape admits every abbreviation in use and refuses path and markup characters', () => {
  for (const ok of ['pfal3D7', 'bcinB05-10', 'acspSK_2022a', 'aellCBS707.79']) assert.ok(ABBREV_SHAPE.test(ok), ok);
  for (const bad of ['', '.hidden', '-flag', 'a/b', 'a b', 'a"b', 'a&b']) assert.ok(!ABBREV_SHAPE.test(bad), bad);
});

test('a strain abbreviation replaces "." with "-" and spaces with "_"', () => {
  assert.equal(strainAbbrevOf('B05.10'), 'B05-10');
  assert.equal(strainAbbrevOf(' Friedlin V1 '), 'Friedlin_V1');
  assert.equal(strainAbbrevOf('3D7'), '3D7');
});

test('the convention is genus initial, three species letters, then the strain abbreviation', () => {
  assert.equal(conventionalAbbrev({ species: 'Plasmodium falciparum', strain: '3D7' }), 'pfal3D7');
  assert.equal(conventionalAbbrev({ species: 'Botrytis cinerea', strain: 'B05.10' }), 'bcinB05-10');
  assert.equal(conventionalAbbrev({ species: 'Leishmania major', strain: 'Friedlin V1' }), 'lmajFriedlin_V1');
  assert.equal(conventionalAbbrev({ species: 'Testus fakeus', strain: '' }), 'tfak');
});

test('no convention applies without a genus and a lettered species epithet', () => {
  assert.equal(conventionalAbbrev({ species: 'Leishmania sp.', strain: 'X' }), null);
  assert.equal(conventionalAbbrev({ species: 'Plasmodium', strain: '3D7' }), null);
  assert.equal(conventionalAbbrev({ species: undefined, strain: '3D7' }), null);
});

/** Writes files (path -> text) into repo and commits them. */
function commitFiles(repo, files, message = 'files') {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), text);
  }
  execFileSync('git', ['-C', repo, 'add', '-A']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', message]);
}

const organismFile = (abbrev, taxon, strain) => `<?xml version="1.0"?>\n<datasets>\n  <constant name="organismAbbrev" value="${abbrev}"/>\n` +
  (taxon ? `  <constant name="ncbiTaxonId" value="${taxon}"/>\n` : '') +
  (strain ? `  <constant name="strainAbbrev" value="${strain}"/>\n` : '') + '</datasets>\n';

const genomeManifest = (accession, abbrev, extra = {}) => JSON.stringify({
  schemaVersion: 3, accession, datasetType: 'genome-assembly', project: 'FungiDB',
  organisms: [{ proposedOrganismAbbrev: abbrev, source: 'new', species: 'Testus fakeus', strain: 'ST 9', ncbiTaxonId: '999009', ...extra }]
});

test('the organism index lists every organism file with its taxon and strain constants', () => {
  const { repo } = initRepo();
  commitFiles(repo, {
    'Datasets/lib/xml/datasets/ToxoDB/tgonME49.xml': organismFile('tgonME49', '508771', 'ME49'),
    'Datasets/lib/xml/datasets/ToxoDB.xml': '<datasets/>\n',
    'Datasets/lib/xml/datasets/ToxoDB/tgonME49/extra.xml': organismFile('nested', '1', 'X')
  });
  const index = readOrganismIndex(createGit(repo), 'HEAD');
  assert.deepEqual(index.sort((a, b) => a.abbrev.localeCompare(b.abbrev)), [
    { abbrev: 'tfakST1', project: 'FungiDB', ncbiTaxonId: undefined, strainAbbrev: undefined },
    { abbrev: 'tgonME49', project: 'ToxoDB', ncbiTaxonId: '508771', strainAbbrev: 'ME49' }
  ]);
});

test('pending genome proposals are read from each ref, unvalidated, first ref winning', () => {
  const { repo } = initRepo();
  commitFiles(repo, {
    'Proposals/GCA_9.1/manifest.json': genomeManifest('GCA_9.1', 'tfakST_9'),
    'Proposals/PRJNA9/manifest.json': JSON.stringify({ accession: 'PRJNA9', organisms: [{ proposedOrganismAbbrev: 'tfakST1', source: 'loaded' }] }),
    'Proposals/BROKEN/manifest.json': '{ not json'
  });
  const claims = pendingGenomeProposals(createGit(repo), ['HEAD', 'HEAD']);
  assert.deepEqual(claims.map((c) => [c.accession, c.project, c.organism.proposedOrganismAbbrev]), [['GCA_9.1', 'FungiDB', 'tfakST_9']]);
});

test('a genome proposal deleted by its load is found in the history', () => {
  const { repo } = initRepo();
  commitFiles(repo, { 'Proposals/GCA_9.1/manifest.json': genomeManifest('GCA_9.1', 'tfakST_9') });
  execFileSync('git', ['-C', repo, 'rm', '-q', '-r', 'Proposals/GCA_9.1']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'load GCA_9.1']);
  const git = createGit(repo);
  assert.equal(genomeOrganismOf(git, 'HEAD', 'GCA_9.1').ncbiTaxonId, '999009');
  assert.equal(genomeOrganismOf(git, 'HEAD', 'GCA_NONE.1'), null);
});

const INDEX = [
  { abbrev: 'tfakST1', project: 'FungiDB', ncbiTaxonId: '999000', strainAbbrev: 'ST1' },
  { abbrev: 'tgonME49', project: 'ToxoDB', ncbiTaxonId: '508771', strainAbbrev: 'ME49' }
];
const newOrganism = (o = {}) => ({ proposedOrganismAbbrev: 'tfakST-1', source: 'new', species: 'Testus fakeus', strain: 'ST-1', ncbiTaxonId: '999001', ...o });
const genomeDraft = (o) => ({ accession: 'GCA_1.1', project: 'FungiDB', organisms: [newOrganism(o)] });
const rnaDraft = (...abbrevs) => ({ accession: 'PRJNA1', project: 'FungiDB', organisms: abbrevs.map((p) => ({ proposedOrganismAbbrev: p, source: 'loaded' })) });
const claim = (accession, o) => ({ accession, project: 'FungiDB', organism: newOrganism(o) });
const check = (m, claims = []) => crossCheckOrganisms(m, { index: INDEX, claims, rebuild: 'rebuild02' });

test('a new genome passes when nothing claims it and it follows the convention', () => {
  assert.deepEqual(check(genomeDraft()), { organisms: [newOrganism()], errors: [], warnings: [] });
});

test('a new genome whose abbreviation exists in any project is refused', () => {
  const { errors } = check(genomeDraft({ proposedOrganismAbbrev: 'tgonME49' }));
  assert.deepEqual(errors, ['tgonME49 already names ToxoDB/tgonME49.xml on rebuild02: the organism is redundant or the abbreviation is wrong']);
});

test('a new genome with a loaded taxon and strain is refused as redundant', () => {
  const { errors } = check(genomeDraft({ ncbiTaxonId: '999000', strain: 'ST1', proposedOrganismAbbrev: 'tfakST1x' }));
  assert.ok(errors.includes('taxon 999000 strain ST1 is already loaded as FungiDB/tfakST1 on rebuild02'));
});

test('a new genome claimed by another genome proposal is refused; its own claim is not a rival', () => {
  assert.deepEqual(check(genomeDraft(), [claim('GCA_2.1')]).errors, ['tfakST-1 is already proposed by genome proposal GCA_2.1']);
  assert.deepEqual(check(genomeDraft(), [claim('GCA_1.1')]).errors, []);
});

test('a new genome off the convention is a warning that Phase 2 will stop on', () => {
  assert.deepEqual(check(genomeDraft({ proposedOrganismAbbrev: 'tfakST1x' })).warnings,
    ['tfakST1x differs from the convention tfakST-1; Phase 2 will stop for a person to decide']);
  assert.deepEqual(check(genomeDraft({ species: 'Testus sp.' })).warnings,
    ['no conventional abbreviation can be derived from species "Testus sp."; Phase 2 will stop for a person to decide']);
});

test('a loaded organism in the project is settled as loaded', () => {
  assert.deepEqual(check(rnaDraft('tfakST1')), { organisms: [{ proposedOrganismAbbrev: 'tfakST1', source: 'loaded' }], errors: [], warnings: [] });
});

test('an organism of another project is refused', () => {
  assert.deepEqual(check(rnaDraft('tgonME49')).errors, ['tgonME49 is a ToxoDB organism on rebuild02, not FungiDB']);
});

test('an organism only a pending genome proposes is linked to it, with a warning', () => {
  const result = check(rnaDraft('tfakST-1'), [claim('GCA_1.1')]);
  assert.deepEqual(result.organisms, [{ proposedOrganismAbbrev: 'tfakST-1', source: { proposal: 'GCA_1.1' } }]);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, ['tfakST-1 is not loaded: genome proposal GCA_1.1 proposes it, so it is not settled. This dataset loads in the same build as that genome or later.']);
});

test('an organism nothing knows is refused', () => {
  assert.deepEqual(check(rnaDraft('nope1')).errors, ['nope1 is not an organism on rebuild02 and no genome proposal on master proposes it']);
});

const genomeManifestV3 = (o) => ({ accession: 'GCA_1.1', project: 'FungiDB', organisms: [newOrganism(o)] });
const rnaManifest = (...organisms) => ({ accession: 'PRJNA1', project: 'FungiDB', organisms });
const linked = (p, accession = 'GCA_1.1') => ({ proposedOrganismAbbrev: p, source: { proposal: accession } });
const settleWith = (m, { index = INDEX, claims = [], genomes = {}, settle } = {}) =>
  settleOrganisms(m, { index, claims, genomeOf: (a) => genomes[a] ?? null, settle });

test('a conventional new genome settles to its proposal', () => {
  assert.deepEqual(settleWith(genomeManifestV3()), { organisms: [{ proposed: 'tfakST-1', abbrev: 'tfakST-1', notes: [] }], stops: [] });
});

test('a new genome off the convention stops until a person settles it', () => {
  const m = genomeManifestV3({ proposedOrganismAbbrev: 'tfakX' });
  assert.deepEqual(settleWith(m).stops, ['tfakX: tfakX differs from the convention tfakST-1 (a person may decide with --settle tfakX=<abbrev>)']);
  assert.deepEqual(settleWith(m, { settle: { tfakX: 'tfakX' } }),
    { organisms: [{ proposed: 'tfakX', abbrev: 'tfakX', notes: ['settled by the loader'] }], stops: [] });
  assert.deepEqual(settleWith(m, { settle: { tfakX: 'tfakST-1' } }).organisms,
    [{ proposed: 'tfakX', abbrev: 'tfakST-1', notes: ['settled by the loader'] }]);
});

test('no settlement clears an existing abbreviation, a loaded taxon and strain, or a rival claim', () => {
  const taken = genomeManifestV3({ proposedOrganismAbbrev: 'tgonME49' });
  assert.match(settleWith(taken, { settle: { tgonME49: 'tgonME49' } }).stops[0], /tgonME49 already names ToxoDB\/tgonME49\.xml on this branch/);
  const twin = genomeManifestV3({ ncbiTaxonId: '999000', strain: 'ST1', proposedOrganismAbbrev: 'tfakST1x' });
  assert.match(settleWith(twin, { settle: { tfakST1x: 'tfakST1x' } }).stops[0], /taxon 999000 strain ST1 is already loaded as FungiDB\/tfakST1/);
  assert.match(settleWith(genomeManifestV3(), { claims: [claim('GCA_2.1')] }).stops[0], /tfakST-1 is already proposed by genome proposal GCA_2.1/);
});

test('a loaded organism settles by exact match in the project', () => {
  const ok = settleWith(rnaManifest({ proposedOrganismAbbrev: 'tfakST1', source: 'loaded' }));
  assert.deepEqual(ok, { organisms: [{ proposed: 'tfakST1', abbrev: 'tfakST1', notes: [] }], stops: [] });
  assert.deepEqual(settleWith(rnaManifest({ proposedOrganismAbbrev: 'tgonME49', source: 'loaded' })).stops,
    ['tgonME49: tgonME49 is a ToxoDB organism, not FungiDB']);
  assert.deepEqual(settleWith(rnaManifest({ proposedOrganismAbbrev: 'gone1', source: 'loaded' })).stops,
    ['gone1: no organism file FungiDB/gone1.xml on this branch']);
});

test('a linked organism settles to the organism file matching its genome taxon and strain', () => {
  const index = [...INDEX, { abbrev: 'tfakST-1b', project: 'FungiDB', ncbiTaxonId: '999001', strainAbbrev: 'ST-1' }];
  const result = settleWith(rnaManifest(linked('tfakST-1')), { index, genomes: { 'GCA_1.1': newOrganism() } });
  assert.deepEqual(result, { organisms: [{ proposed: 'tfakST-1', abbrev: 'tfakST-1b', notes: ['genome GCA_1.1 loaded as tfakST-1b'] }], stops: [] });
});

test('a linked organism whose genome is not loaded, or cannot be found, stops', () => {
  assert.deepEqual(settleWith(rnaManifest(linked('tfakST-1')), { genomes: { 'GCA_1.1': newOrganism() } }).stops,
    ['tfakST-1: genome proposal GCA_1.1 (taxon 999001, strain ST-1) is not loaded on this branch; load it first, in this build or an earlier one']);
  assert.deepEqual(settleWith(rnaManifest(linked('tfakST-1'))).stops,
    ['tfakST-1: genome proposal GCA_1.1 cannot be found on this branch, on origin/master or in their history']);
});

test('two organism files with the genome taxon and strain stop until a person picks one', () => {
  const twins = [{ abbrev: 'a1', project: 'FungiDB', ncbiTaxonId: '999001', strainAbbrev: 'ST-1' }, { abbrev: 'a2', project: 'FungiDB', ncbiTaxonId: '999001', strainAbbrev: 'ST-1' }];
  const m = rnaManifest(linked('tfakST-1'));
  assert.deepEqual(settleWith(m, { index: twins, genomes: { 'GCA_1.1': newOrganism() } }).stops,
    ['tfakST-1: taxon 999001 strain ST-1 matches a1, a2 (a person may decide with --settle tfakST-1=<abbrev>)']);
  assert.deepEqual(settleWith(m, { index: twins, genomes: { 'GCA_1.1': newOrganism() }, settle: { 'tfakST-1': 'a2' } }).organisms,
    [{ proposed: 'tfakST-1', abbrev: 'a2', notes: ['settled by the loader'] }]);
});

test('a genome without a taxon id falls back to the exact abbreviation, with a note', () => {
  const index = [...INDEX, { abbrev: 'tfakST-1', project: 'FungiDB', ncbiTaxonId: '1', strainAbbrev: 'X' }];
  const result = settleWith(rnaManifest(linked('tfakST-1')), { index, genomes: { 'GCA_1.1': newOrganism({ ncbiTaxonId: undefined }) } });
  assert.deepEqual(result.organisms, [{ proposed: 'tfakST-1', abbrev: 'tfakST-1', notes: ['matched by abbreviation only: genome proposal GCA_1.1 records no taxon id'] }]);
});

test('a loader settlement onto a file that disagrees with the genome is noted', () => {
  const result = settleWith(rnaManifest(linked('tfakST-1')), { genomes: { 'GCA_1.1': newOrganism() }, settle: { 'tfakST-1': 'tfakST1' } });
  assert.deepEqual(result.organisms[0].notes, ['settled by the loader', 'tfakST1 does not record genome GCA_1.1 taxon 999001 and strain ST-1']);
});

test('a settlement naming no organism of the proposal stops', () => {
  assert.deepEqual(settleWith(genomeManifestV3(), { settle: { typo: 'x' } }).stops, ['--settle names typo, which is not an organism of GCA_1.1']);
});

test('two organisms settling to one abbreviation stop', () => {
  const index = [...INDEX, { abbrev: 'tfakST-1b', project: 'FungiDB', ncbiTaxonId: '999001', strainAbbrev: 'ST-1' }];
  const m = rnaManifest({ proposedOrganismAbbrev: 'tfakST-1b', source: 'loaded' }, linked('tfakST-1'));
  assert.ok(settleWith(m, { index, genomes: { 'GCA_1.1': newOrganism() } }).stops.includes('tfakST-1b is settled for both tfakST-1b and tfakST-1'));
});

test('a rival genome proposal with the same taxon and strain stops, and settle does not clear it', () => {
  const rival = claim('GCA_2.1', { proposedOrganismAbbrev: 'tfakOther' });
  const stop = 'tfakST-1: taxon 999001 strain ST-1 is also proposed by genome proposal GCA_2.1 as tfakOther';
  assert.deepEqual(settleWith(genomeManifestV3(), { claims: [rival] }).stops, [stop]);
  assert.deepEqual(settleWith(genomeManifestV3(), { claims: [rival], settle: { 'tfakST-1': 'tfakST-1' } }).stops, [stop]);
});

test('an index entry without a strain abbreviation still counts as a twin of a strainless genome', () => {
  const index = [...INDEX, { abbrev: 'tfakNone', project: 'FungiDB', ncbiTaxonId: '999002' }];
  const bare = { strain: '', ncbiTaxonId: '999002', proposedOrganismAbbrev: 'tfakx' };
  assert.match(settleWith(genomeManifestV3(bare), { index }).stops[0], /taxon 999002 strain\s+is already loaded as FungiDB\/tfakNone/);
  const result = settleWith(rnaManifest(linked('tfakx')), { index, genomes: { 'GCA_1.1': newOrganism(bare) } });
  assert.deepEqual(result.organisms.map((o) => o.abbrev), ['tfakNone']);
});

test('a new genome without a taxon id stops until a person settles it', () => {
  const m = genomeManifestV3({ ncbiTaxonId: undefined });
  assert.deepEqual(settleWith(m).stops, ['tfakST-1: no taxon id, so it cannot be checked against loaded organisms (a person may decide with --settle tfakST-1=<abbrev>)']);
  assert.deepEqual(settleWith(m, { settle: { 'tfakST-1': 'tfakST-1' } }).stops, []);
});

test('a no-taxon genome still stops on a taken abbreviation even when settled', () => {
  const m = genomeManifestV3({ ncbiTaxonId: undefined, proposedOrganismAbbrev: 'tgonME49' });
  assert.match(settleWith(m, { settle: { tgonME49: 'tgonME49' } }).stops[0], /already names ToxoDB/);
});

test('the final abbreviation is shape-checked whatever the source', () => {
  const bad = settleWith(genomeManifestV3({ proposedOrganismAbbrev: 'a b' }));
  assert.match(bad.stops[0], /^a b: a b must be /);
  assert.match(settleWith(rnaManifest({ proposedOrganismAbbrev: 'a/b', source: 'loaded' })).stops[0], /^a\/b: a\/b must be /);
});

test('an unrecognised source stops', () => {
  const stop = (source) => settleWith(rnaManifest({ proposedOrganismAbbrev: 'tfakST1', source })).stops;
  const expected = ['tfakST1: source must be "new", "loaded" or { "proposal": <accession> }'];
  for (const source of [null, undefined, 'bogus', {}, { proposal: 5 }]) assert.deepEqual(stop(source), expected);
});

test('settle is read by own keys only and may be null', () => {
  assert.deepEqual(settleWith(genomeManifestV3(), { settle: null }).stops, []);
  const m = genomeManifestV3({ proposedOrganismAbbrev: 'constructor' });
  assert.ok(settleWith(m, { settle: {} }).stops.every((s) => !/must be/.test(s)));
});

test('a duplicate stop names every organism settling to the abbreviation', () => {
  const index = [...INDEX, { abbrev: 'tfakST-1b', project: 'FungiDB', ncbiTaxonId: '999001', strainAbbrev: 'ST-1' }];
  const m = rnaManifest({ proposedOrganismAbbrev: 'tfakST-1b', source: 'loaded' }, linked('tfakST-1'), { proposedOrganismAbbrev: 'tfakST-1b', source: 'loaded' });
  assert.ok(settleWith(m, { index, genomes: { 'GCA_1.1': newOrganism() } }).stops.some((s) => /^tfakST-1b is settled for all of /.test(s)));
});

test('settling away from a taken or rival-claimed abbreviation is allowed, with a note', () => {
  const taken = settleWith(genomeManifestV3({ proposedOrganismAbbrev: 'tgonME49' }), { settle: { tgonME49: 'tfakST-1' } });
  assert.deepEqual(taken.stops, []);
  assert.deepEqual(taken.organisms[0].notes, ['settled by the loader', 'proposed tgonME49: tgonME49 already names ToxoDB/tgonME49.xml on this branch: the organism is redundant or the abbreviation is wrong']);
  const rival = settleWith(genomeManifestV3(), { claims: [claim('GCA_2.1', { ncbiTaxonId: '1' })], settle: { 'tfakST-1': 'tfakST-1b' } });
  assert.deepEqual(rival.stops, []);
  assert.deepEqual(rival.organisms[0].notes, ['settled by the loader', 'proposed tfakST-1: tfakST-1 is already proposed by genome proposal GCA_2.1']);
});

test('settling away does not clear a taxon and strain twin, and the chosen value is still checked', () => {
  const twin = genomeManifestV3({ ncbiTaxonId: '999000', strain: 'ST1', proposedOrganismAbbrev: 'tfakST1x' });
  assert.match(settleWith(twin, { settle: { tfakST1x: 'tfakZ' } }).stops[0], /taxon 999000 strain ST1 is already loaded as FungiDB\/tfakST1/);
  assert.match(settleWith(genomeManifestV3(), { settle: { 'tfakST-1': 'tgonME49' } }).stops[0], /tgonME49 already names ToxoDB/);
});

test('every settle-clearable problem is reported', () => {
  const m = genomeManifestV3({ proposedOrganismAbbrev: 'tfakX', ncbiTaxonId: undefined });
  assert.deepEqual(settleWith(m).stops, [
    'tfakX: tfakX differs from the convention tfakST-1 (a person may decide with --settle tfakX=<abbrev>)',
    'tfakX: no taxon id, so it cannot be checked against loaded organisms (a person may decide with --settle tfakX=<abbrev>)'
  ]);
});
