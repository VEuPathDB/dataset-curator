import { test } from 'node:test';
import assert from 'node:assert/strict';
import { features, idOf, parseGff, serializeGff } from '../shared/scripts/genome/gff.js';
import { claimIds } from '../shared/scripts/genome/transforms/claim-ids.js';
import { collapseSplitGenes } from '../shared/scripts/genome/transforms/collapse-split-genes.js';
import { stripAttributes, stripAttributesProblems } from '../shared/scripts/genome/transforms/strip-attributes.js';
import { gffLine, gffText, TINY_GFF } from './genome-helpers.js';

test('claimIds refuses an ID that exists or was already claimed', () => {
  const claim = claimIds(parseGff(gffText(gffLine('c', 'gene', 1, 9, '+', 'ID=a'))), 'someTransform');
  assert.throws(() => claim('a', 'x'), (e) => e.code === 'ID_COLLISION' && e.id === 'a' && e.source === 'x' && e.message === 'someTransform: created ID a (for x) already exists');
  assert.equal(claim('b', 'x'), 'b');
  assert.throws(() => claim('b', 'y'), /created ID b \(for y\) already exists/);
});

test('collapseSplitGenes makes one gene line spanning the lines it replaces', () => {
  const graph = parseGff(TINY_GFF);
  const { graph: out, changes } = collapseSplitGenes(graph);
  assert.deepEqual(changes, [{ id: 'gene-TST_0020', removedLines: 1 }]);
  assert.deepEqual(features(out).filter((f) => idOf(f) === 'gene-TST_0020').map((f) => [f.start, f.end, f.strand]), [[500, 900, '-']]);
  assert.equal(features(graph).filter((f) => idOf(f) === 'gene-TST_0020').length, 2);
});

test('collapseSplitGenes refuses gene lines on different strands', () => {
  const graph = parseGff(gffText(gffLine('c', 'gene', 1, 9, '+', 'ID=g'), gffLine('c', 'gene', 20, 29, '-', 'ID=g')));
  assert.throws(() => collapseSplitGenes(graph), (e) => e.code === 'SPLIT_ACROSS' && /collapseSplitGenes: gene g has lines on different sequences or strands/.test(e.message));
});

test('collapseSplitGenes changes nothing without split genes', () => {
  assert.deepEqual(collapseSplitGenes(parseGff(gffText(gffLine('c', 'gene', 1, 9, '+', 'ID=g')))).changes, []);
});

test('stripAttributes removes keys from features of one type', () => {
  const { graph, changes } = stripAttributes(parseGff(TINY_GFF), { type: 'gene', keys: ['is_ordered'] });
  assert.deepEqual(changes, [{ id: 'gene-TST_0020' }]);
  assert.doesNotMatch(serializeGff(graph), /is_ordered/);
  assert.match(TINY_GFF, /is_ordered/);
  assert.deepEqual(stripAttributes(parseGff(TINY_GFF), { type: 'gap', keys: ['gbkey'] }).changes, []);
});

test('stripAttributesProblems checks type and keys', () => {
  assert.deepEqual(stripAttributesProblems({ type: 'gene', keys: ['is_ordered'] }), []);
  assert.deepEqual(stripAttributesProblems({}), ['args.type must be a feature type', 'args.keys must be a non-empty list of attribute keys']);
  assert.deepEqual(stripAttributesProblems({ type: 'gene', keys: ['ID'], extra: 1 }), ['args.keys must not include ID or Parent', 'unknown args: extra']);
});
