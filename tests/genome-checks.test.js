import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseAssemblyReport } from '../shared/scripts/genome/assembly-report.js';
import { collisionFinding, formatFinding, runChecks } from '../shared/scripts/genome/checks.js';
import { parseGff } from '../shared/scripts/genome/gff.js';
import { applyIdPolicy } from '../shared/scripts/genome/ids.js';
import { readIsfMap } from '../shared/scripts/genome/isf-map.js';
import { planPartitions } from '../shared/scripts/genome/partitions.js';
import { runTransforms } from '../shared/scripts/genome/transforms/index.js';
import { CM, genomeFixtures, gffLine, gffText, KZ, TINY_GFF, TINY_REPORT } from './genome-helpers.js';

const MINI_MAP = readIsfMap(readFileSync(join(genomeFixtures, 'isf-map-mini.xml'), 'utf-8'));
const TINY_PLAN = planPartitions({ sequenceIds: [CM, KZ], report: parseAssemblyReport(TINY_REPORT) });
const NO_PLAN = { partitions: [], problems: [] };
const tiny = (graph, extra = {}) => runChecks({ graph, isfMap: MINI_MAP, fastaIds: new Set([CM, KZ]), plan: TINY_PLAN, ...extra });
const small = (gff, extra = {}) => runChecks({ graph: parseGff(gff), isfMap: MINI_MAP, fastaIds: new Set(['c']), plan: NO_PLAN, ...extra });
const find = (findings, check) => findings.find((f) => f.check === check);
const STRUCTURAL = [{ name: 'collapseSplitGenes' }, { name: 'addMrnaToGeneCds' }, { name: 'parentOrphanRnas' }, { name: 'addExonPerCds' }];

test('the raw tiny genome: structure errors, dropped features, partition counts', () => {
  const f = tiny(parseGff(TINY_GFF));
  assert.deepEqual(f.map((x) => [x.group, x.check, x.severity, x.count]), [
    ['structure', 'geneCdsNoRna', 'error', 3],
    ['structure', 'repeatedGeneLines', 'error', 1],
    ['structure', 'parentlessRna', 'error', 1],
    ['structure', 'unhandledType', 'warning', 5],
    ['sequences', 'partitionCounts', 'info', 2]
  ]);
  assert.deepEqual(find(f, 'geneCdsNoRna').sample, ['gene-TST_0010', 'gene-TST_0020', 'gene-TST_0040']);
  assert.deepEqual(find(f, 'geneCdsNoRna').fix, { transforms: [{ name: 'addMrnaToGeneCds' }, { name: 'addExonPerCds' }] });
  assert.deepEqual(find(f, 'repeatedGeneLines').fix, { transforms: [{ name: 'collapseSplitGenes' }] });
  assert.deepEqual(find(f, 'parentlessRna').sample, ['rna-CM000001.1:1200..1300']);
  assert.equal(find(f, 'unhandledType').message, 'ISF drops these features: region 1, gene 4');
  assert.equal(find(f, 'partitionCounts').message, 'primary_chromosome: 1, secondary_supercontig: 1');
});

test('after the policy and structural transforms only an unmapped key remains, with its strip', () => {
  const policy = applyIdPolicy(parseGff(TINY_GFF), { policy: 'ncbiDefault' });
  const run = runTransforms(policy.graph, STRUCTURAL);
  const f = tiny(run.graph, { synthesized: run.created, inputIdOf: policy.inputIdOf, inputSequenceIdOf: policy.inputSequenceIdOf });
  assert.deepEqual(f.map((x) => x.check), ['unhandledType', 'attributeNotInMap', 'partitionCounts']);
  assert.deepEqual(find(f, 'attributeNotInMap'), {
    group: 'attributes', check: 'attributeNotInMap', severity: 'error', count: 1, sample: ['TST_0020'],
    message: 'gene (ISF coding_gene) carries keys the map does not list: is_ordered',
    fix: { transforms: [{ name: 'stripAttributes', args: { type: 'gene', keys: ['is_ordered'] } }] }
  });
});

test('Dbxref and previous_systematic_id are allowed on any mapped feature', () => {
  const f = small(gffText(
    gffLine('c', 'gene', 1, 9, '+', 'ID=g;Dbxref=x;previous_systematic_id=y;foo=1'),
    gffLine('c', 'mRNA', 1, 9, '+', 'ID=t;Parent=g'),
    gffLine('c', 'exon', 1, 9, '+', 'ID=e;Parent=t')
  ));
  assert.equal(find(f, 'attributeNotInMap').message, 'gene (ISF coding_gene) carries keys the map does not list: foo');
});

