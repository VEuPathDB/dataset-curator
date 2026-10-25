import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readTable, parseDelimited } from '../shared/scripts/lib/tabular/read-table.js';

function tmpFile(name, content) {
  const p = join(mkdtempSync(join(tmpdir(), 'rt-')), name);
  writeFileSync(p, content);
  return p;
}

test('CSV quoting: commas and doubled quotes', () => {
  const { headers, rows } = parseDelimited('h1,h2,h3\na,"b,c","d ""e"""\n', ',');
  assert.deepEqual(headers, ['h1', 'h2', 'h3']);
  assert.deepEqual(rows, [['a', 'b,c', 'd "e"']]);
});

test('CSV quoted field with embedded newline is one cell', () => {
  const { rows } = parseDelimited('a,b\n"x\ny",z\n', ',');
  assert.deepEqual(rows, [['x\ny', 'z']]);
});

test('BOM and CRLF: no \\r in values, BOM not in first header', () => {
  const { headers, rows } = parseDelimited('﻿id,v\r\n1,a\r\n2,b\r\n', ',');
  assert.deepEqual(headers, ['id', 'v']);
  assert.deepEqual(rows, [['1', 'a'], ['2', 'b']]);
  const t = parseDelimited('﻿id\tv\r\n1\ta\r\n', '\t');
  assert.deepEqual(t.headers, ['id', 'v']);
  assert.deepEqual(t.rows, [['1', 'a']]);
});

test('ragged CSV row error names file and the line where the record starts', () => {
  const p = tmpFile('r.csv', 'a,b\n"x\ny",z\n1,2,3\n');
  assert.throws(() => readTable(p), (e) => e.message.includes('r.csv') && /line 4\b/.test(e.message));
});

test('ragged TSV row error has line number', () => {
  assert.throws(() => parseDelimited('a\tb\n1\n', '\t'), /line 2\b/);
});

test('TSV keeps literal quotes and does not trim', () => {
  const { rows } = parseDelimited('a\tb\n"x\t y \n', '\t');
  assert.deepEqual(rows, [['"x', ' y ']]);
});

test('empty cells and missing trailing newline; only one trailing empty line dropped', () => {
  const { rows } = parseDelimited('a,b,c\n1,,\n,2,3', ',');
  assert.deepEqual(rows, [['1', '', ''], ['', '2', '3']]);
});

test('delimiter from extension, else sniffed from line 1', () => {
  assert.equal(readTable(tmpFile('a.csv', 'a,b\n1,2\n')).delimiter, ',');
  assert.equal(readTable(tmpFile('a.tsv', 'a\tb\n1\t2\n')).delimiter, '\t');
  assert.equal(readTable(tmpFile('a.txt', 'a\tb\n1\t2\n')).delimiter, '\t');
  assert.equal(readTable(tmpFile('a.dat', 'a,b,c\n1,2,3\n')).delimiter, ',');
  assert.equal(readTable(tmpFile('a.dat', 'a\tb\tc,d\n1\t2\t3\n')).delimiter, '\t');
  const t = readTable(tmpFile('a.csv', 'a,b\n1,2\n'));
  assert.equal(t.file.endsWith('a.csv'), true);
});

test('unterminated quote throws', () => {
  assert.throws(() => parseDelimited('a,b\n"x,y\n', ','), /unterminated/i);
});

test('large input parses linearly', () => {
  const n = 300000;
  const lines = ['a,b,c'];
  for (let i = 0; i < n; i++) lines.push(`${i},"v ${i}",z`);
  const t0 = Date.now();
  const { rows } = parseDelimited(lines.join('\n'), ',');
  assert.equal(rows.length, n);
  assert.ok(Date.now() - t0 < 5000);
});
