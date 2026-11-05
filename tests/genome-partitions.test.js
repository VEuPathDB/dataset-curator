import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAssemblyReport } from '../shared/scripts/genome/assembly-report.js';
import { chromosomeMapText, isChromosomePrimary, planPartitions, publicPartition, readPartitionsTsv } from '../shared/scripts/genome/partitions.js';
import { reportText } from './genome-helpers.js';

const plan = (rows, sequenceIds, options = {}) => planPartitions({ sequenceIds, report: parseAssemblyReport(reportText(rows)), ...options });
const summary = (p) => p.partitions.map((x) => [x.dir, x.sequences.map((s) => s.id)]);
const CHR = ['1', 'assembled-molecule', 'Chromosome', 'CM000001.1'];
const SUPER = ['u2', 'unplaced-scaffold', 'na', 'KZ000002.1'];
const CONTIG = ['u1', 'unplaced-scaffold', 'na', 'AAEX03000001.1'];

test('chromosome primary with supercontig and contig secondaries', () => {
  const p = plan([CHR, CONTIG, SUPER], ['AAEX03000001.1', 'KZ000002.1', 'CM000001.1']);
  assert.deepEqual(summary(p), [
    ['final/primary_chromosome', ['CM000001.1']],
    ['final/secondary_supercontig', ['KZ000002.1']],
    ['final/secondary_contig', ['AAEX03000001.1']]
  ]);
  assert.deepEqual(p.problems, []);
  assert.deepEqual(publicPartition(p.partitions[0]), { role: 'primary', soTerm: 'chromosome', organelle: null, sequenceCount: 1, dir: 'final/primary_chromosome' });
  assert.equal(isChromosomePrimary(p.partitions[0]), true);
  assert.equal(isChromosomePrimary(p.partitions[1]), false);
});

test('supercontig primary with contig secondary', () => {
  assert.deepEqual(summary(plan([CONTIG, SUPER], ['KZ000002.1', 'AAEX03000001.1'])), [
    ['final/primary_supercontig', ['KZ000002.1']],
    ['final/secondary_contig', ['AAEX03000001.1']]
  ]);
});

test('contig only', () => {
  assert.deepEqual(summary(plan([CONTIG], ['AAEX03000001.1'])), [['final/primary_contig', ['AAEX03000001.1']]]);
});

test('each organelle is its own partition', () => {
  const p = plan([CHR, ['MT', 'assembled-molecule', 'Mitochondrion', 'CM000003.1'], ['API', 'assembled-molecule', 'Apicoplast', 'CM000004.1']],
    ['CM000001.1', 'CM000003.1', 'CM000004.1']);
  assert.deepEqual(summary(p), [
    ['final/primary_chromosome', ['CM000001.1']],
    ['final/organelle_apicoplast', ['CM000004.1']],
    ['final/organelle_mitochondrion', ['CM000003.1']]
  ]);
  assert.deepEqual(publicPartition(p.partitions[2]), { role: 'organelle', soTerm: 'mitochondrial_chromosome', organelle: 'mitochondrion', sequenceCount: 1, dir: 'final/organelle_mitochondrion' });
});

test('partitions.tsv overrides any sequence', () => {
  const overrides = readPartitionsTsv('sequence\trole\tsoTerm\torganelle\nAAEX03000001.1\tsecondary\tsupercontig\t\n');
  assert.deepEqual(summary(plan([CHR, CONTIG, SUPER], ['CM000001.1', 'AAEX03000001.1', 'KZ000002.1'], { overrides })), [
    ['final/primary_chromosome', ['CM000001.1']],
    ['final/secondary_supercontig', ['AAEX03000001.1', 'KZ000002.1']]
  ]);
});

test('report problems: missing accession, unknown role or location type, absent sequence, two primaries', () => {
  const p = plan([CHR, ['u1', 'unplaced-scaffold', 'na', 'na', 'NW_000009.1'], ['u2', 'mystery-role', 'na', 'KZ000002.1'], ['lg', 'assembled-molecule', 'Linkage Group', 'CM000005.1']],
    ['CM000001.1', 'NW_000009.1', 'KZ000002.1', 'CM000005.1', 'ZZ999999.1']);
  assert.deepEqual(p.problems, [
    { kind: 'missingAccession', sequence: 'NW_000009.1' },
    { kind: 'unknownRole', sequence: 'KZ000002.1' },
    { kind: 'unknownLocationType', sequence: 'CM000005.1' },
    { kind: 'notInReport', sequence: 'ZZ999999.1' }
  ]);
  const overrides = readPartitionsTsv('sequence\trole\tsoTerm\torganelle\nAAEX03000001.1\tprimary\tcontig\t\n');
  assert.deepEqual(plan([CHR, CONTIG], ['CM000001.1', 'AAEX03000001.1'], { overrides }).problems, [{ kind: 'multiplePrimary', sequence: 'chromosome, contig' }]);
});

test('a renamed sequence keeps its report row and order', () => {
  const p = plan([CHR], ['CM000001.1'], { renames: new Map([['CM000001.1', 'chr1']]) });
  assert.deepEqual(p.partitions[0].sequences, [{ id: 'chr1', name: '1' }]);
});

test('chromosomeMapText lists id, Sequence-Name and order', () => {
  const p = plan([CHR, ['2', 'assembled-molecule', 'Chromosome', 'CM000002.1']], ['CM000002.1', 'CM000001.1']);
  assert.equal(chromosomeMapText(p.partitions[0]), 'CM000001.1\t1\t1\nCM000002.1\t2\t2\n');
});