test('ISF types the map lacks are dropped features too', () => {
  const f = small(gffText(gffLine('c', 'gene', 1, 9, '+', 'ID=g'), gffLine('c', 'ncRNA', 1, 9, '+', 'ID=t;Parent=g'), gffLine('c', 'exon', 1, 9, '+', 'ID=e;Parent=t')));
  assert.equal(find(f, 'unhandledType').message, 'ISF drops these features: ncRNA_gene (not in the map) 1, ncRNA (not in the map) 1');
  assert.deepEqual(find(f, 'unhandledType').sample, ['g', 't']);
});

test('transcript with CDS and no exons; gene with no children', () => {
  const f = small(gffText(gffLine('c', 'gene', 1, 9, '+', 'ID=g'), gffLine('c', 'mRNA', 1, 9, '+', 'ID=t;Parent=g'), gffLine('c', 'CDS', 1, 9, '+', 'ID=p;Parent=t'), gffLine('c', 'gene', 20, 29, '+', 'ID=lonely')));
  assert.deepEqual(find(f, 'transcriptCdsNoExon').sample, ['t']);
  assert.deepEqual(find(f, 'childlessGene'), { group: 'structure', check: 'childlessGene', severity: 'warning', count: 1, sample: ['lonely'], message: 'genes with no children; ISF drops them', fix: null });
});

test('a gene or RNA line with no ID is an error labelled by position', () => {
  const f = small(gffText(
    gffLine('c', 'gene', 1, 30, '+', 'ID=g'), gffLine('c', 'mRNA', 1, 30, '+', 'Parent=g'),
    gffLine('c', 'gene', 40, 60, '+', 'Name=anonymous'), gffLine('c', 'exon', 1, 30, '+', 'ID=e;Parent=g')
  ));
  const missing = find(f, 'missingId');
  assert.equal(missing.severity, 'error');
  assert.deepEqual(missing.sample, ['c:40..60', 'c:1..30']);
  assert.equal(missing.fix, null);
});

test('gene, transcript and exons on different strands are an error', () => {
  const f = small(gffText(
    gffLine('c', 'gene', 1, 30, '+', 'ID=g'), gffLine('c', 'mRNA', 1, 30, '+', 'ID=t;Parent=g'), gffLine('c', 'exon', 1, 30, '-', 'ID=e;Parent=t'),
    gffLine('c', 'gene', 100, 130, '-', 'ID=ok'), gffLine('c', 'mRNA', 100, 130, '-', 'ID=t2;Parent=ok'), gffLine('c', 'exon', 100, 130, '-', 'ID=e2;Parent=t2'),
    gffLine('c', 'gene', 200, 230, '+', 'ID=g3'), gffLine('c', 'mRNA', 200, 230, '-', 'ID=t3;Parent=g3'), gffLine('c', 'exon', 200, 230, '-', 'ID=e3;Parent=t3')
  ));
  const bad = find(f, 'strandMismatch');
  assert.equal(bad.severity, 'error');
  assert.deepEqual(bad.sample, ['g', 'g3']);
});

test('a CDS segment outside every exon of its transcript is an error', () => {
  const f = small(gffText(
    gffLine('c', 'gene', 1, 90, '+', 'ID=g'), gffLine('c', 'mRNA', 1, 90, '+', 'ID=t;Parent=g'),
    gffLine('c', 'exon', 1, 30, '+', 'ID=e1;Parent=t'), gffLine('c', 'exon', 50, 90, '+', 'ID=e2;Parent=t'),
    gffLine('c', 'CDS', 10, 30, '+', 'ID=p;Parent=t'), gffLine('c', 'CDS', 45, 70, '+', 'ID=p;Parent=t'),
    gffLine('c', 'gene', 200, 290, '+', 'ID=fine'), gffLine('c', 'mRNA', 200, 290, '+', 'ID=t2;Parent=fine'),
    gffLine('c', 'exon', 200, 290, '+', 'ID=e3;Parent=t2'), gffLine('c', 'CDS', 210, 280, '+', 'ID=p2;Parent=t2')
  ));
  const bad = find(f, 'cdsOutsideExons');
  assert.equal(bad.severity, 'error');
  assert.deepEqual(bad.sample, ['t']);
});

