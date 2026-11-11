import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inferColumns, writeColumns, runConvert } from '../shared/scripts/dataset-types/functional-update/commands.js';
import { checkConvertCurrent, readConverted, workFiles } from '../shared/scripts/dataset-types/functional-update/record.js';
import { RELEASED_GFF, INPUT, ENTRY, sha, fetched } from './functional-update-helpers.js';

test('runFetch writes gff.json, the GFF and the pulled input, checking the staged digest', async () => {
  const { workArea, record } = await fetched();
  assert.equal(record.gff.release, '68');
  assert.equal(record.gff.sha256, sha(RELEASED_GFF));
  assert.equal(record.input.sha256, sha(INPUT));
  assert.equal(readFileSync(join(workArea, 'input', 'products.tsv'), 'utf-8'), INPUT);
  assert.deepEqual(JSON.parse(readFileSync(workFiles(workArea).gffJson, 'utf-8')), record);
});

test('inferColumns finds the header, the ID column and its level, and the value column', async () => {
  const { workArea } = await fetched();
  assert.deepEqual(inferColumns(workArea, 'productNames').columns, { schemaVersion: 1, header: true, id: { column: 1, level: 'gene' }, values: { product: 2 } });
});

test('runConvert writes final/<file> and convert.json; checkConvertCurrent spots any change', async () => {
  const { workArea } = await fetched();
  writeColumns(workArea, 'productNames', inferColumns(workArea, 'productNames').columns);
  const record = runConvert({ workArea, entry: ENTRY });
  assert.equal(readFileSync(join(workArea, 'final', 'products.txt'), 'utf-8'), 'TFAK_0010.1\tkinase\t1\nTFAK_0010.2\tkinase\t1\nTFAK_0020.1\tncRNA\t1\n');
  assert.equal(record.rows, 3);
  assert.deepEqual(record.entry, ENTRY);
  assert.deepEqual(checkConvertCurrent(workArea, ENTRY), []);
  assert.equal(readConverted(workArea).record.sha256, record.sha256);

  assert.deepEqual(checkConvertCurrent(workArea, { ...ENTRY, version: '2026-12-01' }), ['convert.json is for productNames VEuPathDB 2026-11-03, not productNames VEuPathDB 2026-12-01; run functional-update.js convert again']);
  writeFileSync(join(workArea, 'final', 'products.txt'), 'x\n');
  assert.deepEqual(checkConvertCurrent(workArea, ENTRY), ['final/products.txt changed since convert; run functional-update.js convert again']);
});

test('writeColumns refuses a mapping the class cannot use', async () => {
  const { workArea } = await fetched();
  assert.throws(() => writeColumns(workArea, 'productNames', { header: true, id: { column: 1, level: 'gene' }, values: {} }), /values\.product is required/);
  assert.equal(existsSync(workFiles(workArea).columns), false);
});

test('checkConvertCurrent names what is missing', () => {
  const workArea = mkdtempSync(join(tmpdir(), 'fu-empty-'));
  assert.deepEqual(checkConvertCurrent(workArea, ENTRY), ['no convert.json in the work area; run functional-update.js fetch, columns and convert']);
});
