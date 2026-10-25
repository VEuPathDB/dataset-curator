#!/usr/bin/env node
/**
 * profile-tables.js - Prints a capped JSON profile of every .csv/.tsv/.txt
 * file in a directory (columns, types, top values, quirks, parent links).
 * Read-only.
 *
 * Usage: node profile-tables.js <inputDir> [--top N]
 */
import { parseArgs } from 'node:util';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readTable } from './lib/tabular/read-table.js';
import { profileTables } from './lib/tabular/profile.js';

function main() {
  const { values, positionals } = parseArgs({
    options: { top: { type: 'string', default: '20' } },
    allowPositionals: true
  });
  if (positionals.length !== 1) throw new Error('Usage: profile-tables.js <inputDir> [--top N]');
  const dir = positionals[0];
  const topN = Number(values.top);
  if (!Number.isInteger(topN) || topN < 1) throw new Error(`--top must be a positive integer, got "${values.top}"`);
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`Not a directory: ${dir}`);

  const names = readdirSync(dir).filter(n => /\.(csv|tsv|txt)$/i.test(n)).sort();
  if (names.length === 0) throw new Error(`No .csv/.tsv/.txt files in ${dir}`);
  const tables = names.map(n => readTable(join(dir, n)));
  console.log(JSON.stringify(profileTables(tables, { topN }), null, 2));
}

try { main(); } catch (err) { console.error(`Error: ${err.message}`); process.exit(1); }
