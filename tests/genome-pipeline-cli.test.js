import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fakeApiCommonData, fetchedWorkDir, perlMissing, tempDir, writeRecipe } from './genome-helpers.js';

const CLI = new URL('../shared/scripts/genome/genome-pipeline.js', import.meta.url).pathname;
const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf-8' });

test('no command prints usage and exits 1', () => {
  const r = cli();
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Usage: node genome-pipeline\.js fetch <assemblyAccession> --workDir <dir>/);
});

test('--workDir is required, and fetch takes exactly one accession', () => {
  assert.match(cli('survey').stderr, /--workDir is required/);
  const r = cli('fetch', '--workDir', tempDir('cli-'));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /fetch takes one assembly accession/);
});

test('a command failure prints the PipelineError and exits 1', () => {
  const r = cli('survey', '--workDir', tempDir('cli-'));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^Error: survey: --apiCommonData: is required\nNext: pass --apiCommonData <an ApiCommonData checkout>/);
});

test('survey, build and finalize run from the command line', { skip: perlMissing }, async () => {
  const workDir = await fetchedWorkDir();
  const apiCommonData = fakeApiCommonData();
  let r = cli('survey', '--workDir', workDir, '--apiCommonData', apiCommonData);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^suggested error attributes\/attributeNotInMap \(1\): gene \(ISF coding_gene\) carries keys the map does not list: is_ordered \[TST_0020\]$/m);
  assert.match(r.stdout, /^Wrote .*survey\.json$/m);
  writeRecipe(workDir);
  r = cli('build', '--workDir', workDir, '--apiCommonData', apiCommonData);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^ {2}addMrnaToGeneCds: 3$/m);
  r = cli('finalize', '--workDir', workDir, '--apiCommonData', apiCommonData);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^ {2}final\/primary_chromosome: 1 sequences$/m);
  assert.match(r.stdout, /^Wrote .*genome-build\.json$/m);
});
