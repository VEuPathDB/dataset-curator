import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyIdPolicy, idsTsvText, readIdsTsv } from '../shared/scripts/genome/ids.js';
import { parseGff, serializeGff } from '../shared/scripts/genome/gff.js';
import { gffLine, gffText, TINY_COLLIDING_GFF, TINY_GFF, TINY_IDS_DEFAULT } from './genome-helpers.js';

test('ncbiDefault: genes without gene-, proteins by protein_id, non-mRNA transcripts unchanged; every Parent follows', () => {
  const { graph, defaults, collisions, applied, inputIdOf } = applyIdPolicy(parseGff(TINY_GFF), { policy: 'ncbiDefault' });
  assert.deepEqual(collisions, []);
  assert.equal(applied, 0);
  assert.equal(idsTsvText(defaults), TINY_IDS_DEFAULT);
  assert.equal(inputIdOf.get('TST_0010'), 'gene-TST_0010');
  const text = serializeGff(graph);
  assert.match(text, /\tID=PRT1\.1;Parent=TST_0010;/);
  assert.match(text, /\tID=rna-TST_0030;Parent=TST_0030;/);
  assert.match(text, /\tID=exon-TST_0030-1;Parent=rna-TST_0030;/);
  assert.match(text, /\tID=rna-CM000001\.1:1200\.\.1300;gbkey=ncRNA;/);
  assert.match(TINY_GFF, /ID=gene-TST_0010;/);
});

test('a locus_tag wins over the gene- ID; an mRNA loses rna-, a tRNA keeps it', () => {
  const graph = parseGff(gffText(
    gffLine('c', 'gene', 1, 9, '+', 'ID=gene-abc;locus_tag=ABC_0001'),
    gffLine('c', 'mRNA', 1, 9, '+', 'ID=rna-XM_000001.1;Parent=gene-abc'),
    gffLine('c', 'CDS', 1, 9, '+', 'ID=cds-X1;Parent=rna-XM_000001.1;protein_id=X1.1'),
    gffLine('c', 'gene', 20, 29, '+', 'ID=gene-t1'),
    gffLine('c', 'tRNA', 20, 29, '+', 'ID=rna-t1;Parent=gene-t1')
  ));
  assert.equal(serializeGff(applyIdPolicy(graph, { policy: 'ncbiDefault' }).graph), gffText(
    gffLine('c', 'gene', 1, 9, '+', 'ID=ABC_0001;locus_tag=ABC_0001'),
    gffLine('c', 'mRNA', 1, 9, '+', 'ID=XM_000001.1;Parent=ABC_0001'),
    gffLine('c', 'CDS', 1, 9, '+', 'ID=X1.1;Parent=XM_000001.1;protein_id=X1.1'),
    gffLine('c', 'gene', 20, 29, '+', 'ID=t1'),
    gffLine('c', 'tRNA', 20, 29, '+', 'ID=rna-t1;Parent=t1')
  ));
});

test('none leaves IDs alone and writes no defaults', () => {
  const r = applyIdPolicy(parseGff(TINY_GFF), { policy: 'none' });
  assert.equal(serializeGff(r.graph), TINY_GFF);
  assert.equal(idsTsvText(r.defaults), 'level\told\tnew\n');
});

test('two features resolving to one ID are a collision naming both', () => {
  const { collisions } = applyIdPolicy(parseGff(TINY_COLLIDING_GFF), { policy: 'ncbiDefault' });
  assert.deepEqual(collisions, [{ id: 'TST_0050', olds: [{ id: 'gene-TST_0050', level: 'gene', type: 'gene' }, { id: 'rna-TST_0050', level: 'transcript', type: 'mRNA' }] }]);
});

test('an ids.tsv line keyed by an input ID settles the collision inside the policy pass', () => {
  const { entries } = readIdsTsv('level\told\tnew\ntranscript\trna-TST_0050\tTST_0050.1\n');
  const r = applyIdPolicy(parseGff(TINY_COLLIDING_GFF), { policy: 'ncbiDefault', overrides: entries });
  assert.deepEqual(r.collisions, []);
  assert.equal(r.applied, 1);
  const text = serializeGff(r.graph);
  assert.match(text, /\tmRNA\t1400\t1500\t\.\t\+\t\.\tID=TST_0050\.1;Parent=TST_0050;gbkey=mRNA\n/);
  assert.match(text, /\tID=PRT5\.1;Parent=TST_0050\.1;/);
  assert.equal(r.inputIdOf.get('TST_0050.1'), 'rna-TST_0050');
  assert.ok(r.defaults.some((d) => d.old === 'rna-TST_0050' && d.new === 'TST_0050'));
});

test('an unknown policy is refused', () => {
  assert.throws(() => applyIdPolicy(parseGff(TINY_GFF), { policy: 'veupathdb' }), /idPolicy must be one of ncbiDefault, none/);
});

test('an ids.tsv new value is human text and is stored encoded', () => {
  const { entries } = readIdsTsv('level\told\tnew\ngene\tgene-A\ta,b\n');
  assert.equal(entries[0].new, 'a%2Cb');
});