const TSV_HEAD = 'sequence\trole\tsoTerm\torganelle\n';

test('overridden nuclear sequences count when choosing the primary rank', () => {
  const lg = ['lg', 'assembled-molecule', 'Linkage Group', 'CM000005.1'];
  const overrides = readPartitionsTsv(`${TSV_HEAD}CM000005.1\tprimary\tchromosome\t\n`);
  const p = plan([lg, SUPER], ['CM000005.1', 'KZ000002.1'], { overrides });
  assert.deepEqual(summary(p), [['final/primary_chromosome', ['CM000005.1']], ['final/secondary_supercontig', ['KZ000002.1']]]);
  assert.deepEqual(p.problems, []);
});

test('a repeated report accession is a problem unless overridden', () => {
  const twin = ['t', 'unplaced-scaffold', 'na', 'KZ000002.1'];
  assert.deepEqual(plan([SUPER, twin], ['KZ000002.1']).problems, [{ kind: 'duplicateAccession', sequence: 'KZ000002.1' }]);
  const overrides = readPartitionsTsv(`${TSV_HEAD}KZ000002.1\tprimary\tsupercontig\t\n`);
  assert.deepEqual(plan([SUPER, twin], ['KZ000002.1'], { overrides }).problems, []);
});

test('an override for a sequence that is not there is a problem', () => {
  const overrides = readPartitionsTsv(`${TSV_HEAD}ZZ1.1\tsecondary\tcontig\t\n`);
  assert.deepEqual(plan([CHR], ['CM000001.1'], { overrides }).problems, [{ kind: 'unusedOverride', sequence: 'ZZ1.1' }]);
});

test('no primary reports a null sequence', () => {
  const overrides = readPartitionsTsv(`${TSV_HEAD}CM000001.1\tsecondary\tchromosome\t\n`);
  assert.deepEqual(plan([CHR], ['CM000001.1'], { overrides }).problems, [{ kind: 'noPrimary', sequence: null }]);
});

test('organelle overrides with one organelle share a partition; differing soTerms are a problem', () => {
  const same = readPartitionsTsv(`${TSV_HEAD}A\torganelle\tmitochondrial_chromosome\tmitochondrion\nB\torganelle\tmitochondrial_chromosome\tmitochondrion\n`);
  const ok = plan([CHR, ['a', 'unplaced-scaffold', 'na', 'A'], ['b', 'unplaced-scaffold', 'na', 'B']], ['CM000001.1', 'A', 'B'], { overrides: same });
  assert.deepEqual(summary(ok), [['final/primary_chromosome', ['CM000001.1']], ['final/organelle_mitochondrion', ['A', 'B']]]);
  const differ = readPartitionsTsv(`${TSV_HEAD}A\torganelle\tmitochondrial_chromosome\tmitochondrion\nB\torganelle\tkinetoplast\tmitochondrion\n`);
  const bad = plan([CHR, ['a', 'unplaced-scaffold', 'na', 'A'], ['b', 'unplaced-scaffold', 'na', 'B']], ['CM000001.1', 'A', 'B'], { overrides: differ });
  assert.equal(bad.partitions.length, 2);
  assert.deepEqual(bad.problems, [{ kind: 'conflictingSoTerm', sequence: 'mitochondrion: mitochondrial_chromosome, kinetoplast' }]);
});

test('readPartitionsTsv numbers file lines and validates every row', () => {
  assert.throws(() => readPartitionsTsv(`\n${TSV_HEAD}\nX\tmain\tchromosome\t\n`), /partitions\.tsv line 4: role must be one of/);
  assert.throws(() => readPartitionsTsv(`${TSV_HEAD}X\tsecondary\tcontig\t\n\nX\tsecondary\tcontig\t\n`), /line 4: X is already on line 2/);
  assert.throws(() => readPartitionsTsv(`${TSV_HEAD}X\tsecondary\tcon tig\t\n`), /line 2: soTerm must be letters/);
  assert.throws(() => readPartitionsTsv(`${TSV_HEAD}X\torganelle\tmito\tmi/to\n`), /line 2: organelle must be letters/);
  assert.throws(() => readPartitionsTsv(`${TSV_HEAD}X\tsecondary\tcontig\tmitochondrion\n`), /line 2: only an organelle partition takes an organelle/);
  assert.throws(() => readPartitionsTsv(`${TSV_HEAD}X\tsecondary\tmitochondrial_chromosome\t\n`), /line 2: soTerm must be one of chromosome, supercontig, contig/);
  assert.throws(() => readPartitionsTsv(`${TSV_HEAD}X\tsecondary\tcontig\t\textra\n`), /line 2: expected 4 columns, found 5/);
});

test('readPartitionsTsv refuses a bad header, role or organelle line', () => {
  assert.throws(() => readPartitionsTsv('seq\trole\n'), /partitions\.tsv header must be/);
  assert.throws(() => readPartitionsTsv('sequence\trole\tsoTerm\torganelle\nX\tmain\tchromosome\t\n'), /partitions\.tsv line 2: role must be one of primary, secondary, organelle/);
  assert.throws(() => readPartitionsTsv('sequence\trole\tsoTerm\torganelle\nX\torganelle\tmitochondrial_chromosome\t\n'), /partitions\.tsv line 2: an organelle partition needs its organelle/);
});
