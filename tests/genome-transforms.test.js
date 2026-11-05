import { test } from 'node:test';
import assert from 'node:assert/strict';
import { features, idOf, parseGff, serializeGff } from '../shared/scripts/genome/gff.js';
import { applyIdPolicy } from '../shared/scripts/genome/ids.js';
import { addMrnaToGeneCds } from '../shared/scripts/genome/transforms/add-mrna-to-gene-cds.js';
import { addExonPerCds } from '../shared/scripts/genome/transforms/add-exon-per-cds.js';
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

const settled = () => applyIdPolicy(collapseSplitGenes(parseGff(TINY_GFF)).graph, { policy: 'ncbiDefault' }).graph;

test('addMrnaToGeneCds gives a CDS-only gene an mRNA and moves its CDSs under it', () => {
  const { graph, changes } = addMrnaToGeneCds(settled());
  assert.deepEqual(changes, [
    { id: 'TST_0010', created: ['TST_0010_mRNA'], from: { level: 'gene', id: 'TST_0010' } },
    { id: 'TST_0020', created: ['TST_0020_mRNA'], from: { level: 'gene', id: 'TST_0020' } },
    { id: 'TST_0040', created: ['TST_0040_mRNA'], from: { level: 'gene', id: 'TST_0040' } }
  ]);
  const text = serializeGff(graph);
  assert.match(text, /\tgene\t100\t400\t[^\n]*\nCM000001\.1\tEMBL\tmRNA\t100\t400\t\.\t\+\t\.\tID=TST_0010_mRNA;Parent=TST_0010\n/);
  assert.match(text, /\tCDS\t100\t200\t\.\t\+\t0\tID=PRT1\.1;Parent=TST_0010_mRNA;/);
  assert.match(text, /\tmRNA\t500\t900\t\.\t-\t\.\tID=TST_0020_mRNA;Parent=TST_0020\n/);
});

test('addMrnaToGeneCds leaves genes that already have an RNA', () => {
  const graph = parseGff(gffText(gffLine('c', 'gene', 1, 9, '+', 'ID=g'), gffLine('c', 'tRNA', 1, 9, '+', 'ID=t;Parent=g')));
  assert.deepEqual(addMrnaToGeneCds(graph).changes, []);
});

test('addMrnaToGeneCds refuses a created ID that already exists', () => {
  const graph = parseGff(gffText(gffLine('c', 'gene', 1, 9, '+', 'ID=g'), gffLine('c', 'CDS', 1, 9, '+', 'ID=c;Parent=g'), gffLine('c', 'gene', 20, 29, '+', 'ID=g_mRNA')));
  assert.throws(() => addMrnaToGeneCds(graph), (e) => e.code === 'ID_COLLISION' && /addMrnaToGeneCds: created ID g_mRNA \(for g\) already exists/.test(e.message));
});

test('addExonPerCds adds one exon per CDS segment, numbered 5′ to 3′', () => {
  const { graph, changes } = addExonPerCds(addMrnaToGeneCds(settled()).graph);
  assert.deepEqual(changes, [
    { id: 'TST_0010_mRNA', created: ['TST_0010_mRNA_exon1', 'TST_0010_mRNA_exon2'], from: { level: 'transcript', id: 'TST_0010_mRNA' } },
    { id: 'TST_0020_mRNA', created: ['TST_0020_mRNA_exon1', 'TST_0020_mRNA_exon2'], from: { level: 'transcript', id: 'TST_0020_mRNA' } },
    { id: 'TST_0040_mRNA', created: ['TST_0040_mRNA_exon1'], from: { level: 'transcript', id: 'TST_0040_mRNA' } }
  ]);
  const minus = features(graph).filter((f) => f.type === 'exon' && idOf(f).startsWith('TST_0020'));
  assert.deepEqual(minus.map((f) => [idOf(f), f.start, f.end]), [['TST_0020_mRNA_exon1', 800, 900], ['TST_0020_mRNA_exon2', 500, 700]]);
  assert.match(serializeGff(graph), /ID=TST_0010_mRNA;Parent=TST_0010\nCM000001\.1\tEMBL\texon\t100\t200\t\.\t\+\t\.\tID=TST_0010_mRNA_exon1;Parent=TST_0010_mRNA\n/);
});

test('addExonPerCds skips transcripts that have exons or no CDS', () => {
  assert.deepEqual(addExonPerCds(settled()).changes, []);
});
