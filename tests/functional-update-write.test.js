import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createGit } from '../shared/scripts/lib/git-ops.js';
import { writeProposal } from '../shared/scripts/lib/proposal-ops.js';
import { fixtures, initRepo } from './helpers.js';

const ID = 'tfakST1_productNames_20261111';
const FU = join(fixtures, 'proposals', ID);
const ORGANISM = 'Datasets/lib/xml/datasets/FungiDB/tfakST1.xml';
const PRODUCTS = `  <constant name="genomeVersion" value="2020-01-01"/>

  <dataset class="productNames">
    <prop name="projectName">$$projectName$$</prop>
    <prop name="organismAbbrev">$$organismAbbrev$$</prop>
    <prop name="name">VEuPathDB</prop>
    <prop name="version">2026-07-22</prop>
  </dataset>
</datasets>`;

/** origin/rebuild02 whose tfakST1 has a VEuPathDB productNames entry, the proposal branch checked out, and the Phase 1 inputs in tmp/. */
function setup() {
  const { root, repo } = initRepo('fu-write-');
  const path = join(repo, ORGANISM);
  writeFileSync(path, readFileSync(path, 'utf-8').replace('</datasets>', PRODUCTS));
  execFileSync('git', ['-C', repo, 'commit', '-q', '-am', 'productNames']);
  execFileSync('git', ['-C', repo, 'push', '-q', 'origin', 'master', 'master:rebuild02']);
  execFileSync('git', ['-C', repo, 'checkout', '-q', '-b', `proposal/${ID}`]);
  const tmp = join(root, 'tmp');
  mkdirSync(tmp);
  for (const f of [`${ID}_organism_entries.json`, `${ID}_staged.json`, 'products_update.tsv']) cpSync(join(FU, 'inputs', f), join(tmp, f));
  const manifest = JSON.parse(readFileSync(join(FU, 'manifest.json'), 'utf-8'));
  const overrides = join(tmp, 'overrides.json');
  writeFileSync(overrides, JSON.stringify({ version: '2026-11-03', update: { datasetClass: 'productNames', functionalAnnotationSource: 'VEuPathDB' }, staging: manifest.staging }));
  return { repo, tmp, overrides, inputs: [`${ID}_organism_entries.json`, `${ID}_staged.json`, 'products_update.tsv'].map((f) => join(tmp, f)) };
}

const write = ({ repo, inputs, overrides }) => writeProposal({
  git: createGit(repo), repoPath: repo, rebuildBranch: 'rebuild02', proposalId: ID, curator: 'someone@apidb.org', inputs, curated: [], overrides,
  manifestInput: { accession: ID, datasetType: 'functional-update', project: 'FungiDB', organism: 'tfakST1', contacts: { primary: 'jane.doe', additional: [] }, skill: { name: 'propose-functional-update', version: '4.1.0' } },
  warn: () => {}
});

test('writeProposal writes update.json and the bump entry, and no presenter.json', async () => {
  const s = setup();
  const { dir, presenter } = await write(s);
  assert.equal(presenter, null);
  assert.equal(existsSync(join(dir, 'curated', 'presenter.json')), false);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'curated', 'update.json'), 'utf-8')), JSON.parse(readFileSync(join(FU, 'curated', 'update.json'), 'utf-8')));
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'curated', 'datasets.json'), 'utf-8')), JSON.parse(readFileSync(join(FU, 'curated', 'datasets.json'), 'utf-8')));
});

test('writeProposal refuses a bump whose entry is not on the rebuild branch', async () => {
  const s = setup();
  const input = s.inputs[0];
  writeFileSync(input, readFileSync(input, 'utf-8').replace('"name": "VEuPathDB"', '"name": "Gone"'));
  writeFileSync(s.overrides, readFileSync(s.overrides, 'utf-8').replace('"version"', '"name":"Gone","version"'));
  await assert.rejects(write(s), /tfakST1\.xml on origin\/rebuild02 has no productNames named "Gone" to update; re-run check-functional-entries\.js/);
});

test('writeProposal refuses an impossible curator date', async () => {
  const s = setup();
  writeFileSync(s.overrides, readFileSync(s.overrides, 'utf-8').replace('2026-11-03', '2026-11-31'));
  await assert.rejects(write(s), /version must be a date, YYYY-MM-DD/);
});

test('writeProposal refuses an "update" override for another type', async () => {
  const { readOverrides } = await import('../shared/scripts/dataset-types/_common.js');
  const s = setup();
  writeFileSync(s.overrides, JSON.stringify({ update: { bogus: 1 } }));
  assert.throws(() => readOverrides(s.overrides), /unknown update keys bogus; allowed: datasetClass, functionalAnnotationSource, newEntry, text/);
});
