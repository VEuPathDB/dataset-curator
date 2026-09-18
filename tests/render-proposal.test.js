import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const cli = new URL('../shared/scripts/render-proposal.js', import.meta.url).pathname;
const fixtures = new URL('./fixtures/proposals/', import.meta.url).pathname;

test('prints XML for a proposal directory', () => {
  const out = execFileSync('node', [cli, fixtures + 'GCA_000001.1'], { encoding: 'utf-8' });
  assert.match(out, /<datasetPresenter name="tfakST1_primary_genome_RSRC"/);
});

test('--name prints only the presenter name', () => {
  const out = execFileSync('node', [cli, '--name', fixtures + 'PRJNA000002'], { encoding: 'utf-8' });
  assert.equal(out.trim(), 'tfak_PRJNA000002_rnaSeq_RSRC');
});

test('fails with a clear message for a missing directory', () => {
  assert.throws(
    () => execFileSync('node', [cli, '/no/such/dir'], { encoding: 'utf-8', stdio: 'pipe' }),
    (err) => /No manifest\.json/.test(err.stderr)
  );
});
