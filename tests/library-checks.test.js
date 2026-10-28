import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { libraryProblems } from '../shared/scripts/lib/library-checks.js';

const run = (over) => ({
  run_accession: 'SRR1', sample_accession: 'SAMN1', library_source: 'GENOMIC', library_strategy: 'WGS',
  library_selection: 'RANDOM', library_layout: 'PAIRED', instrument_platform: 'ILLUMINA',
  instrument_model: 'Illumina NovaSeq 6000', read_count: '5000000', base_count: '1500000000', ...over
});

test('a clean WGS run has no problems', () => {
  assert.deepEqual(libraryProblems([run()]), { errors: [], projectErrors: [], runErrors: [], warnings: [] });
});

test('no runs, zero reads and non-GENOMIC sources are hard stops', () => {
  assert.deepEqual(libraryProblems([]).projectErrors, ['No runs: the BioProject has no reads in SRA']);
  const zero = libraryProblems([run({ read_count: '0' }), run({ run_accession: 'SRR2', base_count: '' })]);
  assert.deepEqual(zero.runErrors, ['SRR1: read_count is 0 or missing', 'SRR2: base_count is 0 or missing']);
  assert.deepEqual(zero.projectErrors, []);
  assert.deepEqual(zero.errors, zero.runErrors);
  const rna = libraryProblems([run({ library_source: 'TRANSCRIPTOMIC' }), run({ run_accession: 'SRR2' })]);
  assert.deepEqual(rna.runErrors, ['SRR1: library_source is TRANSCRIPTOMIC, not GENOMIC']);
  assert.deepEqual(rna.projectErrors, []);
});

test('a BioProject with no GENOMIC run at all is a project-level stop', () => {
  const r = libraryProblems([run({ library_source: 'TRANSCRIPTOMIC' })]);
  assert.deepEqual(r.projectErrors, ['No GENOMIC runs: the BioProject has no DNA sequencing']);
  assert.deepEqual(r.errors, ['No GENOMIC runs: the BioProject has no DNA sequencing', 'SRR1: library_source is TRANSCRIPTOMIC, not GENOMIC']);
});

test('given the used runs, per-run errors, warnings and depth cover only those runs', () => {
  const runs = [
    run({ run_accession: 'SRR1', sample_accession: 'SAMN1', read_count: '600000', base_count: '180000000' }),
    run({ run_accession: 'SRR2', sample_accession: 'SAMN1', read_count: '600000', base_count: '180000000' }),
    run({ run_accession: 'SRR3', sample_accession: 'SAMN2', library_source: 'TRANSCRIPTOMIC', library_strategy: 'RNA-Seq', read_count: '0' })
  ];
  assert.deepEqual(libraryProblems(runs, { used: new Set(['SRR1', 'SRR2']) }), { errors: [], projectErrors: [], runErrors: [], warnings: [] });
  assert.deepEqual(libraryProblems(runs, { used: new Set(['SRR1']) }).warnings, ['SAMN1: 600000 reads, under 1000000']);
  assert.equal(libraryProblems(runs).runErrors.length, 2);
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

test('RT-PCR and inverse rRNA selections are RNA selections', () => {
  for (const sel of ['RT-PCR', 'Inverse rRNA', 'Inverse rRNA selection']) {
    assert.deepEqual(libraryProblems([run({ library_selection: sel })]).warnings, [`SRR1: library_selection ${sel} is an RNA selection`]);
  }
});

test('low depth is a warning only for samples sequenced entirely on Illumina', () => {
  const nanopore = { instrument_platform: 'OXFORD_NANOPORE', instrument_model: 'MinION', read_count: '40000', base_count: '400000000' };
  assert.deepEqual(libraryProblems([run(nanopore)]).warnings, []);
  assert.deepEqual(libraryProblems([run({ read_count: '400000', base_count: '120000000' }), run({ run_accession: 'SRR2', ...nanopore })]).warnings, []);
});

test('paired-end read length is per mate', () => {
  assert.deepEqual(libraryProblems([run({ read_count: '5000000', base_count: '2500000000' })]).warnings, []);
});

function checkLibrary(t, runs) {
  const cwd = mkdtempSync(join(tmpdir(), 'check-library-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  mkdirSync(join(cwd, '.curation/tmp'), { recursive: true });
  writeFileSync(join(cwd, '.curation/tmp/PRJNA1_sra_metadata.json'), JSON.stringify({ runs }));
  return spawnSync(process.execPath, [new URL('../shared/scripts/check-library.js', import.meta.url).pathname, 'PRJNA1'], { cwd, encoding: 'utf-8' });
}

test('check-library exits 0 when clean, 3 for per-run errors only and 1 for a project-level stop', (t) => {
  assert.equal(checkLibrary(t, [run()]).status, 0);
  const perRun = checkLibrary(t, [run(), run({ run_accession: 'SRR2', read_count: '0' })]);
  assert.equal(perRun.status, 3);
  assert.match(perRun.stderr, /^Error: SRR2: read_count is 0 or missing \(drop this run from the sample annotations, or stop\)$/m);
  const project = checkLibrary(t, [run({ library_source: 'TRANSCRIPTOMIC' })]);
  assert.equal(project.status, 1);
  assert.match(project.stderr, /^Error: No GENOMIC runs: the BioProject has no DNA sequencing$/m);
});
