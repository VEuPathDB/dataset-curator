import { test } from 'node:test';
import assert from 'node:assert/strict';
import { libraryProblems } from '../shared/scripts/lib/library-checks.js';

const run = (over) => ({
  run_accession: 'SRR1', sample_accession: 'SAMN1', library_source: 'GENOMIC', library_strategy: 'WGS',
  library_selection: 'RANDOM', library_layout: 'PAIRED', instrument_platform: 'ILLUMINA',
  instrument_model: 'Illumina NovaSeq 6000', read_count: '5000000', base_count: '1500000000', ...over
});

test('a clean WGS run has no problems', () => {
  assert.deepEqual(libraryProblems([run()]), { errors: [], warnings: [] });
});

test('no runs, zero reads and non-GENOMIC sources are hard stops', () => {
  assert.deepEqual(libraryProblems([]).errors, ['No runs: the BioProject has no reads in SRA']);
  assert.deepEqual(libraryProblems([run({ read_count: '0' }), run({ run_accession: 'SRR2', base_count: '' })]).errors, [
    'SRR1: read_count is 0 or missing', 'SRR2: base_count is 0 or missing'
  ]);
  assert.deepEqual(libraryProblems([run({ library_source: 'TRANSCRIPTOMIC' })]).errors, ['SRR1: library_source is TRANSCRIPTOMIC, not GENOMIC']);
});

test('PRJNA1086165-shaped runs give every warning and no hard stop', () => {
  const shaped = [
    run({ run_accession: 'SRR28314583', sample_accession: 'SAMN40370510', library_strategy: 'WXS', library_selection: 'PolyA', library_layout: 'SINGLE', read_count: '40230', base_count: '64924939' }),
    run({ run_accession: 'SRR28314585', sample_accession: 'SAMN40370508', library_selection: 'PolyA', library_layout: 'SINGLE', read_count: '4935', base_count: '42393258' })
  ];
  const { errors, warnings } = libraryProblems(shaped);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, [
    'SRR28314583: library_strategy is WXS, not WGS',
    'SRR28314583: library_selection PolyA is an RNA selection',
    'SRR28314583: mean read length 1614 bp is implausible for Illumina NovaSeq 6000 (over 300)',
    'SRR28314585: library_selection PolyA is an RNA selection',
    'SRR28314585: mean read length 8590 bp is implausible for Illumina NovaSeq 6000 (over 300)',
    'SAMN40370510: 40230 reads, under 1000000',
    'SAMN40370508: 4935 reads, under 1000000'
  ]);
});

test('paired-end read length is per mate', () => {
  assert.deepEqual(libraryProblems([run({ read_count: '5000000', base_count: '2500000000' })]).warnings, []);
});
