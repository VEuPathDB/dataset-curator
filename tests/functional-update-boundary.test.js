import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

const root = new URL('../shared/scripts/', import.meta.url).pathname;
const IMPORT = /(?:import|export)[^'"]*?from\s+['"](\.{1,2}\/[^'"]+)['"]/g;
const importsOf = (file) => [...readFileSync(file, 'utf-8').matchAll(IMPORT)].map(([, spec]) => resolve(dirname(file), spec));

function reachableFrom(start) {
  const seen = new Set();
  const queue = [start];
  while (queue.length) {
    for (const next of importsOf(queue.pop())) {
      if (!seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
  return [...seen].map((f) => relative(root, f));
}

const FORBIDDEN = /^genome\/gff\.js$|functional-update\/(gff-|converters|commands)/;

for (const entry of ['dataset-types/index.js', 'dataset-types/validators.js']) {
  test(`${entry} does not reach the verify-only GFF and converter modules`, () => {
    assert.deepEqual(reachableFrom(resolve(root, entry)).filter((f) => FORBIDDEN.test(f)), []);
  });
}
