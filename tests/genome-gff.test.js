import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import {
  decode, deleteAttrs, featureGroups, features, getValues, idOf, indexGraph, newFeature, parentsOf,
  parseGff, renameIds, renameSequences, serializeGff, setAttr, subsetGff, withInsertions, withoutFeatures
} from '../shared/scripts/genome/gff.js';
import { levelOf } from '../shared/scripts/genome/feature-types.js';
import { ECUN_GFF, genomeFixtures, gffLine, gffText, TINY_GFF } from './genome-helpers.js';

test('parse then serialize is byte-identical for NCBI escaping, multi-value attributes and comments', () => {
  const text = [
    '##gff-version 3',
    '#!processor NCBI annotwriter',
    gffLine('chr1', 'CDS', 1, 9, '+', 'ID=cds-1;Parent=gene-1;Dbxref=GOA:Q1,InterPro:IPR1;Note=a%2C b%3B c%3D d;product=x'),
    gffLine('chr1', 'gene', 1, 9, '+', 'ID=gene-1;isFminPartial;partial=true;'),
    'chr1\tEMBL\tregion\t1\t100\t.\t+\t.\t.',
    '',
    '###'
  ].join('\n');
  assert.equal(serializeGff(parseGff(text)), text);
  assert.equal(serializeGff(parseGff(`${text}\n`)), `${text}\n`);
});

test('the E. cuniculi fixture GFFs round-trip byte for byte', () => {
  for (const path of [ECUN_GFF, join(genomeFixtures, 'ecun/isf/isf-input.gff3.gz')]) {
    const text = gunzipSync(readFileSync(path)).toString('utf-8');
    assert.equal(serializeGff(parseGff(text)), text);
  }
});

test('a line without nine columns is refused with its line number', () => {
  assert.throws(() => parseGff('##gff-version 3\nchr1\tEMBL\tgene\n'), /GFF line 2 has 3 tab-separated columns, not 9/);
});

test('attribute helpers read raw values and decode on request', () => {
  const [cds] = features(parseGff(TINY_GFF)).filter((f) => f.type === 'CDS');
  assert.equal(idOf(cds), 'cds-PRT1.1');
  assert.deepEqual(parentsOf(cds), ['gene-TST_0010']);
  assert.deepEqual(getValues(cds, 'Dbxref'), ['NCBI_GP:PRT1.1', 'UniProtKB/TrEMBL:Q00001']);
  assert.equal(decode('tRNA-Leu%2C anticodon TAG'), 'tRNA-Leu, anticodon TAG');
});

test('setAttr puts a new Parent right after ID; deleteAttrs reports a change', () => {
  const [snRNA] = features(parseGff(TINY_GFF)).filter((f) => f.type === 'snRNA');
  setAttr(snRNA, 'Parent', 'g1');
  assert.deepEqual(snRNA.attrs.map(([k]) => k), ['ID', 'Parent', 'gbkey', 'product']);
  setAttr(snRNA, 'note', 'x');
  assert.deepEqual(snRNA.attrs.at(-1), ['note', 'x']);
  assert.equal(deleteAttrs(snRNA, ['gbkey', 'absent']), true);
  assert.equal(deleteAttrs(snRNA, ['absent']), false);
});

test('featureGroups joins the lines of one feature and keeps file order', () => {
  const groups = featureGroups(parseGff(TINY_GFF));
  assert.equal(groups.find((g) => g.id === 'gene-TST_0020').lines.length, 2);
  assert.equal(groups.find((g) => g.id === 'cds-PRT1.1').lines.length, 2);
  assert.deepEqual(groups.slice(0, 3).map((g) => g.id), ['CM000001.1:1..2000', 'gene-TST_0010', 'cds-PRT1.1']);
});

test('renameIds moves IDs and every Parent; renameSequences moves seqIds and sequence-region lines', () => {
  const graph = parseGff(TINY_GFF);
  renameIds(graph, new Map([['gene-TST_0010', 'TST_0010']]));
  renameSequences(graph, new Map([['KZ000002.1', 'scaffold2']]));
  const text = serializeGff(graph);
  assert.match(text, /\tID=TST_0010;Name=TST_0010;/);
  assert.match(text, /ID=cds-PRT1\.1;Parent=TST_0010;/);
  assert.match(text, /^##sequence-region scaffold2 1 600$/m);
  assert.match(text, /^scaffold2\tEMBL\tgene\t10\t300\t/m);
});

test('withInsertions and withoutFeatures return new graphs in one pass', () => {
  const graph = parseGff(gffText(gffLine('c', 'gene', 1, 9, '+', 'ID=g'), gffLine('c', 'CDS', 1, 9, '+', 'ID=c;Parent=g')));
  const [gene, cds] = features(graph);
  const mrna = newFeature({ seqId: 'c', source: 'EMBL', type: 'mRNA', start: 1, end: 9, strand: '+', attrs: [['ID', 'm'], ['Parent', 'g']] });
  const grown = withInsertions(graph, { after: new Map([[gene, [mrna]]]) });
  assert.deepEqual(features(grown).map((f) => f.type), ['gene', 'mRNA', 'CDS']);
  assert.match(serializeGff(grown), /\tmRNA\t1\t9\t\.\t\+\t\.\tID=m;Parent=g\n/);
  assert.deepEqual(features(withInsertions(graph, { before: new Map([[gene, [mrna]]]) })).map((f) => f.type), ['mRNA', 'gene', 'CDS']);
  assert.deepEqual(features(withoutFeatures(grown, new Set([cds]))).map((f) => f.type), ['gene', 'mRNA']);
  assert.equal(features(graph).length, 2);
});

test('indexGraph finds children by parent ID', () => {
  const { childrenOf } = indexGraph(parseGff(TINY_GFF));
  assert.deepEqual(childrenOf('gene-TST_0020').map((f) => f.start), [800, 500]);
  assert.deepEqual(childrenOf('nothing'), []);
});

test('subsetGff keeps the header, the chosen sequences and their sequence-region blocks', () => {
  const kz = TINY_GFF.split('\n').filter((l) => l.startsWith('KZ000002.1'));
  assert.equal(serializeGff(subsetGff(parseGff(TINY_GFF), new Set(['KZ000002.1']))),
    ['##gff-version 3', '##sequence-region KZ000002.1 1 600', ...kz, '###', ''].join('\n'));
});

test('levelOf sorts types into gene, transcript and protein', () => {
  assert.equal(levelOf('gene'), 'gene');
  assert.equal(levelOf('pseudogene'), 'gene');
  assert.equal(levelOf('mRNA'), 'transcript');
  assert.equal(levelOf('ribozyme'), 'transcript');
  assert.equal(levelOf('CDS'), 'protein');
  assert.equal(levelOf('exon'), null);
});
