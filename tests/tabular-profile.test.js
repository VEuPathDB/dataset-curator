import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseDelimited } from '../shared/scripts/lib/tabular/read-table.js';
import { profileTables, PLACEHOLDERS, UNAMBIGUOUS_PLACEHOLDERS } from '../shared/scripts/lib/tabular/profile.js';

function table(file, csv) {
  return { file: `/data/${file}`, delimiter: ',', ...parseDelimited(csv, ',', file) };
}

const village = table('village.csv', 'village_id,name\nV1,Alpha\nV2,Beta\n');
const household = table('household.csv', 'household_id,village_id\nH1,V1\nH2,V1\nH3,V2\n');
const participant = table('participant.csv', [
  'participant_id,household_id,age,code,consent,note',
  'P1,H1,34,007,y,NA',
  'P2,H1,80+,012,Yes,ok',
  'P3,H2,5,345,yes ,NA',
  'P4,H3,61,678,y,'
].join('\n') + '\n');

const profile = profileTables([village, household, participant]);
const col = (file, header) => profile.files.find(f => f.file === file).columns.find(c => c.header === header);

test('file entries carry basename, delimiter, rowCount, headers and sample rows', () => {
  const p = profile.files.find(f => f.file === 'participant.csv');
  assert.equal(p.delimiter, ',');
  assert.equal(p.rowCount, 4);
  assert.deepEqual(p.headers[0], 'participant_id');
  assert.equal(p.sampleRows.length, 4);
  assert.equal(profileTables([participant], { sampleRows: 2 }).files[0].sampleRows.length, 2);
});

test('parent link household.village_id -> village.village_id', () => {
  assert.ok(profile.parentLinks.some(l =>
    l.file === 'household.csv' && l.column === 'village_id' && l.refFile === 'village.csv' && l.refColumn === 'village_id'));
  assert.ok(profile.parentLinks.some(l =>
    l.file === 'participant.csv' && l.column === 'household_id' && l.refFile === 'household.csv' && l.refColumn === 'household_id'));
  // a file's only candidate ID is not a link
  assert.ok(!profile.parentLinks.some(l => l.file === 'village.csv' && l.column === 'village_id'));
});

test('IDs are flagged as candidates', () => {
  assert.equal(col('village.csv', 'village_id').isCandidateId, true);
  assert.equal(col('participant.csv', 'participant_id').isCandidateId, true);
  assert.equal(col('household.csv', 'village_id').isCandidateId, false);
  assert.equal(col('participant.csv', 'note').isCandidateId, false);
});

test('y / Yes / "yes " give a near-duplicate pair and a whitespace count', () => {
  const c = col('participant.csv', 'consent');
  assert.deepEqual(c.nearDuplicates, [['Yes', 'yes ']]);
  assert.equal(c.nearDuplicateCount, 1);
  assert.equal(c.whitespaceCells, 1);
});

test('"80+" makes age a string and appears in top', () => {
  const c = col('participant.csv', 'age');
  assert.equal(c.inferred.data_type, 'string');
  assert.ok(c.top.some(t => t.value === '80+'));
  assert.equal(c.min, undefined);
});

test('leading-zero codes are flagged', () => {
  assert.equal(col('participant.csv', 'code').leadingZeros, true);
  assert.equal(col('participant.csv', 'age').leadingZeros, false);
});

test('placeholders are counted', () => {
  assert.deepEqual(col('participant.csv', 'note').placeholderCells, { NA: 2 });
});

test('top is capped at topN while distinctCount stays exact', () => {
  const rows = ['v'];
  for (let i = 0; i < 30; i++) rows.push(`x${i}`, `x${i}`);
  rows.push('x0');
  const p = profileTables([table('t.csv', rows.join('\n') + '\n')], { topN: 5 });
  const c = p.files[0].columns[0];
  assert.equal(c.top.length, 5);
  assert.equal(c.distinctCount, 30);
  assert.deepEqual(c.top[0], { value: 'x0', count: 3 });
  assert.deepEqual(c.top[1], { value: 'x1', count: 2 });
});

test('min/max for numbers and ISO dates only', () => {
  const t = table('t.csv', 'n,d,s\n3,2020-05-01,a\n-1.5,2019-01-02,b\n10,2021-12-31,c\n');
  const [n, d, s] = profileTables([t]).files[0].columns;
  assert.equal(n.inferred.data_type, 'number');
  assert.equal(n.min, -1.5);
  assert.equal(n.max, 10);
  assert.equal(d.min, '2019-01-02');
  assert.equal(d.max, '2021-12-31');
  assert.equal(s.min, undefined);
});

