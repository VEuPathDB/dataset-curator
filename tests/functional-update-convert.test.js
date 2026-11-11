import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { convert, columnsProblems, CONVERTERS } from '../shared/scripts/dataset-types/functional-update/converters.js';
import { idIndex } from '../shared/scripts/dataset-types/functional-update/gff-ids.js';
import { RELEASED_GFF } from './functional-update-helpers.js';

const index = idIndex(RELEASED_GFF);
const run = (datasetClass, text, columns, idx = index) => convert({ datasetClass, name: 'VEuPathDB', version: '2026-11-03', text, columns, index: idx, taxonId: '999001' });
const sha = (s) => createHash('sha256').update(s).digest('hex');
const checks = (r) => r.findings.map((f) => [f.severity, f.check, f.count]);

test('every v1 class has a converter', () => {
  assert.deepEqual(Object.keys(CONVERTERS), ['productNames', 'GeneOntologyAssociations', 'EnzymeCommissionAssociations', 'geneName', 'comments', 'aliases']);
});

test('productNames maps gene IDs to every transcript, first product preferred', () => {
  const r = run('productNames', 'gene\tproduct\nTFAK_0010\tkinase\nTFAK_0010\tputative kinase\nTFAK_0020\tncRNA\n', { header: true, id: { column: 1, level: 'gene' }, values: { product: 2 } });
  assert.equal(r.file, 'products.txt');
  assert.equal(r.text, 'TFAK_0010.1\tkinase\t1\nTFAK_0010.1\tputative kinase\t0\nTFAK_0010.2\tkinase\t1\nTFAK_0010.2\tputative kinase\t0\nTFAK_0020.1\tncRNA\t1\n');
  assert.deepEqual(r.ids, { level: 'transcript', count: 3 });
  assert.deepEqual(checks(r), []);
});

test('productNames honours a preferred column', () => {
  const r = run('productNames', 'TFAK_0010.1\ta\t0\nTFAK_0010.1\tb\ttrue\n', { header: false, id: { column: 1, level: 'transcript' }, values: { product: 2, preferred: 3 } });
  assert.equal(r.text, 'TFAK_0010.1\ta\t0\nTFAK_0010.1\tb\t1\n');
});

test('unmatched IDs are an error under 100 rows; blank values are skipped with a warning', () => {
  const r = run('productNames', 'TFAK_0010\tk\nNOPE\tx\nTFAK_0020\t\n', { header: false, id: { column: 1, level: 'gene' }, values: { product: 2 } });
  assert.deepEqual(checks(r), [['error', 'unmatchedIds', 1], ['warning', 'emptyValue', 1]]);
  assert.deepEqual(r.findings[0].sample, ['NOPE']);
});

test('an ID at the wrong level is unmatched', () => {
  const r = run('aliases', 'TFAK_0010.1\tX\nTFAK_0020\tY\n', { header: false, id: { column: 1, level: 'gene' }, values: { alias: 2 } });
  assert.deepEqual(r.findings.find((f) => f.check === 'unmatchedIds').sample, ['TFAK_0010.1']);
  assert.equal(r.text, 'TFAK_0020.1\tY\n');
});

test('GO writes GAF lines, normalizing IDs, defaulting evidence, and warning without an aspect', () => {
  const r = run('GeneOntologyAssociations', 'TFAK_0010.1\t5524\tIDA\nTFAK_0010.1\tGO:0006468\t\nTFAK_0010.1\tGO:bad\tIEA\n', { header: false, id: { column: 1, level: 'transcript' }, values: { goId: 2, evidence: 3 } });
  assert.equal(r.file, 'associations.gas');
  assert.equal(r.text.split('\n')[0], 'VEuPathDB\tTFAK_0010.1\tTFAK_0010.1\t\tGO:0005524\t\tIDA\t\t\t\t\ttranscript\ttaxon:999001\t20261103\tVEuPathDB\t\t');
  assert.deepEqual(checks(r), [['warning', 'badGo', 1], ['warning', 'goAspectMissing', 2]]);
});

test('EC maps to proteins and skips bad numbers', () => {
  const r = run('EnzymeCommissionAssociations', 'TFAK_0010\t2.7.11.1\nTFAK_0010\t2.7\n', { header: false, id: { column: 1, level: 'gene' }, values: { ec: 2 } });
  assert.equal(r.text, 'TFAK_0010.1-p1\t2.7.11.1\nTFAK_0010.2-p1\t2.7.11.1\n');
  assert.deepEqual(checks(r), [['warning', 'badEc', 1]]);
});