test('two CDS segments in one exon are flagged; UTR-trimmed multi-exon transcripts on both strands are not', () => {
  const slippage = small(gffText(
    gffLine('c', 'gene', 1, 90, '+', 'ID=g'), gffLine('c', 'mRNA', 1, 90, '+', 'ID=t;Parent=g'),
    gffLine('c', 'exon', 1, 40, '+', 'ID=e1;Parent=t'), gffLine('c', 'exon', 50, 60, '+', 'ID=e2;Parent=t'),
    gffLine('c', 'exon', 65, 75, '+', 'ID=e3;Parent=t'), gffLine('c', 'exon', 80, 90, '+', 'ID=e4;Parent=t'),
    gffLine('c', 'CDS', 5, 15, '+', 'ID=p;Parent=t'), gffLine('c', 'CDS', 20, 30, '+', 'ID=p;Parent=t'),
    gffLine('c', 'CDS', 50, 60, '+', 'ID=p;Parent=t'), gffLine('c', 'CDS', 65, 75, '+', 'ID=p;Parent=t'), gffLine('c', 'CDS', 80, 85, '+', 'ID=p;Parent=t')
  ));
  assert.deepEqual(find(slippage, 'cdsOutsideExons').sample, ['t']);
  const normal = small(gffText(
    gffLine('c', 'gene', 1, 90, '+', 'ID=g'), gffLine('c', 'mRNA', 1, 90, '+', 'ID=t;Parent=g'),
    gffLine('c', 'exon', 1, 30, '+', 'ID=e1;Parent=t'), gffLine('c', 'exon', 50, 90, '+', 'ID=e2;Parent=t'),
    gffLine('c', 'CDS', 10, 30, '+', 'ID=p;Parent=t'), gffLine('c', 'CDS', 50, 70, '+', 'ID=p;Parent=t'),
    gffLine('c', 'gene', 200, 290, '-', 'ID=m'), gffLine('c', 'mRNA', 200, 290, '-', 'ID=tm;Parent=m'),
    gffLine('c', 'exon', 200, 230, '-', 'ID=e3;Parent=tm'), gffLine('c', 'exon', 250, 290, '-', 'ID=e4;Parent=tm'),
    gffLine('c', 'CDS', 210, 230, '-', 'ID=pm;Parent=tm'), gffLine('c', 'CDS', 250, 280, '-', 'ID=pm;Parent=tm')
  ));
  assert.equal(find(normal, 'cdsOutsideExons'), undefined);
});

test('a CDS on another strand than its mRNA is a strand mismatch', () => {
  const f = small(gffText(
    gffLine('c', 'gene', 1, 30, '+', 'ID=g'), gffLine('c', 'mRNA', 1, 30, '+', 'ID=t;Parent=g'),
    gffLine('c', 'exon', 1, 30, '+', 'ID=e;Parent=t'), gffLine('c', 'CDS', 5, 25, '-', 'ID=p;Parent=t')
  ));
  assert.deepEqual(find(f, 'strandMismatch').sample, ['g']);
  const direct = small(gffText(gffLine('c', 'gene', 1, 30, '+', 'ID=g'), gffLine('c', 'CDS', 5, 25, '-', 'ID=p;Parent=g')));
  assert.deepEqual(find(direct, 'strandMismatch').sample, ['g']);
});

test('a parentless RNA with no ID is reported only as parentlessRna', () => {
  const f = small(gffText(gffLine('c', 'snRNA', 1, 30, '+', 'Name=x')));
  assert.equal(find(f, 'missingId'), undefined);
  assert.deepEqual(find(f, 'parentlessRna').sample, ['c:1..30']);
});

test('a CDS under a gene that also has an RNA child is an error, not a geneCdsNoRna', () => {
  const f = small(gffText(
    gffLine('c', 'gene', 1, 90, '+', 'ID=g'), gffLine('c', 'tRNA', 1, 30, '+', 'ID=t;Parent=g'), gffLine('c', 'exon', 1, 30, '+', 'ID=e;Parent=t'),
    gffLine('c', 'CDS', 40, 90, '+', 'ID=p;Parent=g')
  ));
  assert.equal(find(f, 'geneCdsNoRna'), undefined);
  const bad = find(f, 'cdsUnderGene');
  assert.equal(bad.severity, 'error');
  assert.deepEqual(bad.sample, ['p']);
});

