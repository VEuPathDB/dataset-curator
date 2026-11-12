import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileText, gafLine, productRows, uniqueSorted } from '../shared/scripts/genome/functional/writers.js';

test('uniqueSorted drops repeated rows and orders by code unit, ID first', () => {
  assert.deepEqual(uniqueSorted([['b', 'x'], ['a', 'z'], ['b', 'x'], ['a', 'Z'], ['B', 'y']]), [['B', 'y'], ['a', 'Z'], ['a', 'z'], ['b', 'x']]);
});

test('productRows marks each transcript\'s first product preferred, then sorts', () => {
  const { rows, byTranscript } = productRows([['t2', 'b'], ['t1', 'a'], ['t2', 'a'], ['t2', 'b']]);
  assert.deepEqual(rows, [['t1', 'a', '1'], ['t2', 'a', '0'], ['t2', 'b', '1']]);
  assert.deepEqual([...byTranscript], [['t2', ['b', 'a']], ['t1', ['a']]]);
});

test('gafLine and fileText write a GAF line per row', () => {
  const ctx = { source: 'VEuPathDB', taxonId: '5833', date: '20261103' };
  assert.equal(gafLine(['t1', 'GO:0005524', '', 'IEA', 'F'], ctx).join('\t'),
    'VEuPathDB\tt1\tt1\t\tGO:0005524\t\tIEA\t\tF\t\t\ttranscript\ttaxon:5833\t20261103\tVEuPathDB\t\t');
  assert.equal(fileText({ rows: [['a', 'x']], format: null }, ctx), 'a\tx\n');
  assert.deepEqual(uniqueSorted([['b'], ['a'], ['b']]), [['a'], ['b']]);
});
