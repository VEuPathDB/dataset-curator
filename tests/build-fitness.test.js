import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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

test('buildFitness reports an organism that does not settle on the ref', async () => {
  const ctx = setup();
  ctx.manifest = { ...ctx.manifest, organisms: [{ proposedOrganismAbbrev: 'nobody1', source: 'loaded', project: 'FungiDB' }] };
  const findings = await buildFitness({ ...ctx, against: 'origin/rebuild02' });
  assert.ok(findings.length >= 1);
  assert.ok(findings.every((f) => f.validator === 'buildFitness' && f.severity === 'error'));
  assert.match(findings[0].message, /^nobody1: /);
});