test('duplicate IDs, created IDs with ":" or "-", and transcripts with several protein_ids', () => {
  const dup = small(gffText(gffLine('c', 'gene', 1, 9, '+', 'ID=X'), gffLine('c', 'tRNA', 20, 29, '+', 'ID=X')), { inputIdOf: new Map([['Y', 'rna-Y']]) });
  assert.deepEqual(find(dup, 'duplicateId'), {
    group: 'ids', check: 'duplicateId', severity: 'error', count: 1, sample: ['X'],
    message: 'IDs used by several features: X (gene, tRNA)', fix: { ids: ['transcript\tX\t<new id>'] }
  });
  const renamedDup = small(gffText(gffLine('c', 'gene', 1, 9, '+', 'ID=Y'), gffLine('c', 'mRNA', 20, 29, '+', 'ID=Y')), { inputIdOf: new Map([['Y', 'rna-Y']]) });
  assert.deepEqual(find(renamedDup, 'duplicateId').fix, { ids: ['transcript\trna-Y\t<new id>'] });
  const fromSequence = { level: 'sequence', id: 'scaffold-1' };
  const punct = small(gffText(gffLine('c', 'gene', 1, 9, '+', 'ID=g'), gffLine('c', 'tRNA', 1, 9, '+', 'ID=rna_scaffold-1_1_9_tRNA;Parent=g')),
    { synthesized: new Map([['rna_scaffold-1_1_9_tRNA', fromSequence], ['absent_id', fromSequence]]), inputSequenceIdOf: new Map([['scaffold-1', 'NW_000001.1']]) });
  assert.deepEqual(find(punct, 'synthesizedIdPunctuation'), {
    group: 'ids', check: 'synthesizedIdPunctuation', severity: 'error', count: 1, sample: ['rna_scaffold-1_1_9_tRNA'],
    message: 'created IDs containing ":" or "-"; rename what they are made from',
    fix: { ids: ['sequence\tNW_000001.1\t<new id>'] }
  });
  const multi = small(gffText(
    gffLine('c', 'gene', 1, 30, '+', 'ID=g'), gffLine('c', 'mRNA', 1, 30, '+', 'ID=t;Parent=g'),
    gffLine('c', 'exon', 1, 9, '+', 'ID=e1;Parent=t'), gffLine('c', 'exon', 20, 30, '+', 'ID=e2;Parent=t'),
    gffLine('c', 'CDS', 1, 9, '+', 'ID=c1;Parent=t;protein_id=P1'), gffLine('c', 'CDS', 20, 30, '+', 'ID=c2;Parent=t;protein_id=P2')
  ));
  assert.deepEqual(find(multi, 'multipleProteinIds').sample, ['t']);
});

test('created-ID sources resolve through inputIdOf, or inputSequenceIdOf for sequences', () => {
  const gff = gffText(gffLine('c', 'gene', 1, 9, '+', 'ID=g'), gffLine('c', 'tRNA', 1, 9, '+', 'ID=g_x-1;Parent=g'));
  const f = small(gff, { synthesized: new Map([['g_x-1', { level: 'gene', id: 'g' }]]), inputIdOf: new Map([['g', 'gene-g']]), inputSequenceIdOf: new Map([['g', 'wrong']]) });
  assert.deepEqual(find(f, 'synthesizedIdPunctuation').fix, { ids: ['gene\tgene-g\t<new id>'] });
});

test('a duplicate owned by an exon and a gene points at the gene, never the exon', () => {
  const f = small(gffText(gffLine('c', 'gene', 1, 9, '+', 'ID=X'), gffLine('c', 'exon', 1, 9, '+', 'ID=X')));
  assert.deepEqual(find(f, 'duplicateId').fix, { ids: ['gene\tX\t<new id>'] });
  const onlyExons = small(gffText(gffLine('c', 'exon', 1, 9, '+', 'ID=X'), gffLine('c', 'intron', 1, 9, '+', 'ID=X')));
  assert.equal(find(onlyExons, 'duplicateId').fix, null);
});

