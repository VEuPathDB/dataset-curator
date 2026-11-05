import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createGit } from '../shared/scripts/lib/git-ops.js';
import { buildFitness } from '../shared/scripts/lib/build-fitness.js';
import { insertPresenter } from '../shared/scripts/lib/presenter-file.js';
import { renderPresenter } from '../shared/scripts/dataset-types/bulk-rnaseq.js';
import { fixtures, initRepo } from './helpers.js';

const PRESENTERS = 'Model/lib/xml/datasetPresenters/FungiDB.xml';

/** origin/rebuild02 with the fixture organism file and an empty FungiDB presenter file; the proposal in a scratch dir. */
function setup({ presenterFile = '<?xml version="1.0"?>\n<datasetPresenters>\n</datasetPresenters>\n' } = {}) {
  const { repo } = initRepo('build-fitness-');
  writeFileSync(join(repo, PRESENTERS), presenterFile);
  execFileSync('git', ['-C', repo, 'add', '-A']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'presenters']);
  execFileSync('git', ['-C', repo, 'push', '-q', 'origin', 'HEAD:rebuild02']);
  execFileSync('git', ['-C', repo, 'fetch', '-q']);
  const proposalDir = join(mkdtempSync(join(tmpdir(), 'build-fitness-p-')), 'PRJNA000002');
  cpSync(join(fixtures, 'proposals/PRJNA000002'), proposalDir, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(proposalDir, 'manifest.json'), 'utf-8'));
  return { git: createGit(repo), proposalDir, manifest };
}

test('buildFitness passes a proposal that would load on the ref', async () => {
  const ctx = setup();
  assert.deepEqual(await buildFitness({ ...ctx, against: 'origin/rebuild02' }), []);
});

test('buildFitness reports a presenter name already on the ref', async () => {
  const proposalDir = join(fixtures, 'proposals/PRJNA000002');
  const taken = insertPresenter('<?xml version="1.0"?>\n<datasetPresenters>\n</datasetPresenters>\n', renderPresenter(proposalDir, { build: '02' }));
  const ctx = setup({ presenterFile: taken });
  const findings = await buildFitness({ ...ctx, against: 'origin/rebuild02' });
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /already exists in Model\/lib\/xml\/datasetPresenters\/FungiDB\.xml on origin\/rebuild02/);
});

test('buildFitness warns, not errors, for an organism that needs a person to settle it', async () => {
  const ctx = setup();
  ctx.manifest = { ...ctx.manifest, organisms: [{ proposedOrganismAbbrev: 'nobody1', source: 'loaded', project: 'FungiDB' }] };
  const findings = await buildFitness({ ...ctx, against: 'origin/rebuild02' });
  assert.ok(findings.length >= 1);
  assert.ok(findings.every((f) => f.validator === 'buildFitness' && f.severity === 'warning'));
  assert.match(findings[0].message, /^nobody1: /);
  assert.match(findings[0].message, /needs a person's --settle at prepare-delivery\)$/);
});

test('buildFitness sends a genome organism stop to --settle at load', async () => {
  const ctx = setup();
  const { datasetClass, name, version, ...rest } = ctx.manifest;
  rmSync(join(ctx.proposalDir, 'curated', 'dataset.json'));
  ctx.manifest = { ...rest, datasetType: 'genome-assembly', organisms: [{ proposedOrganismAbbrev: 'nobody1', source: 'loaded', project: 'FungiDB' }] };
  const findings = await buildFitness({ ...ctx, against: 'origin/rebuild02' });
  assert.match(findings[0].message, /needs a person's --settle at load\)$/);
});

test('buildFitness names the soTerm of a genome entry the organism file already has', async () => {
  const ctx = setup();
  const organismFile = join(ctx.git.repoPath, 'Datasets/lib/xml/datasets/FungiDB/tfakST1.xml');
  const dataset = '  <dataset class="fasta_secondary_genome">\n    <prop name="name">Genomic_X</prop>\n    <prop name="soTerm">contig</prop>\n  </dataset>\n</datasets>';
  writeFileSync(organismFile, readFileSync(organismFile, 'utf-8').replace('</datasets>', dataset));
  execFileSync('git', ['-C', ctx.git.repoPath, 'commit', '-q', '-am', 'secondary genome']);
  execFileSync('git', ['-C', ctx.git.repoPath, 'push', '-q', 'origin', 'HEAD:rebuild02']);
  execFileSync('git', ['-C', ctx.git.repoPath, 'fetch', '-q']);
  const { datasetClass, name, version, ...manifest } = ctx.manifest;
  const { source } = JSON.parse(readFileSync(join(ctx.proposalDir, 'curated', 'dataset.json'), 'utf-8'));
  rmSync(join(ctx.proposalDir, 'curated', 'dataset.json'));
  writeFileSync(join(ctx.proposalDir, 'curated', 'datasets.json'),
    JSON.stringify({ schemaVersion: 2, datasets: [{ datasetClass: 'fasta_secondary_genome', name: 'Genomic_X', version, props: { soTerm: 'contig' }, source }] }));
  writeFileSync(join(ctx.proposalDir, 'manifest.json'), JSON.stringify(manifest));
  const findings = await buildFitness({ ...ctx, manifest, against: 'origin/rebuild02' });
  assert.deepEqual(findings.map((f) => f.message),
    ['Datasets/lib/xml/datasets/FungiDB/tfakST1.xml on origin/rebuild02 already has a fasta_secondary_genome named "Genomic_X" (contig)']);
});

test('buildFitness reports an entry name the organism file already has', async () => {
  const ctx = setup();
  const { datasetClass, name, version, ...manifest } = ctx.manifest;
  const { props, source } = JSON.parse(readFileSync(join(ctx.proposalDir, 'curated', 'dataset.json'), 'utf-8'));
  rmSync(join(ctx.proposalDir, 'curated', 'dataset.json'));
  writeFileSync(join(ctx.proposalDir, 'curated', 'datasets.json'),
    JSON.stringify({ schemaVersion: 2, datasets: [{ datasetClass, name: 'Existing_2020', version, props, source }] }));
  writeFileSync(join(ctx.proposalDir, 'manifest.json'), JSON.stringify(manifest));
  const findings = await buildFitness({ ...ctx, manifest, against: 'origin/rebuild02' });
  assert.deepEqual(findings.map((f) => f.message),
    ['Datasets/lib/xml/datasets/FungiDB/tfakST1.xml on origin/rebuild02 already has a rnaSeqExperiment named "Existing_2020"']);
});
