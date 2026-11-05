import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import {
  cloneGraph, decode, deleteAttrs, encode, featureGroups, features, getValues, idOf, indexGraph, newFeature, parentsOf,
  parseGff, renameIds, renameSequences, serializeGff, setRawAttr, subsetGff, withInsertions, withoutFeatures
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

test('setRawAttr puts a new Parent right after ID; deleteAttrs reports a change', () => {
  const [snRNA] = features(parseGff(TINY_GFF)).filter((f) => f.type === 'snRNA');
  setRawAttr(snRNA, 'Parent', 'g1');
  assert.deepEqual(snRNA.attrs.map(([k]) => k), ['ID', 'Parent', 'gbkey', 'product']);
  setRawAttr(snRNA, 'note', 'x');
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

test('encode escapes the GFF3 reserved characters so a value cannot split into several', () => {
  assert.equal(encode('a,b;c=d&e%f\tg\nh\ri\u0001'), 'a%2Cb%3Bc%3Dd%26e%25f%09g%0Ah%0Di%01');
  const graph = parseGff(gffText(gffLine('c', 'mRNA', 1, 9, '+', 'ID=m;Parent=g')));
  assert.equal(encode('x,y'), 'x%2Cy');
  renameIds(graph, new Map([['g', 'x%2Cy']]));
  assert.deepEqual(parentsOf(features(graph)[0]), ['x%2Cy']);
  setRawAttr(features(graph)[0], 'note', encode('a;b'));
  assert.equal(getValues(features(graph)[0], 'note')[0], 'a%3Bb');
});

test('decode reads runs of percent-encoded bytes as UTF-8 and leaves malformed runs alone', () => {
  assert.equal(decode('caf%C3%A9'), 'café');
  assert.equal(decode('a%2Cb'), 'a,b');
  assert.equal(decode('bad%C3x'), 'bad%C3x');
});

test('parseGff refuses CRLF, embedded FASTA and bad coordinates, naming the line', () => {
  assert.throws(() => parseGff('##gff-version 3\r\n'), /GFF line 1 ends in CR; convert to LF/);
  assert.throws(() => parseGff('##gff-version 3\n##FASTA\n>c\nACGT\n'), /embedded FASTA in GFF \(line 2\) is not supported/);
  assert.throws(() => parseGff('c\tEMBL\tgene\tx\t9\t.\t+\t.\tID=g\n'), /GFF line 1 has a start that is not a non-negative integer/);
  assert.throws(() => parseGff('c\tEMBL\tgene\t1\t-9\t.\t+\t.\tID=g\n'), /GFF line 1 has a end/);
});

test('coordinates written with leading zeros round-trip until they change', () => {
  const text = 'c\tEMBL\tgene\t007\t9\t.\t+\t.\tID=g\n';
  const graph = parseGff(text);
  assert.equal(serializeGff(graph), text);
  features(graph)[0].start = 8;
  assert.match(serializeGff(graph), /\tgene\t8\t9\t/);
});

test('renameSequences rewrites only the seqId field of a sequence-region line and ignores $ patterns', () => {
  const graph = parseGff('##sequence-region c1 1 1\n##sequence-region 1 1 1\n');
  renameSequences(graph, new Map([['1', 'x$&y'], ['c1', 'c']]));
  assert.equal(serializeGff(graph), '##sequence-region c 1 1\n##sequence-region x$&y 1 1\n');
});

test('cloneGraph copies lines and attrs so edits do not reach the original', () => {
  const graph = parseGff(TINY_GFF);
  const copy = cloneGraph(graph);
  assert.equal(serializeGff(copy), TINY_GFF);
  setRawAttr(features(copy)[0], 'note', 'x');
  features(copy)[1].start = 1;
  assert.equal(serializeGff(graph), TINY_GFF);
  assert.notEqual(serializeGff(copy), TINY_GFF);
});

test('levelOf sorts types into gene, transcript and protein', () => {
  assert.equal(levelOf('gene'), 'gene');
  assert.equal(levelOf('pseudogene'), 'gene');
  assert.equal(levelOf('mRNA'), 'transcript');
  assert.equal(levelOf('ribozyme'), 'transcript');
  assert.equal(levelOf('CDS'), 'protein');
  assert.equal(levelOf('exon'), null);
});
