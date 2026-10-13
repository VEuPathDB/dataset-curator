import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

const skillsDir = new URL('../skills/', import.meta.url).pathname;
const RELATIVE_IMPORT = /(?:import|export)[^'"]*?from\s+['"](\.{1,2}\/[^'"]+)['"]|import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g;

const scriptsOf = (dir) => readdirSync(dir, { recursive: true }).filter((f) => f.endsWith('.js')).map((f) => join(dir, f));

test('every relative import in a skill resolves inside that skill, so a missed sync fails here', () => {
  const missing = [];
  for (const skill of readdirSync(skillsDir)) {
    const scripts = join(skillsDir, skill, 'scripts');
    if (!existsSync(scripts)) continue;
    for (const file of scriptsOf(scripts)) {
      for (const [, a, b] of readFileSync(file, 'utf-8').matchAll(RELATIVE_IMPORT)) {
        const target = resolve(dirname(file), a ?? b);
        if (!existsSync(target)) missing.push(`${file.slice(skillsDir.length)} imports ${a ?? b}`);
      }
    }
  }
  assert.deepEqual(missing, []);
});
