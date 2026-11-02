import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';

const root = new URL('../shared/scripts/', import.meta.url).pathname;
const IMPORT = /(?:import|export)[^'"]*?from\s+['"](\.{1,2}\/[^'"]+)['"]/g;
const modules = readdirSync(root, { recursive: true }).filter((f) => f.endsWith('.js')).map((f) => join(root, f));
const importsOf = (file) => [...readFileSync(file, 'utf-8').matchAll(IMPORT)].map(([, spec]) => resolve(dirname(file), spec));

/** The import chain from start back to start, or null. */
function cycleThrough(start) {
  const seen = new Set();
  const walk = (file, path) => {
    for (const next of importsOf(file)) {
      if (next === start) return [...path, next];
      if (seen.has(next)) continue;
      seen.add(next);
      const found = walk(next, [...path, next]);
      if (found) return found;
    }
    return null;
  };
  return walk(start, [start]);
}

test('no module under shared/scripts imports itself through a chain, so module-level code never sees an unfinished import', () => {
  const cycles = modules.map(cycleThrough).filter(Boolean).map((c) => c.map((f) => relative(root, f)).join(' → '));
  assert.deepEqual(cycles, []);
});