test('an owner whose old already has an ids.tsv line gets that line named, not a second one', () => {
  const idsEntries = [{ level: 'transcript', old: 'rna-Y', new: 'Y2', written: 'Y2', line: 4 }];
  const f = small(gffText(gffLine('c', 'gene', 1, 9, '+', 'ID=Y'), gffLine('c', 'mRNA', 20, 29, '+', 'ID=Y')), { inputIdOf: new Map([['Y', 'rna-Y']]), idsEntries });
  assert.deepEqual(find(f, 'duplicateId').fix, { ids: ['ids.tsv line 4 already renames rna-Y; give it a different new ID'] });
});

test('sequence checks: GFF sequences missing from the FASTA, and report problems with partitions.tsv templates', () => {
  assert.deepEqual(find(tiny(parseGff(TINY_GFF), { fastaIds: new Set([CM]) }), 'seqIdNotInFasta').sample, [KZ]);
  const f = small(gffText(gffLine('c', 'gene', 1, 9, '+', 'ID=g')), { plan: { partitions: [], problems: [{ kind: 'notInReport', sequence: 'ZZ1' }] } });
  assert.deepEqual(find(f, 'notInReport'), {
    group: 'sequences', check: 'notInReport', severity: 'error', count: 1, sample: ['ZZ1'],
    message: 'sequences missing from the assembly report', fix: { partitions: ['ZZ1\t<role>\t<soTerm>\t<organelle>'] }
  });
});

test('problems without a sequence ID carry no sample and no partitions.tsv line', () => {
  const problems = [
    { kind: 'noPrimary', sequence: null },
    { kind: 'conflictingSoTerm', sequence: 'mitochondrion: mitochondrial_chromosome, apicoplast_chromosome' },
    { kind: 'duplicateAccession', sequence: 'AB1' },
    { kind: 'unusedOverride', sequence: 'ZZ9' }
  ];
  const f = small(gffText(gffLine('c', 'gene', 1, 9, '+', 'ID=g')), { plan: { partitions: [], problems } });
  assert.deepEqual(find(f, 'noPrimary'), {
    group: 'sequences', check: 'noPrimary', severity: 'error', count: 1, sample: [], message: 'no primary partition', fix: null
  });
  const conflict = find(f, 'conflictingSoTerm');
  assert.deepEqual([conflict.count, conflict.sample, conflict.fix], [1, [], null]);
  assert.match(conflict.message, /mitochondrial_chromosome, apicoplast_chromosome/);
  assert.deepEqual(find(f, 'duplicateAccession').fix, { partitions: ['AB1\t<role>\t<soTerm>\t<organelle>'] });
  assert.deepEqual([find(f, 'unusedOverride').sample, find(f, 'unusedOverride').fix], [['ZZ9'], null]);
});

test('collisionFinding names both features and the ids.tsv line for the second', () => {
  const f = collisionFinding([{ id: 'T1', olds: [{ id: 'gene-T1', level: 'gene', type: 'gene' }, { id: 'rna-T1', level: 'transcript', type: 'tRNA' }] }]);
  assert.equal(f.message, 'the ID policy gives one ID to several features: T1 ← gene-T1 and rna-T1');
  assert.deepEqual(f.fix, { ids: ['transcript\trna-T1\t<new id>'] });
});

test('collisionFinding skips level-less owners and names an existing ids.tsv line', () => {
  const c = { id: 'E1', olds: [{ id: 'exon-1', level: null, type: 'exon' }, { id: 'gene-E1', level: 'gene', type: 'gene' }] };
  assert.deepEqual(collisionFinding([c]).fix, { ids: ['gene\tgene-E1\t<new id>'] });
  const existing = [{ level: 'gene', old: 'gene-E1', new: 'E2', written: 'E2', line: 7 }];
  assert.deepEqual(collisionFinding([c], existing).fix, { ids: ['ids.tsv line 7 already renames gene-E1; give it a different new ID'] });
  assert.equal(collisionFinding([{ id: 'Q', olds: [{ id: 'a', level: null, type: 'exon' }, { id: 'b', level: null, type: 'intron' }] }]).fix, null);
});

test('formatFinding prints one line', () => {
  assert.equal(formatFinding({ stage: 'raw', severity: 'error', group: 'structure', check: 'repeatedGeneLines', count: 1, sample: ['g'], message: 'm' }),
    'raw error structure/repeatedGeneLines (1): m [g]');
  assert.equal(formatFinding({ severity: 'info', group: 'sequences', check: 'partitionCounts', count: 1, sample: [], message: 'x' }),
    'info sequences/partitionCounts (1): x');
});
