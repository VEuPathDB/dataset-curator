import { test } from 'node:test';
import assert from 'node:assert/strict';
import { featureTypesOf, maxIntronOf } from '../shared/scripts/genome/partition-shape.js';
import { parseGff } from '../shared/scripts/genome/gff.js';
import { gffLine } from './genome-helpers.js';

test('featureTypesOf counts column 3 of feature lines in either attribute syntax, sorted by type', () => {
  const text = [
    '##gff-version 3',
    'c\tE\tgene\t1\t9\t.\t+\t.\tID "g1";',
    'c\tE\tmRNA\t1\t9\t.\t+\t.\tID=m1;Parent=g1',
    'c\tE\texon\t1\t3\t.\t+\t.\tParent=m1',
    'c\tE\texon\t7\t9\t.\t+\t.\tParent=m1',
    ''
  ].join('\n');
  assert.deepEqual(featureTypesOf(text), { exon: 2, gene: 1, mRNA: 1 });
  assert.deepEqual(Object.keys(featureTypesOf(text)), ['exon', 'gene', 'mRNA']);
  assert.deepEqual(featureTypesOf(''), {});
});

test('maxIntronOf takes the longest gap between consecutive exons of one parent, in any line order', () => {
  const gff = [
    gffLine('c', 'exon', 500, 600, '-', 'ID=e2;Parent=t1'),
    gffLine('c', 'exon', 100, 200, '-', 'ID=e1;Parent=t1'),
    gffLine('c', 'exon', 1000, 1100, '+', 'ID=e3;Parent=t2'),
    gffLine('c', 'exon', 1150, 1200, '+', 'ID=e4;Parent=t2'),
    gffLine('c', 'CDS', 100, 1200, '+', 'ID=p1;Parent=t2')
  ].join('\n') + '\n';
  assert.equal(maxIntronOf(parseGff(gff)), 299);
  assert.equal(maxIntronOf(parseGff(`${gffLine('c', 'exon', 1, 9, '+', 'ID=e;Parent=t')}\n`)), 0);
});