test('geneName keeps one name per gene, the first, warning on conflicts', () => {
  const r = run('geneName', 'TFAK_0010.1\ttfkA\nTFAK_0010.2\ttfkB\n', { header: false, id: { column: 1, level: 'transcript' }, values: { name: 2 } });
  assert.equal(r.text, 'TFAK_0010\ttfkA\n');
  assert.deepEqual(checks(r), [['warning', 'geneNameConflict', 1]]);
});

test('comments stay at the ID column\'s level; aliases go to transcripts', () => {
  assert.equal(run('comments', 'TFAK_0010\tnote\n', { header: false, id: { column: 1, level: 'gene' }, values: { comment: 2 } }).text, 'TFAK_0010\tnote\n');
  assert.equal(run('aliases', 'TFAK_0020\tX1\n', { header: false, id: { column: 1, level: 'gene' }, values: { alias: 2 } }).text, 'TFAK_0020.1\tX1\n');
});

test('no rows is an error; output is byte-stable', () => {
  const r = run('aliases', 'NOPE\tX\n', { header: false, id: { column: 1, level: 'gene' }, values: { alias: 2 } });
  assert.ok(checks(r).some(([s, c]) => s === 'error' && c === 'noRows'));
  const a = run('productNames', 'TFAK_0020\tz\nTFAK_0010\ta\n', { header: false, id: { column: 1, level: 'gene' }, values: { product: 2 } });
  assert.equal(sha(a.text), sha(run('productNames', 'TFAK_0010\ta\nTFAK_0020\tz\n', { header: false, id: { column: 1, level: 'gene' }, values: { product: 2 } }).text));
});

const row = (type, attrs) => ['chr1', 'x', type, 1, 90, '.', '+', '.', attrs].join('\t');

test('ambiguous IDs get their own error finding, apart from unmatchedIds', () => {
  const gff = [row('protein_coding_gene', 'ID=DUP'), row('mRNA', 'ID=DUP;Parent=DUP'), row('protein_coding_gene', 'ID=OK'), row('mRNA', 'ID=OK.1;Parent=OK'), ''].join('\n');
  const r = run('aliases', 'DUP\tA\nOK\tB\nNOPE\tC\n', { header: false, id: { column: 1, level: 'gene' }, values: { alias: 2 } }, idIndex(gff));
  assert.deepEqual(checks(r), [['error', 'unmatchedIds', 1], ['error', 'ambiguousIds', 1]]);
  assert.deepEqual(r.findings.find((f) => f.check === 'ambiguousIds').sample, ['DUP']);
  assert.deepEqual(r.findings.find((f) => f.check === 'unmatchedIds').sample, ['NOPE']);
  assert.equal(r.text, 'OK.1\tB\n');
});

test('gene children of unclassified types are reported as info', () => {
  const gff = [row('protein_coding_gene', 'ID=G1'), row('mRNA', 'ID=G1.1;Parent=G1'), row('weird_RNA', 'ID=G1.w;Parent=G1'), row('weird_RNA', 'ID=G1.v;Parent=G1'), row('other_RNA', 'ID=G1.o;Parent=G1'), ''].join('\n');
  const r = run('aliases', 'G1\tA\n', { header: false, id: { column: 1, level: 'gene' }, values: { alias: 2 } }, idIndex(gff));
  assert.deepEqual(checks(r), [['info', 'skippedTypes', 3]]);
  assert.deepEqual(r.findings[0].sample, ['weird_RNA: 2', 'other_RNA: 1']);
});

test('columnsProblems names missing value columns, bad numbers and levels', () => {
  assert.deepEqual(columnsProblems('productNames', { header: false, id: { column: 1, level: 'gene' }, values: { product: 2 } }), []);
  assert.deepEqual(columnsProblems('GeneOntologyAssociations', { header: false, id: { column: 0, level: 'exon' }, values: { x: 2 } }), [
    'id.column must be a column number from 1',
    'id.level must be gene, transcript or protein',
    'values.goId is required for GeneOntologyAssociations',
    'values.x is not a column GeneOntologyAssociations reads (goId, aspect, evidence, reference)'
  ]);
  assert.deepEqual(columnsProblems('comments', { header: false, id: { column: 1, level: 'protein' }, values: { comment: 2 } }), ['comments are loaded for gene or transcript IDs, not protein']);
});
