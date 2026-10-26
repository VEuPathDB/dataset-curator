import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { readTable } from '../shared/scripts/lib/tabular/read-table.js';
import { profileTables } from '../shared/scripts/lib/tabular/profile.js';
import { renderStf } from '../shared/scripts/lib/tabular/render.js';
import { checkStf } from '../shared/scripts/lib/tabular/check.js';

// Opt-in: 1,000 parents and 1,000,000 children, in the default heap.
const PARENTS = 1000;
const CHILDREN = 1_000_000;

test('scale: profile, render and check 1M child rows', { skip: process.env.STF_SCALE_TEST !== '1', timeout: 900_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stf-scale-'));
  try {
    const started = Date.now();
    let peak = 0;
    const sample = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 200);
    const stage = (label) => {
      peak = Math.max(peak, process.memoryUsage().rss);
      console.log(`  ${label}: ${((Date.now() - started) / 1000).toFixed(1)}s, rss ${(process.memoryUsage().rss / 2 ** 20).toFixed(0)} MiB`);
    };

    writeFileSync(join(dir, 'parent.csv'), `parent_id,name\n${Array.from({ length: PARENTS }, (_, i) => `P${i},Parent ${i}`).join('\n')}\n`);
    const out = createWriteStream(join(dir, 'child.csv'));
    out.write('child_id,parent_id,age,weight,visit_date,sex,status,note\n');
    for (let i = 0; i < CHILDREN; i++) {
      const month = String((i % 12) + 1).padStart(2, '0');
      const day = String((i % 28) + 1).padStart(2, '0');
      const ok = out.write(`C${i},P${i % PARENTS},${i % 90},${(30 + (i % 500) / 10).toFixed(1)},2023-${month}-${day},${i % 2 ? 'F' : 'M'},${['ok', 'late', 'lost'][i % 3]},${i % 7 === 0 ? '' : `note ${i % 1000}`}\n`);
      if (!ok) await once(out, 'drain');
    }
    out.end();
    await once(out, 'finish');
    stage('generated');

    const tables = ['parent', 'child'].map((n) => readTable(join(dir, `${n}.csv`)));
    stage('read');
    const profile = profileTables(tables);
    assert.equal(profile.files.length, 2);
    stage('profiled');

    const spec = {
      specVersion: 1,
      study: { name: 'Scale test' },
      inputDir: dir,
      entities: [
        { name: 'parent', displayName: 'Parent', displayNamePlural: 'Parents', file: 'parent.csv', idColumn: 'parent_id', variables: [{ column: 'name' }] },
        {
          name: 'child', displayName: 'Child', displayNamePlural: 'Children', file: 'child.csv', idColumn: 'child_id',
          parent: 'parent', parentColumn: 'parent_id',
          variables: ['age', 'weight', 'visit_date', 'sex', 'status', 'note'].map((column) => ({ column })),
        },
      ],
      transforms: [],
    };
    const { files } = renderStf(spec, new Map(tables.map((t, i) => [['parent', 'child'][i], { headers: t.headers, rows: t.rows }])), { sourceDir: dir });
    stage('rendered');

    const outDir = join(dir, 'stf');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(outDir);
    for (const [name, text] of Object.entries(files)) writeFileSync(join(outDir, name), text);
    const result = checkStf(outDir);
    stage('checked');
    clearInterval(sample);

    assert.deepEqual(result.errors, []);
    peak = Math.max(peak, process.memoryUsage().rss);
    console.log(`  scale result: wall ${((Date.now() - started) / 1000).toFixed(1)}s, peak rss ${(peak / 2 ** 20).toFixed(0)} MiB`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