test('Levenshtein near-duplicates need both values of 5+ chars', () => {
  const t = table('t.csv', 'v\nmalaria\nmalarla\ncat\ncot\ncat\n');
  assert.deepEqual(profileTables([t]).files[0].columns[0].nearDuplicates, [['malaria', 'malarla']]);
});

test('empty cells block candidate IDs; short rows read as empty', () => {
  const t = table('t.csv', 'a,b\n1,x\n2,\n');
  const [a, b] = profileTables([t]).files[0].columns;
  assert.equal(a.isCandidateId, true);
  assert.equal(b.isCandidateId, false);
});

test('placeholder lists', () => {
  assert.ok(UNAMBIGUOUS_PLACEHOLDERS.every(p => PLACEHOLDERS.includes(p)));
  assert.ok(PLACEHOLDERS.includes('not done'));
  assert.ok(!UNAMBIGUOUS_PLACEHOLDERS.includes('unknown'));
});

test('profile-tables CLI prints JSON for a directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pt-'));
  writeFileSync(join(dir, 'a.csv'), 'id,x\n1,a\n2,b\n');
  writeFileSync(join(dir, 'ignore.md'), 'nope');
  const out = execFileSync('node', ['shared/scripts/profile-tables.js', dir, '--top', '1']);
  const p = JSON.parse(out);
  assert.equal(p.files.length, 1);
  assert.equal(p.files[0].file, 'a.csv');
  assert.equal(p.files[0].columns[1].top.length, 1);
});

test('profile-tables CLI errors on a missing directory', () => {
  assert.throws(() => execFileSync('node', ['shared/scripts/profile-tables.js', '/no/such/dir'], { stdio: 'pipe' }), /Not a directory/);
});

test('one stray non-numeric value late in a column makes it a string', () => {
  const rows = ['v'];
  for (let i = 0; i < 2000; i++) rows.push(String(i + 1));
  rows.push('80+');
  const c = profileTables([table('t.csv', rows.join('\n') + '\n')]).files[0].columns[0];
  assert.equal(c.inferred.data_type, 'string');
});

test('nearDuplicates is capped at topN and nearDuplicateCount stays true', () => {
  const rows = ['v'];
  for (let i = 0; i < 200; i++) rows.push(`sample${String(i).padStart(3, '0')}`, `sample${String(i).padStart(3, '0')}`);
  const c = profileTables([table('t.csv', rows.join('\n') + '\n')], { topN: 20 }).files[0].columns[0];
  assert.equal(c.nearDuplicates.length, 20);
  assert.ok(c.nearDuplicateCount > 20);
  assert.deepEqual(c.nearDuplicates[0], ['sample000', 'sample001']);
});

test('normalised-equal pairs come before Levenshtein pairs', () => {
  const t = table('t.csv', 'v\nmalaria\nmalarla\nYes\nyes\nYes\n');
  const c = profileTables([t]).files[0].columns[0];
  assert.deepEqual(c.nearDuplicates, [['Yes', 'yes'], ['malaria', 'malarla']]);
});

test('candidate ID columns get no near-duplicates', () => {
  const rows = ['id'];
  for (let i = 0; i < 50; i++) rows.push(`sample${String(i).padStart(3, '0')}`);
  const c = profileTables([table('t.csv', rows.join('\n') + '\n')]).files[0].columns[0];
  assert.equal(c.isCandidateId, true);
  assert.deepEqual(c.nearDuplicates, []);
  assert.equal(c.nearDuplicateCount, 0);
});

test('no parent link when a value is missing from the target ID', () => {
  const g = table('g.csv', 'id\nA\nB\nC\n');
  const f = table('f.csv', 'fid,gid\n1,A\n2,B\n3,Z\n');
  const p = profileTables([g, f]);
  assert.equal(p.parentLinks.length, 0);
});

test('a non-ID column whose values fit another ID column still links after pruning', () => {
  const g = table('g.csv', 'id\nA\nB\n');
  const f = table('f.csv', 'fid,gid\n1,A\n2,B\n3,A\n');
  const p = profileTables([g, f]);
  assert.deepEqual(p.parentLinks, [{ file: 'f.csv', column: 'gid', refFile: 'g.csv', refColumn: 'id' }]);
});

test('a column with blank cells still links when its non-empty values fit the target ID', () => {
  const g = table('g.csv', 'id\nA\nB\n');
  const f = table('f.csv', 'fid,gid\n1,A\n2,B\n3,\n');
  assert.deepEqual(profileTables([g, f]).parentLinks, [{ file: 'f.csv', column: 'gid', refFile: 'g.csv', refColumn: 'id' }]);
});
