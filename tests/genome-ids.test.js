import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyIdPolicy, idsTsvText, readIdsTsv } from '../shared/scripts/genome/ids.js';
import { parseGff, serializeGff } from '../shared/scripts/genome/gff.js';
import { CM, gffLine, gffText, KZ, TINY_COLLIDING_GFF, TINY_GFF, TINY_IDS_DEFAULT } from './genome-helpers.js';

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

test('readIdsTsv reports a bad header, a bad level, a short line and a repeated old', () => {
  assert.deepEqual(readIdsTsv('old\tnew\n').errors, ['ids.tsv header must be "level\\told\\tnew"']);
  const { entries, errors } = readIdsTsv('level\told\tnew\ngene\tgene-A\tA\nexon\te1\tE1\ngene\tgene-B\ntranscript\tgene-A\tA2\n');
  assert.deepEqual(entries.map((e) => [e.level, e.old, e.new, e.line]), [['gene', 'gene-A', 'A', 2]]);
  assert.deepEqual(errors, [
    'ids.tsv line 3: level must be one of sequence, gene, transcript, protein',
    'ids.tsv line 4: needs level, old and new',
    'ids.tsv line 5: old gene-A is repeated'
  ]);
});

const policyWith = (tsv) => applyIdPolicy(parseGff(TINY_GFF), { policy: 'ncbiDefault', overrides: readIdsTsv(tsv).entries, sequenceIds: [CM, KZ] });

test('ids.tsv errors: an old that is not an input ID at its level, a new taken within its level; nothing changes', () => {
  const graph = parseGff(TINY_GFF);
  const { entries } = readIdsTsv('level\told\tnew\ntranscript\tgene-TST_0010\tX\ngene\tnothing\tY\ngene\tgene-TST_0040\tTST_0020\n');
  const r = applyIdPolicy(graph, { policy: 'ncbiDefault', overrides: entries });
  assert.deepEqual(r.errors, [
    'ids.tsv line 2: transcript gene-TST_0010 is not an input transcript ID (old must be the ID as written in the input GFF)',
    'ids.tsv line 3: gene nothing is not an input gene ID (old must be the ID as written in the input GFF)',
    'ids.tsv line 4: new gene ID TST_0020 is already taken'
  ]);
  assert.equal(r.applied, 0);
  assert.equal(r.graph, graph);
  assert.deepEqual(r.collisions, []);
});

test('a sequence line renames seqIds and sequence-region lines and maps back to the input ID', () => {
  const r = policyWith('level\told\tnew\nsequence\tKZ000002.1\tscaffold2\n');
  assert.deepEqual(r.errors, []);
  assert.equal(r.applied, 1);
  assert.deepEqual([...r.sequenceRenames], [[KZ, 'scaffold2']]);
  assert.equal(r.inputSequenceIdOf.get('scaffold2'), KZ);
  assert.equal(r.inputIdOf.has('scaffold2'), false);
  const text = serializeGff(r.graph);
  assert.match(text, /^##sequence-region scaffold2 1 600$/m);
  assert.match(text, /^scaffold2\tEMBL\tgene\t10\t300\t\.\t\+\t\.\tID=TST_0040;/m);
});

test('sequence line errors: not an input sequence, a new already taken', () => {
  assert.deepEqual(policyWith('level\told\tnew\nsequence\tZZ1\tz\nsequence\tKZ000002.1\tCM000001.1\n').errors, [
    'ids.tsv line 2: sequence ZZ1 is not an input sequence ID (old must be the ID as written in the input GFF or FASTA)',
    'ids.tsv line 3: new sequence ID CM000001.1 is already taken'
  ]);
});

test('whitespace in old or new is an error with the line number', () => {
  assert.deepEqual(readIdsTsv('level\told\tnew\nsequence\tKZ000002.1\tchr 1\ngene\tg a\tG\n').errors, [
    "ids.tsv line 2: new ID 'chr 1' contains whitespace",
    "ids.tsv line 3: old ID 'g a' contains whitespace"
  ]);
});

test('errors echo the written new value, not the encoded one', () => {
  const r = applyIdPolicy(parseGff(TINY_GFF), {
    policy: 'ncbiDefault',
    overrides: readIdsTsv('level\told\tnew\ngene\tgene-TST_0010\ta,b\ngene\tgene-TST_0040\ta,b\n').entries
  });
  assert.deepEqual(r.errors, [
    'ids.tsv line 2: new gene ID a,b is already taken',
    'ids.tsv line 3: new gene ID a,b is already taken'
  ]);
});

test('ids.default.tsv writes new decoded, so a row copies into ids.tsv without double-encoding', () => {
  const graph = parseGff(gffText(gffLine('c', 'gene', 1, 9, '+', 'ID=gene-a;locus_tag=A%2CB')));
  const { defaults, graph: out } = applyIdPolicy(graph, { policy: 'ncbiDefault' });
  assert.match(serializeGff(out), /\tID=A%2CB;/);
  assert.equal(idsTsvText(defaults), 'level\told\tnew\ngene\tgene-a\tA,B\n');
});

test('sequence and feature IDs are separate namespaces in the reverse maps', () => {
  const r = policyWith('level\told\tnew\nsequence\tKZ000002.1\tTST_0010\n');
  assert.deepEqual(r.errors, []);
  assert.equal(r.inputIdOf.get('TST_0010'), 'gene-TST_0010');
  assert.equal(r.inputSequenceIdOf.get('TST_0010'), KZ);
});

test('a multi-value Parent is rewritten value by value', () => {
  const graph = parseGff(gffText(
    gffLine('c', 'gene', 1, 9, '+', 'ID=gene-a'),
    gffLine('c', 'gene', 20, 29, '+', 'ID=gene-b'),
    gffLine('c', 'mRNA', 1, 29, '+', 'ID=rna-m;Parent=gene-a,gene-b')
  ));
  assert.match(serializeGff(applyIdPolicy(graph, { policy: 'ncbiDefault' }).graph), /\tID=m;Parent=a,b\n/);
});

test('CDS segments sharing an ID are one protein row', () => {
  const { defaults } = applyIdPolicy(parseGff(TINY_GFF), { policy: 'ncbiDefault' });
  assert.equal(defaults.filter((d) => d.old === 'cds-PRT1.1').length, 1);
});

test('a CDS without protein_id keeps its ID and gets no row', () => {
  const graph = parseGff(gffText(
    gffLine('c', 'gene', 1, 9, '+', 'ID=gene-a'),
    gffLine('c', 'CDS', 1, 9, '+', 'ID=cds-a;Parent=gene-a')
  ));
  const { defaults, graph: out } = applyIdPolicy(graph, { policy: 'ncbiDefault' });
  assert.deepEqual(defaults.map((d) => d.level), ['gene']);
  assert.match(serializeGff(out), /\tID=cds-a;Parent=a\n/);
});

test('plain IDs need no rows and the graph is unchanged', () => {
  const text = gffText(
    gffLine('c', 'gene', 1, 9, '+', 'ID=G1'),
    gffLine('c', 'mRNA', 1, 9, '+', 'ID=T1;Parent=G1')
  );
  const r = applyIdPolicy(parseGff(text), { policy: 'ncbiDefault' });
  assert.deepEqual(r.defaults, []);
  assert.equal(serializeGff(r.graph), text);
});
