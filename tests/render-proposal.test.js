import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';

const cli = new URL('../shared/scripts/render-proposal.js', import.meta.url).pathname;
const fixtures = new URL('./fixtures/proposals/', import.meta.url).pathname;

function run(args) {
  const result = spawnSync('node', [cli, ...args], { encoding: 'utf-8' });
  return { stdout: result.stdout, stderr: result.stderr, status: result.status };
}

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

test('prints no warning when overrides only use known injector prop keys', () => {
  const { stdout, stderr, status } = run([fixtures + 'PRJNA000002']);
  assert.equal(status, 0);
  assert.doesNotMatch(stderr, /Warning:/);
  assert.match(stdout, /<datasetPresenter/);
});

test('warns on stderr about injector props absent from the renderer defaults', (t) => {
  const tmp = mkdtempSync(join(tmpdir(), 'render-cli-warn-'));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const src = fixtures + 'PRJNA000002';
  const dest = join(tmp, basename(src));
  cpSync(src, dest, { recursive: true });
  const presenterPath = join(dest, 'curated', 'presenter.json');
  const presenter = JSON.parse(readFileSync(presenterPath, 'utf-8'));
  presenter.injectorProps = { graphType: 'line', notARealDefault: 'x', alsoUnknown: 'y' };
  writeFileSync(presenterPath, JSON.stringify(presenter));
  const { stderr, status } = run([dest]);
  assert.equal(status, 0);
  assert.match(stderr, /Warning: injector props not in defaults: notARealDefault, alsoUnknown/);
});
