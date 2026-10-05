import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createGit } from '../shared/scripts/lib/git-ops.js';
import {
  ABBREV_SHAPE, strainAbbrevOf, conventionalAbbrev, readOrganismIndex, pendingGenomeProposals, genomeOrganismOf,
  crossCheckOrganisms
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
