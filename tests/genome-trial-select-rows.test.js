import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { perlMissing } from './genome-helpers.js';

const SCRIPT = fileURLToPath(new URL('../shared/scripts/genome/trial/selectRows.pl', import.meta.url));
const perl = (code, ...args) =>
  spawnSync('perl', ['-e', `require shift @ARGV; ${code}`, SCRIPT, ...args], { encoding: 'utf-8' });

test('guardSql strips leading comment lines and a trailing semicolon from a SELECT or WITH', { skip: perlMissing }, () => {
  assert.equal(perl('print guardSql($ARGV[0])', '-- trial:database\nSELECT current_database() AS name;\n').stdout,
    'SELECT current_database() AS name');
  assert.equal(perl('print guardSql($ARGV[0])', '  with t AS (SELECT 1) SELECT * FROM t').stdout,
    'with t AS (SELECT 1) SELECT * FROM t');
});

test('guardSql refuses anything but one SELECT or WITH', { skip: perlMissing }, () => {
  for (const sql of ['DELETE FROM dots.nafeatureimp', 'SELECT 1; DELETE FROM dots.nafeatureimp', '', '-- trial:x\n', 'SELECTED']) {
    const r = perl('guardSql($ARGV[0])', sql);
    assert.notEqual(r.status, 0, sql);
    assert.match(r.stderr, /^selectRows: only (a SELECT or WITH statement|one statement) is allowed$/m, sql);
  }
});

test('formatRow writes NULL as \\N and escapes backslashes, tabs and newlines', { skip: perlMissing }, () => {
  const r = perl('print formatRow(undef, "a\\tb", "c\\nd", "e\\\\f", "", 7)');
  assert.equal(r.stdout, '\\N\ta\\tb\tc\\nd\te\\\\f\t\t7\n');
});

test('run as a script, it refuses a write before it connects', { skip: perlMissing }, () => {
  const r = spawnSync('perl', [SCRIPT], { input: 'DELETE FROM dots.nafeatureimp', encoding: 'utf-8', env: { PATH: process.env.PATH } });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /selectRows: only a SELECT or WITH statement is allowed/);
});
