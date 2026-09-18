import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validate, read, write } from '../shared/scripts/lib/manifest.js';

function valid() {
  return {
    schemaVersion: 1,
    accession: 'PRJNA123456',
    datasetType: 'bulk-rnaseq',
    project: 'FungiDB',
    organismAbbrev: 'afumAf293',
    targetBuild: '02',
    contacts: { primary: 'jane.doe', additional: ['ravi.kumar'] },
    curator: 'someone@apidb.org',
    createdAt: '2026-09-18T14:00:00.000Z',
    skill: { name: 'propose-bulk-rnaseq', version: '2.0.0' }
  };
}

test('a complete manifest has no errors', () => {
  assert.deepEqual(validate(valid()), []);
});

test('validate rejects a non-object manifest', () => {
  assert.deepEqual(validate(null), ['manifest must be a JSON object']);
  assert.deepEqual(validate(undefined), ['manifest must be a JSON object']);
  assert.deepEqual(validate([]), ['manifest must be a JSON object']);
  assert.deepEqual(validate('nope'), ['manifest must be a JSON object']);
});

test('contacts.additional must be an array of non-empty strings', () => {
  assert.ok(validate({ ...valid(), contacts: { primary: 'jane.doe', additional: 'nope' } })
    .some(e => /contacts\.additional must be an array of non-empty contact ids/.test(e)));
  assert.ok(validate({ ...valid(), contacts: { primary: 'jane.doe', additional: ['', 'ravi.kumar'] } })
    .some(e => /contacts\.additional must be an array of non-empty contact ids/.test(e)));
  assert.ok(validate({ ...valid(), contacts: { primary: 'jane.doe', additional: [123] } })
    .some(e => /contacts\.additional must be an array of non-empty contact ids/.test(e)));
  assert.deepEqual(validate({ ...valid(), contacts: { primary: 'jane.doe', additional: [] } }), []);
});

test('createdAt must be a strict ISO 8601 UTC timestamp', () => {
  const msg = /createdAt must be an ISO 8601 UTC timestamp/;
  assert.ok(validate({ ...valid(), createdAt: '2026-09-18' }).some(e => msg.test(e)));
  assert.ok(validate({ ...valid(), createdAt: 'not-a-date' }).some(e => msg.test(e)));
  assert.ok(validate({ ...valid(), createdAt: '2026-13-99T99:99:99Z' }).some(e => msg.test(e)));
  assert.deepEqual(validate({ ...valid(), createdAt: '2026-09-18T14:00:00Z' }), []);
});

test('ticket is optional but must be well formed when present', () => {
  const m = { ...valid(), ticket: { system: 'redmine', id: '42', url: 'https://r/issues/42' } };
  assert.deepEqual(validate(m), []);
  const bad = { ...valid(), ticket: { system: 'jira', id: '42' } };
  const errors = validate(bad);
  assert.ok(errors.some(e => /ticket\.system/.test(e)));
  assert.ok(errors.some(e => /ticket\.url/.test(e)));
});

test('unknown schemaVersion is rejected', () => {
  assert.ok(validate({ ...valid(), schemaVersion: 99 }).some(e => /schemaVersion/.test(e)));
});

test('datasetType must have a renderer', () => {
  assert.ok(validate({ ...valid(), datasetType: 'proteomics' }).some(e => /renderer/.test(e)));
});

test('project must be a valid VEuPathDB project', () => {
  assert.ok(validate({ ...valid(), project: 'fungidb' }).some(e => /project/.test(e)));
});

test('targetBuild must be two or more digits', () => {
  assert.ok(validate({ ...valid(), targetBuild: '2' }).some(e => /targetBuild/.test(e)));
  assert.deepEqual(validate({ ...valid(), targetBuild: '102' }), []);
});

test('accession must match the directory name when given', () => {
  assert.ok(validate(valid(), { dirName: 'PRJNA000000' }).some(e => /directory/.test(e)));
});

test('accession format is restricted to letters, digits, underscore and dot', () => {
  const msg = /accession may contain only letters, digits, underscore and dot/;
  assert.ok(validate({ ...valid(), accession: 'PRJNA"123' }).some(e => msg.test(e)));
  assert.ok(validate({ ...valid(), accession: 'PRJNA&123' }).some(e => msg.test(e)));
  assert.deepEqual(validate({ ...valid(), accession: 'GCA_000001.1' }), []);
  assert.deepEqual(validate({ ...valid(), accession: 'PRJNA000002_no_overrides' }), []);
});

test('organismAbbrev format is restricted to letters and digits', () => {
  const msg = /organismAbbrev may contain only letters and digits/;
  assert.ok(validate({ ...valid(), organismAbbrev: 'tfak"ST1' }).some(e => msg.test(e)));
  assert.ok(validate({ ...valid(), organismAbbrev: 'tfak&ST1' }).some(e => msg.test(e)));
  assert.deepEqual(validate({ ...valid(), organismAbbrev: 'tfakST1' }), []);
});

test('contacts are checked against known ids when given', () => {
  const errors = validate(valid(), { contactIds: ['jane.doe'] });
  assert.ok(errors.some(e => /ravi\.kumar/.test(e)));
});

test('write validates, then read round-trips', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'manifest-')), 'PRJNA123456');
  mkdirSync(dir);
  write(dir, valid());
  const onDisk = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf-8'));
  assert.equal(onDisk.accession, 'PRJNA123456');
  assert.deepEqual(read(dir), valid());
});

test('write refuses an invalid manifest', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'manifest-')), 'PRJNA123456');
  mkdirSync(dir);
  assert.throws(() => write(dir, { ...valid(), project: 'Nope' }), /Invalid manifest/);
});

test('write creates the proposal directory if it does not exist', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'manifest-')), 'nested', 'PRJNA123456');
  write(dir, valid());
  assert.deepEqual(read(dir), valid());
});

test('read fails clearly when manifest.json is malformed', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'manifest-')), 'PRJNA123456');
  mkdirSync(dir);
  const path = join(dir, 'manifest.json');
  writeFileSync(path, '{ not valid json');
  assert.throws(() => read(dir), new RegExp(`^Error: ${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} is not valid JSON:`));
});

test('read refuses when directory name and accession disagree', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'manifest-')), 'PRJNA999999');
  mkdirSync(dir);
  write(dir, { ...valid(), accession: 'PRJNA999999' });
  assert.deepEqual(read(dir).accession, 'PRJNA999999');
  const wrong = join(mkdtempSync(join(tmpdir(), 'manifest-')), 'PRJNA000001');
  mkdirSync(wrong);
  // bypass write() validation to plant a mismatched file
  writeFileSync(join(wrong, 'manifest.json'), JSON.stringify(valid()));
  assert.throws(() => read(wrong), /directory/);
});
