import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createGit } from '../shared/scripts/lib/git-ops.js';
import {
  ABBREV_SHAPE, strainAbbrevOf, conventionalAbbrev, readOrganismIndex, pendingGenomeProposals, genomeOrganismOf
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
