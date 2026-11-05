import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { partitionName, readGenomeBuild } from '../shared/scripts/genome/genome-build.js';
import { sha256 } from '../shared/scripts/genome/workdir.js';
import { tempDir } from './genome-helpers.js';
import { ORGANELLE, PRIMARY, trialBuild, trialWorkDir } from './genome-trial-helpers.js';

test('partitionName is the last part of a partition dir', () => {
  assert.equal(partitionName(trialBuild().partitions[0]), PRIMARY);
  assert.equal(partitionName(trialBuild().partitions[1]), ORGANELLE);
});

test('readGenomeBuild returns the record and its sha256', () => {
  const { workDir } = trialWorkDir();
  const { build, sha256: digest } = readGenomeBuild(workDir, 'trial');
  assert.deepEqual(build, trialBuild());
  assert.equal(digest, sha256(`${JSON.stringify(trialBuild(), null, 2)}\n`));
});

test('readGenomeBuild refuses a missing, other-version or incomplete genome-build.json', () => {
  assert.throws(() => readGenomeBuild(tempDir('empty-'), 'trial'), /trial: .*genome-build\.json: is missing\nNext: run finalize first/);
  const { workDir: older } = trialWorkDir({ ...trialBuild(), schemaVersion: 2 });
  assert.throws(() => readGenomeBuild(older, 'trial'), /has schemaVersion 2, not 1\nNext: run build and finalize again/);
  const { workDir: bad } = trialWorkDir({ ...trialBuild(), accession: '../x' });
  assert.throws(() => readGenomeBuild(bad, 'trial'), /is incomplete: it needs accession, apiCommonData\.isfMap\.sha256 and partitions/);
});

test('readGenomeBuild refuses a final/ file that is missing or empty, and a build GFF3 that changed', () => {
  const { workDir } = trialWorkDir();
  const fasta = join(workDir, `final/${ORGANELLE}/genome.fasta`);
  writeFileSync(fasta, '');
  assert.throws(() => readGenomeBuild(workDir, 'trial'), (e) => e.file === fasta && e.problem === 'is missing or empty' && e.next === 'run finalize again');
  const { workDir: changed } = trialWorkDir();
  appendFileSync(join(changed, `build/${PRIMARY}/genome.gff3`), '# edited\n');
  assert.throws(() => readGenomeBuild(changed, 'trial'), /genome\.gff3: does not match genome-build\.json/);
});

test('readGenomeBuild names the command that called it', () => {
  assert.throws(() => readGenomeBuild(tempDir('empty-'), 'functional'), (e) => e.command === 'functional' && /^functional: /.test(e.message));
});
