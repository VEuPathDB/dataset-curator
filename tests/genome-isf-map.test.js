import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXPECTED_PREPROCESSOR, isfTrees, readIsfMap } from '../shared/scripts/genome/isf-map.js';
import { parseGff } from '../shared/scripts/genome/gff.js';
import { readText } from '../shared/scripts/genome/workdir.js';
import { byId, genomeFixtures, gffLine, gffText, parseBioperlTree, TINY_GFF, treeShape } from './genome-helpers.js';

const MINI_MAP_XML = readFileSync(join(genomeFixtures, 'isf-map-mini.xml'), 'utf-8');
const ACD = process.env.APICOMMONDATA_DIR;

test('readIsfMap reads features, their qualifiers and the feature-level ignore', () => {
  const map = readIsfMap(MINI_MAP_XML);
  assert.equal(map.preprocessor, EXPECTED_PREPROCESSOR);
  assert.deepEqual([...map.features.keys()], ['coding_gene', 'mRNA', 'tRNA_gene', 'tRNA', 'snRNA_gene', 'snRNA', 'exon', 'three_prime_utr', 'five_prime_UTR']);
  assert.deepEqual([...map.features.get('mRNA').qualifiers], ['ID', 'gbkey', 'pseudo']);
  assert.equal(map.features.get('coding_gene').ignore, false);
  assert.equal(map.features.get('three_prime_utr').ignore, true);
  assert.deepEqual([...map.features.get('five_prime_UTR').qualifiers], []);
  assert.equal(map.features.has('commented_out'), false);
});

test('a map naming another preprocessor is refused; only one is ported', () => {
  const other = MINI_MAP_XML.replace('genemRNAExonCDS2BioperlTree', 'GeneDBBioperlTree');
  assert.throws(() => readIsfMap(other), /names preprocessor ApiCommonData::Load::GeneDBBioperlTree; only ApiCommonData::Load::genemRNAExonCDS2BioperlTree is ported/);
});

test('isfTrees on the raw tiny genome: CDS-only genes and the region are dropped', () => {
  const { trees, dropped } = isfTrees(parseGff(TINY_GFF));
  assert.deepEqual(trees.map((t) => [t.type, t.id]), [['tRNA_gene', 'gene-TST_0030'], ['snRNA_gene', 'rna-CM000001.1:1200..1300']]);
  assert.deepEqual(trees[0].keys, ['ID', 'Name', 'gbkey', 'gene', 'gene_biotype']);
  assert.deepEqual(trees[0].children.map((t) => [t.type, t.id, t.keys]), [['tRNA', 'rna-TST_0030', ['ID', 'Note', 'gbkey', 'product']]]);
  assert.deepEqual(trees[1].keys, ['ID', 'gbkey', 'product']);
  assert.deepEqual(trees[1].children.map((t) => [t.type, t.id, t.keys]), [['snRNA', 'rna-CM000001.1:1200..1300.snRNA', ['ID']]]);
  assert.deepEqual(dropped.map((d) => [d.type, d.id]), [
    ['region', 'CM000001.1:1..2000'], ['gene', 'gene-TST_0010'], ['gene', 'gene-TST_0020'], ['gene', 'gene-TST_0020'], ['gene', 'gene-TST_0040']
  ]);
});

test('isfTrees renames gene types from their transcripts, and makes childless pseudo genes pseudogenes', () => {
  const graph = parseGff(gffText(
    gffLine('c', 'gene', 1, 100, '+', 'ID=g1'),
    gffLine('c', 'mRNA', 1, 120, '+', 'ID=t1;Parent=g1'),
    gffLine('c', 'exon', 1, 120, '+', 'ID=e1;Parent=t1'),
    gffLine('c', 'gene', 200, 300, '+', 'ID=g2'),
    gffLine('c', 'transcript', 200, 300, '+', 'ID=t2;Parent=g2;gbkey=misc_RNA'),
    gffLine('c', 'gene', 400, 500, '-', 'ID=g3;Note=putative pseudogene'),
    gffLine('c', 'gap', 600, 700, '+', 'ID=gap1;estimated_length=101')
  ));
  const { trees, dropped } = isfTrees(graph);
  assert.deepEqual(trees.map((t) => [t.type, t.id, t.children.map((c) => c.type)]), [
    ['coding_gene', 'g1', ['mRNA']], ['misc_RNA_gene', 'g2', ['misc_RNA']], ['pseudogene', 'g3', ['pseudogenic_transcript']], ['gap', 'gap1', []]
  ]);
  assert.deepEqual([trees[0].start, trees[0].end], [1, 120]);
  assert.deepEqual(trees[1].children[0].children.map((e) => [e.type, e.start, e.end]), [['exon', 200, 300]]);
  assert.equal(trees[2].children[0].id, 'g3.mRNA');
  assert.deepEqual(trees[2].keys, ['ID', 'Note', 'pseudo']);
  assert.deepEqual(dropped, []);
});

test('isfTrees reproduces ISF\'s own bioperltree.out for the spike\'s input on chromosomes X and XI', () => {
  const graph = parseGff(readText(join(genomeFixtures, 'ecun/isf/isf-input.gff3.gz')));
  const expected = parseBioperlTree(readText(join(genomeFixtures, 'ecun/isf/bioperltree.out.gz'))).map(treeShape).sort(byId);
  const { trees, dropped } = isfTrees(graph);
  assert.equal(expected.length, 440);
  assert.deepEqual(trees.map(treeShape).sort(byId), expected);
  assert.deepEqual(dropped.map((d) => d.type), ['region', 'SRP_RNA', 'region', 'RNase_MRP_RNA']);
});

test('the real ApiCommonData map parses', { skip: !ACD && 'APICOMMONDATA_DIR is not set; point it at an ApiCommonData checkout' }, () => {
  const map = readIsfMap(readFileSync(join(ACD, 'Load/lib/xml/isf/genemRNAExonCDS2Gus.xml'), 'utf-8'));
  assert.ok(map.features.size >= 60, `only ${map.features.size} features`);
  assert.deepEqual([...map.features.get('gap').qualifiers], ['ID', 'estimated_length', 'gap_type']);
  assert.equal(map.features.get('coding_gene').qualifiers.has('is_ordered'), false);
});
