import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { FUNCTIONAL_GFF3, functionalWorkDir } from './genome-functional-helpers.js';
import { CM, fakeApiCommonData, fetchedWorkDir, gffLine, perlMissing, tempDir, writeRecipe } from './genome-helpers.js';

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

test('an option the command does not take is a usage error', () => {
  const dir = tempDir('cli-');
  for (const args of [['fetch', 'GCA_000000001.1', '--apiCommonData', '/x'], ['survey', '--preprocessGFF3', '/x'], ['build', '--preprocessGFF3', '/x']]) {
    const r = cli(...args, '--workDir', dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, new RegExp(`${args[0]} does not take --(apiCommonData|preprocessGFF3)\\.\\nUsage:`));
  }
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

test('trial takes --image, --gusConfig, --taxonId and --keep, or --undo in place of the last two', () => {
  const dir = tempDir('cli-');
  let r = cli('trial', '--workDir', dir, '--undo', '--keep');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /trial --undo takes no --keep or --taxonId\.\nUsage:/);
  r = cli('trial', '--workDir', dir, '--undo', '--taxonId', '284813');
  assert.match(r.stderr, /trial --undo takes no --keep or --taxonId\.\nUsage:/);
  r = cli('fetch', 'GCA_000000001.1', '--workDir', dir, '--image', 'gus_isf:local');
  assert.match(r.stderr, /fetch does not take --image\.\nUsage:/);
  r = cli('trial', '--workDir', dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^Error: trial: --image: is required\nNext: pass --image/);
  r = cli('trial', '--workDir', dir, '--image', 'gus_isf:local', '--gusConfig', join(dir, 'gus.config'), '--taxonId', '284813');
  assert.match(r.stderr, /^Error: trial: .*gus\.config: is missing/);
  r = cli('trial', '--workDir', dir, '--image', 'gus_isf:local', '--gusConfig', CLI, '--taxonId', 'ecun');
  assert.match(r.stderr, /^Error: trial: --taxonId: must be an NCBI taxon id/);
  r = cli('trial', '--workDir', dir, '--image', 'gus_isf:local', '--gusConfig', CLI, '--undo');
  assert.match(r.stderr, /^Error: trial: .*trial\.json: is missing; there is nothing to undo/);
  assert.match(cli().stderr, /node genome-pipeline\.js trial --workDir <dir> --image <name> --gusConfig <file> --undo/);
});

test('functional takes only --workDir, prints a line per dataset, and exits 1 on an error finding', () => {
  let r = cli('functional', '--workDir', tempDir('cli-'), '--image', 'gus_isf:local');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /functional does not take --image\.\nUsage:/);
  r = cli('functional', '--workDir', functionalWorkDir());
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^ {2}productNames GenBank: 2$/m);
  assert.match(r.stdout, /^ {2}dbxref_simple interpro_from_annotation: 1$/m);
  assert.match(r.stdout, /^info functional\/emptyClass \(1\): datasets with no rows; no file is written for them \[comments\/GenBank_gene\]$/m);
  assert.match(r.stdout, /^Wrote .*functional\.json$/m);
  const orphan = functionalWorkDir({ gff3: `${FUNCTIONAL_GFF3}${gffLine(CM, 'ncRNA', 2000, 2072, '+', 'ID=rna-orphan;product=orphan ncRNA')}\n` });
  r = cli('functional', '--workDir', orphan);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^error functional\/unresolvedFeature \(1\): .* \[rna-orphan\]$/m);
  assert.match(cli().stderr, /node genome-pipeline\.js functional --workDir <dir>/);
});
