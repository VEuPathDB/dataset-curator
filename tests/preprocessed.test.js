import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectPreprocessed } from '../shared/scripts/lib/preprocessed.js';
import { workAreaOf } from '../shared/scripts/lib/validation-workspace.js';

const LOC = { label: 'productNames GenBank', organism: 'o1', relative: 'P/o1/function/p/v/final', file: 'products.txt', datasetName: 'o1_p_RSRC' };

function area() {
  const workArea = mkdtempSync(join(tmpdir(), 'preprocess-'));
  mkdirSync(join(workArea, 'final'));
  writeFileSync(join(workArea, 'final/products.txt'), 'g1\tkinase\n');
  return workArea;
}
const typeReturning = (result) => ({ preprocessedFiles: (proposalDir, location, { workArea }) => result(workArea, location) });
const collect = (workArea, result, extra = {}) =>
  collectPreprocessed({ datasetType: typeReturning(result), proposalDir: '/p', proposalId: 'GCA_1', locations: [LOC], workArea, ...extra });

test('workAreaOf is proposals/<id>/preprocess under the type directory', () => {
  assert.equal(workAreaOf('/root/annotated-genome-validation', 'GCA_1'), '/root/annotated-genome-validation/proposals/GCA_1/preprocess');
});

test('collectPreprocessed maps each file to its delivery path and keeps provenance by delivery directory', () => {
  const workArea = area();
  const { sources, provenance } = collect(workArea, (w) => ({ files: [{ path: 'products.txt', from: join(w, 'final/products.txt') }], problems: [], provenance: { build: 'abc' } }));
  assert.deepEqual(sources, { 'P/o1/function/p/v/final/products.txt': realpathSync(join(workArea, 'final/products.txt')) });
  assert.deepEqual(provenance, { 'P/o1/function/p/v/final': { build: 'abc' } });
});

test('a missing work area is refused, naming it', () => {
  assert.throws(() => collect(join(tmpdir(), 'no-such-work-area'), () => ({ files: [] })),
    /No preprocessing work area for GCA_1 at .*no-such-work-area; run preprocessing there first/);
});

test('the type\'s problems are refused under the entry label', () => {
  const workArea = area();
  assert.throws(() => collect(workArea, () => ({ files: [], problems: ['genome-build.json is stale; run genome-pipeline.js build'] })),
    /GCA_1: the preprocessing work area cannot be delivered:\n  - productNames GenBank: genome-build\.json is stale/);
});

test('bad paths and sources are each refused', () => {
  const workArea = area();
  const outside = mkdtempSync(join(tmpdir(), 'outside-'));
  writeFileSync(join(outside, 'x.txt'), 'x');
  symlinkSync(join(outside, 'x.txt'), join(workArea, 'final/link.txt'));
  const cases = [
    [{ path: '../escape.txt', from: join(workArea, 'final/products.txt') }, /\.\.\/escape\.txt is not a relative path inside the delivery directory/],
    [{ path: '/abs.txt', from: join(workArea, 'final/products.txt') }, /\/abs\.txt is not a relative path inside the delivery directory/],
    [{ path: 'x.txt', from: join(outside, 'x.txt') }, /is outside the work area/],
    [{ path: 'link.txt', from: join(workArea, 'final/link.txt') }, /is outside the work area/],
    [{ path: 'dir', from: join(workArea, 'final') }, /is not a regular file/],
    [{ path: 'none.txt', from: join(workArea, 'final/none.txt') }, /does not exist/]
  ];
  for (const [file, message] of cases) {
    assert.throws(() => collect(workArea, () => ({ files: [file] })), message, file.path);
  }
});

test('a delivery path given twice, or also rendered as text, is refused', () => {
  const workArea = area();
  const from = join(workArea, 'final/products.txt');
  assert.throws(() => collect(workArea, () => ({ files: [{ path: 'products.txt', from }, { path: 'products.txt', from }] })), /products\.txt is delivered twice/);
  assert.throws(() => collect(workArea, () => ({ files: [{ path: 'products.txt', from }] }), { rendered: { 'P/o1/function/p/v/final/products.txt': 'text' } }),
    /products\.txt is delivered twice/);
});
